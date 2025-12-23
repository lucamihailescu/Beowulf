package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"cedar/internal/ldap"
	"cedar/internal/storage"
)

// handleGetADConfig returns the Active Directory configuration (without sensitive data).
func (a *API) handleGetADConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	config, err := a.settings.GetADConfigPublic(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// handleUpdateADConfig updates the Active Directory configuration.
func (a *API) handleUpdateADConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req storage.ADConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	// Get current user for audit
	updatedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		updatedBy = user.ID
	}

	// If enabling AD, disable Entra (they are mutually exclusive)
	if req.Enabled {
		entraConfig, _ := a.settings.GetEntraConfig(ctx)
		if entraConfig != nil && entraConfig.AuthEnabled {
			entraConfig.AuthEnabled = false
			_ = a.settings.SetEntraConfig(ctx, entraConfig, updatedBy)
		}
	}

	if err := a.settings.SetADConfig(ctx, &req, updatedBy); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Refresh auth middleware
	if a.authMiddleware != nil {
		a.authMiddleware.Refresh(a.cfg, a.settings)
	}

	// Update the LDAP client configuration if we have one
	if a.ldapClient != nil {
		ldapConfig := adConfigToLDAPConfig(&req)
		a.ldapClient.UpdateConfig(ldapConfig)
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, updatedBy, "ad.config.update", "", "", map[string]interface{}{
			"server":  req.Server,
			"enabled": req.Enabled,
		})
	}

	// Return updated config
	config, _ := a.settings.GetADConfigPublic(ctx)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// handleTestADConnection tests the AD/LDAP connection.
func (a *API) handleTestADConnection(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get the current config
	config, err := a.settings.GetADConfig(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// Check if we have a request body with test credentials
	var testConfig storage.ADConfig
	if r.Body != nil && r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&testConfig); err == nil {
			// Use test config if provided
			if testConfig.Server != "" {
				config.Server = testConfig.Server
			}
			if testConfig.BaseDN != "" {
				config.BaseDN = testConfig.BaseDN
			}
			if testConfig.BindDN != "" {
				config.BindDN = testConfig.BindDN
			}
			if testConfig.BindPassword != "" {
				config.BindPassword = testConfig.BindPassword
			}
		}
	}

	ldapConfig := adConfigToLDAPConfig(config)

	// Create a temporary client for testing
	testClient := ldap.NewClient(ldapConfig, nil)
	defer testClient.Close()

	if err := testClient.TestConnection(ctx); err != nil {
		w.WriteHeader(http.StatusOK) // Return 200 even on test failure
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Connection successful",
	})
}

// handleGetADStatus returns the AD configuration status.
func (a *API) handleGetADStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	config, err := a.settings.GetADConfigPublic(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Determine auth method
	authMethod := "none"
	if config.Configured && config.Enabled {
		if config.KerberosEnabled {
			authMethod = "ldap+kerberos"
		} else {
			authMethod = "ldap"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"configured":  config.Configured,
		"enabled":     config.Enabled,
		"auth_method": authMethod,
		"server":      config.Server,
	})
}

// handleSearchADUsers searches for users in Active Directory.
func (a *API) handleSearchADUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	query := r.URL.Query().Get("q")
	if query == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "query parameter 'q' is required"})
		return
	}

	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	if a.ldapClient == nil || !a.ldapClient.IsConfigured() {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "LDAP not configured"})
		return
	}

	result, err := a.ldapClient.SearchUsers(ctx, query, limit)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleSearchADGroups searches for groups in Active Directory.
func (a *API) handleSearchADGroups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	query := r.URL.Query().Get("q")
	if query == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "query parameter 'q' is required"})
		return
	}

	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	if a.ldapClient == nil || !a.ldapClient.IsConfigured() {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "LDAP not configured"})
		return
	}

	result, err := a.ldapClient.SearchGroups(ctx, query, limit)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleDeleteADConfig removes the Active Directory configuration.
