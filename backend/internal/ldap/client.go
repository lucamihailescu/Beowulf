package ldap

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/redis/go-redis/v9"
)

// Client provides LDAP operations for Active Directory integration.
type Client struct {
	config     *Config
	cache      *GroupCache
	mu         sync.RWMutex
	conn       *ldap.Conn
	lastUsed   time.Time
	connExpiry time.Duration
}

// NewClient creates a new LDAP client.
func NewClient(config *Config, rdb *redis.Client) *Client {
	var cache *GroupCache
	if rdb != nil {
		cache = NewGroupCache(rdb, config.GroupCacheTTL)
	}

	return &Client{
		config:     config,
		cache:      cache,
		connExpiry: 5 * time.Minute, // Reconnect after 5 minutes of inactivity
	}
}

// IsConfigured returns true if LDAP is properly configured.
func (c *Client) IsConfigured() bool {
	return c.config != nil &&
		c.config.Server != "" &&
		c.config.BaseDN != "" &&
		c.config.BindDN != "" &&
		c.config.BindPassword != ""
}

// UpdateConfig updates the client configuration.
func (c *Client) UpdateConfig(config *Config) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.config = config
	if c.cache != nil && config.GroupCacheTTL > 0 {
		c.cache.SetTTL(config.GroupCacheTTL)
	}

	// Close existing connection to force reconnect with new config
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
}

// getConnection returns an active LDAP connection, creating one if needed.
func (c *Client) getConnection() (*ldap.Conn, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if we have a valid connection
	if c.conn != nil {
		// Check if connection is still alive
		if time.Since(c.lastUsed) < c.connExpiry {
			c.lastUsed = time.Now()
			return c.conn, nil
		}
		// Connection expired, close it
		c.conn.Close()
		c.conn = nil
	}

	// Create new connection
	conn, err := c.dial()
	if err != nil {
		return nil, err
	}

	// Bind with service account
	if err := conn.Bind(c.config.BindDN, c.config.BindPassword); err != nil {
		conn.Close()
		return nil, fmt.Errorf("bind failed: %w", err)
	}

	c.conn = conn
	c.lastUsed = time.Now()
	return conn, nil
}

// dial creates a new LDAP connection.
func (c *Client) dial() (*ldap.Conn, error) {
	var conn *ldap.Conn
	var err error

	// Determine if we're using LDAPS (port 636) or LDAP with StartTLS
	if strings.HasPrefix(c.config.Server, "ldaps://") {
		// LDAPS - TLS from the start
		tlsConfig := &tls.Config{
			InsecureSkipVerify: c.config.InsecureSkipVerify,
		}
		conn, err = ldap.DialURL(c.config.Server, ldap.DialWithTLSConfig(tlsConfig))
	} else {
		// LDAP - optionally upgrade to TLS
		conn, err = ldap.DialURL(c.config.Server)
		if err == nil && c.config.UseTLS {
			tlsConfig := &tls.Config{
				InsecureSkipVerify: c.config.InsecureSkipVerify,
			}
			err = conn.StartTLS(tlsConfig)
			if err != nil {
				conn.Close()
				return nil, fmt.Errorf("StartTLS failed: %w", err)
			}
		}
	}

	if err != nil {
		return nil, fmt.Errorf("dial failed: %w", err)
	}

	return conn, nil
}

// Close closes the LDAP connection.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
}

// Authenticate authenticates a user with username and password.
func (c *Client) Authenticate(ctx context.Context, username, password string) (*User, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("LDAP not configured")
	}

	// First, search for the user to get their DN
	user, err := c.findUser(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// Create a new connection for authentication (don't use pooled connection)
	authConn, err := c.dial()
	if err != nil {
		return nil, fmt.Errorf("connection failed: %w", err)
	}
	defer authConn.Close()

	// Attempt to bind with user's credentials
	if err := authConn.Bind(user.DN, password); err != nil {
		return nil, fmt.Errorf("authentication failed: invalid credentials")
	}

	// Get group memberships
	groups, err := c.getUserGroups(ctx, user.DN)
	if err != nil {
		log.Printf("LDAP: failed to get groups for %s: %v", username, err)
		// Don't fail authentication just because we couldn't get groups
	}
	user.Groups = groups

	// Cache the user and groups
	if c.cache != nil {
		_ = c.cache.SetUser(ctx, username, user)
		_ = c.cache.SetUserGroups(ctx, user.DN, groups)
	}

	return user, nil
}

