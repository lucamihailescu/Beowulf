// Package entra provides Microsoft Entra ID (Azure AD) integration
// for searching users and groups via the Microsoft Graph API.
package entra

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Client provides access to Microsoft Graph API for user and group lookups.
type Client struct {
	tenantID     string
	clientID     string
	clientSecret string
	httpClient   *http.Client

	// Token cache
	mu          sync.RWMutex
	accessToken string
	tokenExpiry time.Time
}

// NewClient creates a new Entra/Graph API client.
func NewClient(tenantID, clientID, clientSecret string) *Client {
	return &Client{
		tenantID:     tenantID,
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// IsConfigured returns true if Entra integration is properly configured.
func (c *Client) IsConfigured() bool {
	return c.tenantID != "" && c.clientID != "" && c.clientSecret != ""
}

// User represents a Microsoft Entra user.
type User struct {
	ID                string `json:"id"`
	DisplayName       string `json:"displayName"`
	UserPrincipalName string `json:"userPrincipalName"`
	Mail              string `json:"mail"`
	JobTitle          string `json:"jobTitle,omitempty"`
	Department        string `json:"department,omitempty"`
}

// Group represents a Microsoft Entra group.
type Group struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Description string `json:"description,omitempty"`
	Mail        string `json:"mail,omitempty"`
	GroupTypes  []string `json:"groupTypes,omitempty"`
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

// SearchUsers searches for users matching the query.
func (c *Client) SearchUsers(ctx context.Context, query string, limit int) (*SearchUsersResult, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("entra client not configured")
	}

	token, err := c.getAccessToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("get access token: %w", err)
	}

	if limit <= 0 || limit > 50 {
		limit = 25
	}

	// Build Graph API URL for user search
	graphURL := "https://graph.microsoft.com/v1.0/users"
	params := url.Values{}
	params.Set("$top", fmt.Sprintf("%d", limit))
	params.Set("$select", "id,displayName,userPrincipalName,mail,jobTitle,department")
	params.Set("$count", "true")

	if query != "" {
		// Use $filter for search (startsWith on displayName or userPrincipalName)
		filter := fmt.Sprintf("startsWith(displayName,'%s') or startsWith(userPrincipalName,'%s') or startsWith(mail,'%s')",
			escapeOData(query), escapeOData(query), escapeOData(query))
		params.Set("$filter", filter)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", graphURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("ConsistencyLevel", "eventual") // Required for $count

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("graph api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph api error %d: %s", resp.StatusCode, string(body))
	}

	var graphResp struct {
		Value      []User `json:"value"`
		ODataCount int    `json:"@odata.count"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&graphResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &SearchUsersResult{
		Users:      graphResp.Value,
		TotalCount: graphResp.ODataCount,
	}, nil
}

// SearchGroups searches for groups matching the query.
func (c *Client) SearchGroups(ctx context.Context, query string, limit int) (*SearchGroupsResult, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("entra client not configured")
	}

	token, err := c.getAccessToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("get access token: %w", err)
	}

	if limit <= 0 || limit > 50 {
		limit = 25
	}

	// Build Graph API URL for group search
	graphURL := "https://graph.microsoft.com/v1.0/groups"
	params := url.Values{}
	params.Set("$top", fmt.Sprintf("%d", limit))
	params.Set("$select", "id,displayName,description,mail,groupTypes")
	params.Set("$count", "true")

	if query != "" {
		filter := fmt.Sprintf("startsWith(displayName,'%s') or startsWith(mail,'%s')",
			escapeOData(query), escapeOData(query))
		params.Set("$filter", filter)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", graphURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("ConsistencyLevel", "eventual")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("graph api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph api error %d: %s", resp.StatusCode, string(body))
	}

	var graphResp struct {
		Value      []Group `json:"value"`
		ODataCount int     `json:"@odata.count"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&graphResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &SearchGroupsResult{
		Groups:     graphResp.Value,
		TotalCount: graphResp.ODataCount,
	}, nil
}

// GetUser retrieves a specific user by ID.
func (c *Client) GetUser(ctx context.Context, userID string) (*User, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("entra client not configured")
	}

	token, err := c.getAccessToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("get access token: %w", err)
	}

	graphURL := fmt.Sprintf("https://graph.microsoft.com/v1.0/users/%s", url.PathEscape(userID))
	params := url.Values{}
	params.Set("$select", "id,displayName,userPrincipalName,mail,jobTitle,department")

	req, err := http.NewRequestWithContext(ctx, "GET", graphURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("graph api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("user not found")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph api error %d: %s", resp.StatusCode, string(body))
	}

	var user User
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &user, nil
}

// GetGroup retrieves a specific group by ID.
func (c *Client) GetGroup(ctx context.Context, groupID string) (*Group, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("entra client not configured")
	}

	token, err := c.getAccessToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("get access token: %w", err)
	}

	graphURL := fmt.Sprintf("https://graph.microsoft.com/v1.0/groups/%s", url.PathEscape(groupID))
	params := url.Values{}
	params.Set("$select", "id,displayName,description,mail,groupTypes")

	req, err := http.NewRequestWithContext(ctx, "GET", graphURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("graph api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("group not found")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph api error %d: %s", resp.StatusCode, string(body))
	}

	var group Group
	if err := json.NewDecoder(resp.Body).Decode(&group); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &group, nil
}

// getAccessToken retrieves an access token using client credentials flow.
func (c *Client) getAccessToken(ctx context.Context) (string, error) {
	// Check cached token
	c.mu.RLock()
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		token := c.accessToken
		c.mu.RUnlock()
		return token, nil
	}
	c.mu.RUnlock()

	// Acquire write lock to refresh token
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		return c.accessToken, nil
	}

	// Request new token
	tokenURL := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", c.tenantID)

	data := url.Values{}
	data.Set("client_id", c.clientID)
	data.Set("client_secret", c.clientSecret)
	data.Set("scope", "https://graph.microsoft.com/.default")
	data.Set("grant_type", "client_credentials")

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("token error %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}

	// Cache token with 5-minute buffer before expiry
	c.accessToken = tokenResp.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn-300) * time.Second)

	return c.accessToken, nil
}

// escapeOData escapes special characters for OData filter queries.
func escapeOData(s string) string {
	s = strings.ReplaceAll(s, "'", "''")
	return s
}

