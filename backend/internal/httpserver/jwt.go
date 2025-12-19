package httpserver

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTValidator validates JWT tokens from Entra ID (Azure AD).
type JWTValidator struct {
	tenantID string
	clientID string
	audience string

	jwksURL  string
	issuer   string
	keys     map[string]*rsa.PublicKey
	keysMu   sync.RWMutex
	keysExp  time.Time
	cacheTTL time.Duration
}

// NewJWTValidator creates a new JWT validator for Entra ID.
func NewJWTValidator(tenantID, clientID, audience string) *JWTValidator {
	return &JWTValidator{
		tenantID: tenantID,
		clientID: clientID,
		audience: audience,
		jwksURL:  fmt.Sprintf("https://login.microsoftonline.com/%s/discovery/v2.0/keys", tenantID),
		issuer:   fmt.Sprintf("https://login.microsoftonline.com/%s/v2.0", tenantID),
		keys:     make(map[string]*rsa.PublicKey),
		cacheTTL: 1 * time.Hour,
	}
}

// AzureClaims represents claims from an Entra ID JWT token.
type AzureClaims struct {
	jwt.RegisteredClaims
	PreferredUsername string   `json:"preferred_username"`
	Name              string   `json:"name"`
	Email             string   `json:"email"`
	Groups            []string `json:"groups"`
	Roles             []string `json:"roles"`
	ObjectID          string   `json:"oid"`
	TenantID          string   `json:"tid"`
}

// ValidateToken validates a JWT token and returns user information.
func (v *JWTValidator) ValidateToken(ctx context.Context, tokenString string) (*UserContext, error) {
	// Parse and validate the token
	token, err := jwt.ParseWithClaims(tokenString, &AzureClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Verify signing method
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		// Get key ID from token header
		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("missing kid in token header")
		}

		// Get the public key
		key, err := v.getKey(ctx, kid)
		if err != nil {
			return nil, fmt.Errorf("failed to get signing key: %w", err)
		}

		return key, nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(*AzureClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims type")
	}

	// Validate issuer - accept both v2.0 and v1.0 formats
	expectedIssuerV2 := v.issuer
	expectedIssuerV1 := fmt.Sprintf("https://sts.windows.net/%s/", v.tenantID)
	if claims.Issuer != expectedIssuerV2 && claims.Issuer != expectedIssuerV1 {
		log.Printf("JWT validation: invalid issuer - expected %s or %s, got %s", expectedIssuerV2, expectedIssuerV1, claims.Issuer)
		return nil, fmt.Errorf("invalid issuer: expected %s or %s, got %s", expectedIssuerV2, expectedIssuerV1, claims.Issuer)
	}

	// Validate audience - accept client ID as audience (for ID tokens)
	validAudience := false
	for _, aud := range claims.Audience {
		if aud == v.clientID {
			validAudience = true
			break
		}
		if v.audience != "" && aud == v.audience {
			validAudience = true
			break
		}
	}
	if !validAudience {
		log.Printf("JWT validation: invalid audience - expected %s or %s, got %v", v.clientID, v.audience, claims.Audience)
		return nil, fmt.Errorf("invalid audience: expected %s, got %v", v.clientID, claims.Audience)
	}

	// Build user context
	userID := claims.PreferredUsername
	if userID == "" {
		userID = claims.Email
	}
	if userID == "" {
		userID = claims.ObjectID
	}

	return &UserContext{
		ID:     userID,
		Name:   claims.Name,
		Email:  claims.Email,
		Groups: claims.Groups,
	}, nil
}

// getKey retrieves the public key for the given key ID.
func (v *JWTValidator) getKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.keysMu.RLock()
	if key, ok := v.keys[kid]; ok && time.Now().Before(v.keysExp) {
		v.keysMu.RUnlock()
		return key, nil
	}
	v.keysMu.RUnlock()

	// Refresh keys
	if err := v.refreshKeys(ctx); err != nil {
		return nil, err
	}

	v.keysMu.RLock()
	defer v.keysMu.RUnlock()
	key, ok := v.keys[kid]
	if !ok {
		return nil, fmt.Errorf("key not found: %s", kid)
	}
	return key, nil
}

// refreshKeys fetches the latest JWKS from Entra ID.
func (v *JWTValidator) refreshKeys(ctx context.Context) error {
	v.keysMu.Lock()
	defer v.keysMu.Unlock()

	// Check again in case another goroutine already refreshed
	if time.Now().Before(v.keysExp) {
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS request failed with status: %d", resp.StatusCode)
	}

	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Use string `json:"use"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("failed to decode JWKS: %w", err)
	}

	newKeys := make(map[string]*rsa.PublicKey)
	for _, key := range jwks.Keys {
		if key.Kty != "RSA" || key.Use != "sig" {
			continue
		}

		pubKey, err := parseRSAPublicKey(key.N, key.E)
		if err != nil {
			continue // Skip invalid keys
		}

		newKeys[key.Kid] = pubKey
	}

	v.keys = newKeys
	v.keysExp = time.Now().Add(v.cacheTTL)

	return nil
}

// parseRSAPublicKey parses an RSA public key from base64url-encoded modulus and exponent.
func parseRSAPublicKey(nStr, eStr string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %w", err)
	}

	eBytes, err := base64.RawURLEncoding.DecodeString(eStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %w", err)
	}

	n := new(big.Int).SetBytes(nBytes)
	e := 0
	for _, b := range eBytes {
		e = e<<8 + int(b)
	}

	return &rsa.PublicKey{N: n, E: e}, nil
}

// ExtractBearerToken extracts a Bearer token from the Authorization header.
func ExtractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}

	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}

	return parts[1]
}