// findUser searches for a user by username.
func (c *Client) findUser(ctx context.Context, username string) (*User, error) {
	conn, err := c.getConnection()
	if err != nil {
		return nil, err
	}

	// Build the search filter
	filter := fmt.Sprintf(c.config.UserSearchFilter, ldap.EscapeFilter(username))

	searchReq := ldap.NewSearchRequest(
		c.config.BaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		1, // Size limit
		0, // Time limit
		false,
		filter,
		[]string{"dn", "sAMAccountName", "userPrincipalName", "displayName", "mail", "givenName", "sn", "department", "title", c.config.GroupMembershipAttr},
		nil,
	)

	result, err := conn.Search(searchReq)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	if len(result.Entries) == 0 {
		return nil, fmt.Errorf("user not found")
	}

	entry := result.Entries[0]
	return entryToUser(entry, c.config.GroupMembershipAttr), nil
}

// getUserGroups retrieves group memberships for a user DN.
func (c *Client) getUserGroups(ctx context.Context, userDN string) ([]string, error) {
	// Check cache first
	if c.cache != nil {
		cached, err := c.cache.GetUserGroups(ctx, userDN)
		if err != nil {
			log.Printf("LDAP: cache error: %v", err)
		}
		if cached != nil {
			return cached, nil
		}
	}

	conn, err := c.getConnection()
	if err != nil {
		return nil, err
	}

	// Search for the user's groups
	filter := fmt.Sprintf("(&(objectClass=group)(member=%s))", ldap.EscapeFilter(userDN))

	searchReq := ldap.NewSearchRequest(
		c.config.BaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		0, // No size limit
		0, // No time limit
		false,
		filter,
		[]string{"cn"},
		nil,
	)

	result, err := conn.Search(searchReq)
	if err != nil {
		return nil, fmt.Errorf("group search failed: %w", err)
	}

	groups := make([]string, 0, len(result.Entries))
	for _, entry := range result.Entries {
		cn := entry.GetAttributeValue("cn")
		if cn != "" {
			groups = append(groups, cn)
		}
	}

	// Cache the result
	if c.cache != nil {
		_ = c.cache.SetUserGroups(ctx, userDN, groups)
	}

	return groups, nil
}

// SearchUsers searches for users matching the query.
func (c *Client) SearchUsers(ctx context.Context, query string, limit int) (*SearchUsersResult, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("LDAP not configured")
	}

	conn, err := c.getConnection()
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}

	// Build the search filter with wildcard matching
	escapedQuery := ldap.EscapeFilter(query)
	filter := fmt.Sprintf(c.config.UserFilter, escapedQuery, escapedQuery, escapedQuery)

	searchReq := ldap.NewSearchRequest(
		c.config.BaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		limit,
		0,
		false,
		filter,
		[]string{"dn", "sAMAccountName", "userPrincipalName", "displayName", "mail", "givenName", "sn", "department", "title"},
		nil,
	)

	result, err := conn.Search(searchReq)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	users := make([]User, 0, len(result.Entries))
	for _, entry := range result.Entries {
		users = append(users, *entryToUser(entry, ""))
	}

	return &SearchUsersResult{
		Users:      users,
		TotalCount: len(users),
	}, nil
}

