// Package ldap provides Active Directory/LDAP integration
// for user authentication and group lookups.
package ldap

import "time"

// Config holds LDAP/AD configuration.
type Config struct {
	// Server is the LDAP server URL (e.g., ldap://dc.example.com:389 or ldaps://dc.example.com:636)
	Server string `json:"server"`
	// BaseDN is the base DN for searches (e.g., DC=example,DC=com)
	BaseDN string `json:"base_dn"`
	// BindDN is the service account DN for LDAP queries
	BindDN string `json:"bind_dn"`
	// BindPassword is the service account password
	BindPassword string `json:"bind_password,omitempty"`
	// UserFilter is the LDAP filter for user searches (default: (&(objectClass=user)(|(sAMAccountName=*%s*)(displayName=*%s*)(mail=*%s*))))
	UserFilter string `json:"user_filter"`
	// GroupFilter is the LDAP filter for group searches (default: (&(objectClass=group)(|(cn=*%s*)(description=*%s*))))
	GroupFilter string `json:"group_filter"`
	// UserSearchFilter is the filter for authenticating a specific user (default: (&(objectClass=user)(sAMAccountName=%s)))
	UserSearchFilter string `json:"user_search_filter"`
	// GroupMembershipAttr is the attribute containing group memberships (default: memberOf)
	GroupMembershipAttr string `json:"group_membership_attr"`
	// UseTLS enables TLS for LDAP connections
	UseTLS bool `json:"use_tls"`
	// InsecureSkipVerify skips TLS certificate verification (not recommended for production)
	InsecureSkipVerify bool `json:"insecure_skip_verify"`
	// KerberosEnabled enables Kerberos/SPNEGO SSO
	KerberosEnabled bool `json:"kerberos_enabled"`
	// KerberosKeytab is the path to the keytab file for Kerberos
	KerberosKeytab string `json:"kerberos_keytab"`
	// KerberosService is the service principal name (e.g., HTTP/cedar.example.com)
	KerberosService string `json:"kerberos_service"`
	// KerberosRealm is the Kerberos realm (e.g., EXAMPLE.COM)
	KerberosRealm string `json:"kerberos_realm"`
	// GroupCacheTTL is the TTL for group membership cache
	GroupCacheTTL time.Duration `json:"group_cache_ttl"`
	// Enabled indicates if AD authentication is enabled
	Enabled bool `json:"enabled"`
	// Configured indicates if AD is properly configured
	Configured bool `json:"configured"`
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		UserFilter:          "(&(objectClass=user)(|(sAMAccountName=*%s*)(displayName=*%s*)(mail=*%s*)))",
		GroupFilter:         "(&(objectClass=group)(|(cn=*%s*)(description=*%s*)))",
		UserSearchFilter:    "(&(objectClass=user)(sAMAccountName=%s))",
		GroupMembershipAttr: "memberOf",
		GroupCacheTTL:       5 * time.Minute,
	}
}

// User represents an Active Directory user.
type User struct {
	DN                string   `json:"dn"`
	SAMAccountName    string   `json:"sAMAccountName"`
	UserPrincipalName string   `json:"userPrincipalName"`
	DisplayName       string   `json:"displayName"`
	Mail              string   `json:"mail"`
	GivenName         string   `json:"givenName,omitempty"`
	Surname           string   `json:"sn,omitempty"`
	Department        string   `json:"department,omitempty"`
	Title             string   `json:"title,omitempty"`
	Groups            []string `json:"groups,omitempty"`
}

// Group represents an Active Directory group.
type Group struct {
	DN          string `json:"dn"`
	CN          string `json:"cn"`
	DisplayName string `json:"displayName,omitempty"`
	Description string `json:"description,omitempty"`
	Mail        string `json:"mail,omitempty"`
}

// SearchUsersResult contains the results of a user search.
type SearchUsersResult struct {
	Users      []User `json:"users"`
	TotalCount int    `json:"total_count"`
}

// SearchGroupsResult contains the results of a group search.
type SearchGroupsResult struct {
	Groups     []Group `json:"groups"`
	TotalCount int     `json:"total_count"`
}

// AuthResult represents the result of an authentication attempt.
type AuthResult struct {
	Success bool   `json:"success"`
	User    *User  `json:"user,omitempty"`
	Error   string `json:"error,omitempty"`
}


