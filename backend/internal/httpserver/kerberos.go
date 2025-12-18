package httpserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/jcmturner/goidentity/v6"
	"github.com/jcmturner/gokrb5/v8/keytab"
	"github.com/jcmturner/gokrb5/v8/service"
	"github.com/jcmturner/gokrb5/v8/spnego"

	"cedar/internal/ldap"
)

// KerberosValidator validates Kerberos/SPNEGO tokens.
type KerberosValidator struct {
	spnegoSvc  *spnego.SPNEGO
	ldapClient *ldap.Client // Optional: for looking up user groups after auth
}

// NewKerberosValidator creates a new Kerberos validator.
func NewKerberosValidator(keytabPath, servicePrincipal string) (*KerberosValidator, error) {
	kt, err := keytab.Load(keytabPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load keytab: %w", err)
	}

	// Create SPNEGO service with keytab and principal
	svc := spnego.SPNEGOService(kt, service.KeytabPrincipal(servicePrincipal))

	return &KerberosValidator{
		spnegoSvc: svc,
	}, nil
}

// SetLDAPClient sets the LDAP client for looking up user groups after Kerberos auth.
func (v *KerberosValidator) SetLDAPClient(client *ldap.Client) {
	v.ldapClient = client
}

// ValidateRequest validates a SPNEGO/Negotiate token from an HTTP request and returns user information.
func (v *KerberosValidator) ValidateRequest(r *http.Request) (*UserContext, string, error) {
	// Extract Negotiate token from Authorization header
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return nil, "", fmt.Errorf("missing Authorization header")
	}

	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Negotiate") {
		return nil, "", fmt.Errorf("invalid authorization type, expected Negotiate")
	}

	tokenBytes, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode token: %w", err)
	}

	// Unmarshal SPNEGO token
	var st spnego.SPNEGOToken
	if err := st.Unmarshal(tokenBytes); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal SPNEGO token: %w", err)
	}

	// Validate the token using AcceptSecContext
	valid, ctx, status := v.spnegoSvc.AcceptSecContext(&st)
	if !valid {
		return nil, "", fmt.Errorf("SPNEGO token validation failed: %v", status)
	}

	// Get identity from context using goidentity context key
	id := ctx.Value(goidentity.CTXKey)
	if id == nil {
		return nil, "", fmt.Errorf("no credentials in context after authentication")
	}

	identity, ok := id.(goidentity.Identity)
	if !ok {
		return nil, "", fmt.Errorf("invalid identity type in context")
	}

	// Extract user information
	principalName := identity.UserName()
	domain := identity.Domain()

	// Build full principal name
	fullName := principalName
	if domain != "" {
		fullName = principalName + "@" + domain
	}

	// Get response token if present (for mutual auth)
	respToken := ""
	if st.NegTokenResp.ResponseToken != nil {
		respToken = base64.StdEncoding.EncodeToString(st.NegTokenResp.ResponseToken)
	}

	user := &UserContext{
		ID:     fullName,
		Name:   principalName,
		Email:  "",  // Kerberos doesn't provide email directly
		Groups: nil,
	}

	// If we have an LDAP client, look up the user's groups and additional info
	if v.ldapClient != nil && v.ldapClient.IsConfigured() {
		// Try to extract sAMAccountName from principal (username@REALM -> username)
		username := principalName
		if idx := strings.Index(principalName, "@"); idx > 0 {
			username = principalName[:idx]
		}

		// Look up the user in LDAP
		ldapUser, err := v.ldapClient.GetUserByUsername(context.Background(), username)
		if err != nil {
			log.Printf("Kerberos: failed to look up user %s in LDAP: %v", username, err)
		} else if ldapUser != nil {
			user.Name = ldapUser.DisplayName
			user.Email = ldapUser.Mail
			user.Groups = ldapUser.Groups
		}
	}

	return user, respToken, nil
}

// ExtractNegotiateToken extracts a Negotiate token from the Authorization header.
func ExtractNegotiateToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}

	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Negotiate") {
		return ""
	}

	return parts[1]
}

// IsNegotiateAuth checks if the request uses Negotiate authentication.
func IsNegotiateAuth(r *http.Request) bool {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return false
	}

	parts := strings.SplitN(auth, " ", 2)
	return len(parts) >= 1 && strings.EqualFold(parts[0], "Negotiate")
}