func (a *API) handleDeleteADConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get current user for audit
	deletedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		deletedBy = user.ID
	}

	if err := a.settings.DeleteADConfig(ctx); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Clear LDAP client
	if a.ldapClient != nil {
		a.ldapClient.Close()
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, deletedBy, "ad.config.delete", "", "", nil)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// handleGetIdentityProvider returns which identity provider is active.
func (a *API) handleGetIdentityProvider(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	provider := a.settings.GetIdentityProvider(ctx)

	// Fallback to environment configuration if DB setting is none
	if provider == "none" {
		if a.cfg.AuthMode == "jwt" {
			provider = "entra"
		}
	}

	// Get additional details based on provider
	var details map[string]interface{}

	switch provider {
	case "ad":
		config, _ := a.settings.GetADConfigPublic(ctx)
		if config != nil {
			authMethod := "ldap"
			if config.KerberosEnabled {
				authMethod = "ldap+kerberos"
			}
			details = map[string]interface{}{
				"provider":    "ad",
				"auth_method": authMethod,
				"server":      config.Server,
			}
		}
	case "entra":
		config, _ := a.settings.GetEntraConfig(ctx)
		if config != nil {
			details = map[string]interface{}{
				"provider":  "entra",
				"tenant_id": config.TenantID,
				"client_id": config.ClientID,
			}
		} else if a.cfg.AuthMode == "jwt" {
			// Use env vars if DB config is missing but AuthMode is jwt
			details = map[string]interface{}{
				"provider":  "entra",
				"tenant_id": a.cfg.AzureTenantID,
				"client_id": a.cfg.AzureClientID,
			}
		}
	default:
		details = map[string]interface{}{
			"provider": "none",
		}
	}

	if details == nil {
		details = map[string]interface{}{
			"provider": "none",
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(details)
}

// LDAPAuthRequest represents a login request for LDAP authentication.
type LDAPAuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LDAPAuthResponse represents a successful LDAP authentication response.
type LDAPAuthResponse struct {
	Token     string   `json:"token"`
	ExpiresAt int64    `json:"expires_at"`
	User      LDAPUser `json:"user"`
}

// LDAPUser represents user information from LDAP.
type LDAPUser struct {
	ID          string   `json:"id"`
	Username    string   `json:"username"`
	DisplayName string   `json:"display_name"`
	Email       string   `json:"email"`
	Groups      []string `json:"groups"`
}

// handleLDAPAuth handles LDAP authentication requests.
func (a *API) handleLDAPAuth(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req LDAPAuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	if req.Username == "" || req.Password == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "username and password are required"})
		return
	}

	// Check if LDAP client is configured
	if a.ldapClient == nil || !a.ldapClient.IsConfigured() {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "LDAP authentication not configured"})
		return
	}

	// Authenticate against LDAP
	user, err := a.ldapClient.Authenticate(ctx, req.Username, req.Password)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "authentication failed"})
		return
	}

	// Generate JWT token
	expiresAt := time.Now().Add(24 * time.Hour)
	token, err := a.generateLDAPToken(user, expiresAt)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to generate token"})
		return
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, user.SAMAccountName, "auth.ldap.login", "", "", map[string]interface{}{
			"username": user.SAMAccountName,
			"email":    user.Mail,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(LDAPAuthResponse{
		Token:     token,
		ExpiresAt: expiresAt.Unix(),
		User: LDAPUser{
			ID:          user.DN,
			Username:    user.SAMAccountName,
			DisplayName: user.DisplayName,
			Email:       user.Mail,
			Groups:      user.Groups,
		},
	})
}