// SearchGroups searches for groups matching the query.
func (c *Client) SearchGroups(ctx context.Context, query string, limit int) (*SearchGroupsResult, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("LDAP not configured")
	}

	conn, err := c.getConnection()
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}

	// Build the search filter with wildcard matching
	escapedQuery := ldap.EscapeFilter(query)
	filter := fmt.Sprintf(c.config.GroupFilter, escapedQuery, escapedQuery)

	searchReq := ldap.NewSearchRequest(
		c.config.BaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		limit,
		0,
		false,
		filter,
		[]string{"dn", "cn", "displayName", "description", "mail"},
		nil,
	)

	result, err := conn.Search(searchReq)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	groups := make([]Group, 0, len(result.Entries))
	for _, entry := range result.Entries {
		groups = append(groups, *entryToGroup(entry))
	}

	return &SearchGroupsResult{
		Groups:     groups,
		TotalCount: len(groups),
	}, nil
}

// TestConnection tests the LDAP connection and returns any errors.
func (c *Client) TestConnection(ctx context.Context) error {
	if !c.IsConfigured() {
		return fmt.Errorf("LDAP not configured")
	}

	conn, err := c.dial()
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	defer conn.Close()

	// Test bind
	if err := conn.Bind(c.config.BindDN, c.config.BindPassword); err != nil {
		return fmt.Errorf("bind failed: %w", err)
	}

	// Test search with base DN
	searchReq := ldap.NewSearchRequest(
		c.config.BaseDN,
		ldap.ScopeBaseObject,
		ldap.NeverDerefAliases,
		1,
		5,
		false,
		"(objectClass=*)",
		[]string{"dn"},
		nil,
	)

	_, err = conn.Search(searchReq)
	if err != nil {
		return fmt.Errorf("search failed: %w", err)
	}

	return nil
}

// GetUserByUsername retrieves a user by username (cached if available).
func (c *Client) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	// Check cache first
	if c.cache != nil {
		cached, err := c.cache.GetUser(ctx, username)
		if err != nil {
			log.Printf("LDAP: cache error: %v", err)
		}
		if cached != nil {
			return cached, nil
		}
	}

	user, err := c.findUser(ctx, username)
	if err != nil {
		return nil, err
	}

	// Get group memberships
	groups, err := c.getUserGroups(ctx, user.DN)
	if err != nil {
		log.Printf("LDAP: failed to get groups for %s: %v", username, err)
	}
	user.Groups = groups

	// Cache the user
	if c.cache != nil {
		_ = c.cache.SetUser(ctx, username, user)
	}

	return user, nil
}

// entryToUser converts an LDAP entry to a User struct.
func entryToUser(entry *ldap.Entry, groupAttr string) *User {
	user := &User{
		DN:                entry.DN,
		SAMAccountName:    entry.GetAttributeValue("sAMAccountName"),
		UserPrincipalName: entry.GetAttributeValue("userPrincipalName"),
		DisplayName:       entry.GetAttributeValue("displayName"),
		Mail:              entry.GetAttributeValue("mail"),
		GivenName:         entry.GetAttributeValue("givenName"),
		Surname:           entry.GetAttributeValue("sn"),
		Department:        entry.GetAttributeValue("department"),
		Title:             entry.GetAttributeValue("title"),
	}

	// Get groups from memberOf attribute if present
	if groupAttr != "" {
		memberOf := entry.GetAttributeValues(groupAttr)
		groups := make([]string, 0, len(memberOf))
		for _, dn := range memberOf {
			// Extract CN from DN
			cn := extractCNFromDN(dn)
			if cn != "" {
				groups = append(groups, cn)
			}
		}
		user.Groups = groups
	}

	return user
}

// entryToGroup converts an LDAP entry to a Group struct.
func entryToGroup(entry *ldap.Entry) *Group {
	return &Group{
		DN:          entry.DN,
		CN:          entry.GetAttributeValue("cn"),
		DisplayName: entry.GetAttributeValue("displayName"),
		Description: entry.GetAttributeValue("description"),
		Mail:        entry.GetAttributeValue("mail"),
	}
}

// extractCNFromDN extracts the CN component from a distinguished name.
func extractCNFromDN(dn string) string {
	parts := strings.Split(dn, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(strings.ToUpper(part), "CN=") {
			return part[3:]
		}
	}
	return ""
}