// generateLDAPToken generates a JWT token for an authenticated LDAP user.
func (a *API) generateLDAPToken(user *ldap.User, expiresAt time.Time) (string, error) {
	// Use a signing key from config or generate a default one
	signingKey := []byte(a.cfg.APIKey)
	if len(signingKey) == 0 {
		signingKey = []byte("cedar-ldap-jwt-secret-key-32bytes")
	}

	claims := jwt.MapClaims{
		"sub":    user.SAMAccountName,
		"name":   user.DisplayName,
		"email":  user.Mail,
		"groups": user.Groups,
		"dn":     user.DN,
		"upn":    user.UserPrincipalName,
		"iss":    "cedar-ldap",
		"aud":    "cedar",
		"exp":    expiresAt.Unix(),
		"iat":    time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(signingKey)
}

// validateLDAPToken validates an LDAP-issued JWT token.
func (a *API) validateLDAPToken(tokenString string) (*UserContext, error) {
	signingKey := []byte(a.cfg.APIKey)
	if len(signingKey) == 0 {
		signingKey = []byte("cedar-ldap-jwt-secret-key-32bytes")
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return signingKey, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		// Check issuer
		if iss, ok := claims["iss"].(string); !ok || iss != "cedar-ldap" {
			return nil, fmt.Errorf("invalid token issuer")
		}

		// Extract user info - prefer UPN for user-friendly audit logs
		userID := getString(claims, "upn") // UserPrincipalName (e.g., user@domain.com)
		if userID == "" {
			userID = getString(claims, "email")
		}
		if userID == "" {
			userID = getString(claims, "sub") // Fall back to SAMAccountName
		}

		user := &UserContext{
			ID:    userID,
			Name:  getString(claims, "name"),
			Email: getString(claims, "email"),
		}

		// Extract groups
		if groups, ok := claims["groups"].([]interface{}); ok {
			for _, g := range groups {
				if gs, ok := g.(string); ok {
					user.Groups = append(user.Groups, gs)
				}
			}
		}

		return user, nil
	}

	return nil, fmt.Errorf("invalid token")
}

// getString safely extracts a string from claims.
func getString(claims jwt.MapClaims, key string) string {
	if val, ok := claims[key].(string); ok {
		return val
	}
	return ""
}

// adConfigToLDAPConfig converts storage.ADConfig to ldap.Config.
func adConfigToLDAPConfig(config *storage.ADConfig) *ldap.Config {
	ttl := 5 * time.Minute
	if config.GroupCacheTTL != "" {
		if d, err := time.ParseDuration(config.GroupCacheTTL); err == nil {
			ttl = d
		}
	}

	return &ldap.Config{
		Server:              config.Server,
		BaseDN:              config.BaseDN,
		BindDN:              config.BindDN,
		BindPassword:        config.BindPassword,
		UserFilter:          config.UserFilter,
		GroupFilter:         config.GroupFilter,
		UserSearchFilter:    config.UserSearchFilter,
		GroupMembershipAttr: config.GroupMembershipAttr,
		UseTLS:              config.UseTLS,
		InsecureSkipVerify:  config.InsecureSkipVerify,
		KerberosEnabled:     config.KerberosEnabled,
		KerberosKeytab:      config.KerberosKeytab,
		KerberosService:     config.KerberosService,
		KerberosRealm:       config.KerberosRealm,
		GroupCacheTTL:       ttl,
		Enabled:             config.Enabled,
		Configured:          config.Configured,
	}
}

// SessionInfo represents the current user session.
type SessionInfo struct {
	UserID   string   `json:"user_id"`
	Name     string   `json:"name"`
	Email    string   `json:"email"`
	Groups   []string `json:"groups"`
	AuthType string   `json:"auth_type"` // "entra", "ldap", "kerberos", "anonymous"
	LoggedIn bool     `json:"logged_in"`
}

// handleGetSession returns the current user's session info and logs the login event.
// This endpoint should be called by the frontend after successful authentication.
func (a *API) handleGetSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := GetUserFromContext(ctx)

	if user == nil || user.ID == "" || user.ID == "anonymous" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(SessionInfo{
			LoggedIn: false,
			AuthType: "anonymous",
		})
		return
	}

	// Determine auth type based on token issuer or user context
	authType := "unknown"
	if r.Header.Get("Authorization") != "" {
		// Check if it's an Entra token or LDAP token based on claims
		token := ExtractBearerToken(r)
		if token != "" {
			// Simple heuristic: LDAP tokens have "cedar-ldap" issuer
			claims := jwt.MapClaims{}
			parser := jwt.NewParser()
			parsedToken, _, _ := parser.ParseUnverified(token, claims)
			if parsedToken != nil {
				if iss, ok := claims["iss"].(string); ok {
					if iss == "cedar-ldap" {
						authType = "ldap"
					} else if iss != "" && (iss == "https://login.microsoftonline.com" ||
						(len(iss) > 30 && iss[:30] == "https://login.microsoftonline")) ||
						(len(iss) > 25 && iss[:25] == "https://sts.windows.net/") {
						authType = "entra"
					}
				}
			}
		}
	}
	if authType == "unknown" && user.ID != "" {
		authType = "entra" // Default for authenticated users
	}

	// Log the login event (only log if we haven't seen this session recently)
	// Use a simple approach: always log, deduplication can be done at query time
	if a.audits != nil {
		auditCtx := map[string]interface{}{
			"user_id":   user.ID,
			"name":      user.Name,
			"email":     user.Email,
			"auth_type": authType,
		}
		if len(user.Groups) > 0 {
			auditCtx["groups"] = user.Groups
		}
		_ = a.audits.Log(ctx, nil, user.ID, "auth."+authType+".login", "", "", auditCtx)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(SessionInfo{
		UserID:   user.ID,
		Name:     user.Name,
		Email:    user.Email,
		Groups:   user.Groups,
		AuthType: authType,
		LoggedIn: true,
	})
}
