package httpserver

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/httprate"

	"cedar/internal/config"
)

// UserContext contains authenticated user information.
type UserContext struct {
	ID     string   `json:"id"`     // User principal name or email
	Name   string   `json:"name"`   // Display name
	Email  string   `json:"email"`  // Email address
	Groups []string `json:"groups"` // Group memberships from token
}

// contextKey is a custom type for context keys to avoid collisions.
type contextKey string

const (
	// UserContextKey is the context key for storing user information.
	UserContextKey contextKey = "user"
)

// GetUserFromContext retrieves the authenticated user from the request context.
func GetUserFromContext(ctx context.Context) *UserContext {
	user, ok := ctx.Value(UserContextKey).(*UserContext)
	if !ok {
		return nil
	}
	return user
}

// AuthMiddleware provides authentication middleware based on configuration.
type AuthMiddleware struct {
	mode           string
	apiKey         string
	jwtValidator   *JWTValidator
	kerbValidator  *KerberosValidator
}

// NewAuthMiddleware creates a new authentication middleware.
func NewAuthMiddleware(cfg config.Config) (*AuthMiddleware, error) {
	am := &AuthMiddleware{
		mode:   strings.ToLower(cfg.AuthMode),
		apiKey: cfg.APIKey,
	}

	switch am.mode {
	case "jwt":
		if cfg.AzureTenantID == "" || cfg.AzureClientID == "" {
			log.Println("Warning: JWT auth mode requires AZURE_TENANT_ID and AZURE_CLIENT_ID")
		}
		am.jwtValidator = NewJWTValidator(cfg.AzureTenantID, cfg.AzureClientID, cfg.AzureAudience)

	case "kerberos":
		if cfg.KerberosKeytab == "" || cfg.KerberosService == "" {
			log.Println("Warning: Kerberos auth mode requires KERBEROS_KEYTAB and KERBEROS_SERVICE")
		} else {
			kv, err := NewKerberosValidator(cfg.KerberosKeytab, cfg.KerberosService)
			if err != nil {
				log.Printf("Warning: Failed to initialize Kerberos validator: %v", err)
			} else {
				am.kerbValidator = kv
			}
		}

	case "none", "":
		log.Println("Authentication disabled (AUTH_MODE=none)")

	default:
		log.Printf("Unknown auth mode: %s, falling back to none", cfg.AuthMode)
		am.mode = "none"
	}

	return am, nil
}

// Middleware returns an http.Handler middleware that performs authentication.
func (am *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check
		if r.URL.Path == "/health" || r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}

		// Check for API Key Authentication
		if am.apiKey != "" {
			if key := r.Header.Get("X-API-Key"); key != "" {
				if key == am.apiKey {
					// Enforce Read-Only for API Key
					if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusForbidden)
						_ = json.NewEncoder(w).Encode(map[string]string{
							"error": "API Key allows read-only access only",
						})
						return
					}

					// Authenticated via API Key
					ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
						ID:     "api-key",
						Name:   "External System",
						Groups: []string{"ReadOnly"},
					})
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}

				// Invalid key provided - reject immediately
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{
					"error": "Invalid API Key",
				})
				return
			}
		}

		// If auth is disabled, create anonymous user and continue
		if am.mode == "none" || am.mode == "" {
			ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
				ID:   "anonymous",
				Name: "Anonymous User",
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		var user *UserContext
		var err error

		switch am.mode {
		case "jwt":
			user, err = am.validateJWT(r)
		case "kerberos":
			user, err = am.validateKerberos(r)
		}

		if err != nil {
			am.handleAuthError(w, r, err)
			return
		}

		if user == nil {
			am.handleAuthError(w, r, nil)
			return
		}

		// Add user to context
		ctx := context.WithValue(r.Context(), UserContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// validateJWT validates a JWT Bearer token.
func (am *AuthMiddleware) validateJWT(r *http.Request) (*UserContext, error) {
	token := ExtractBearerToken(r)
	if token == "" {
		return nil, nil // No token provided
	}

	if am.jwtValidator == nil {
		return nil, nil
	}

	return am.jwtValidator.ValidateToken(r.Context(), token)
}

// validateKerberos validates a Kerberos/SPNEGO token.
func (am *AuthMiddleware) validateKerberos(r *http.Request) (*UserContext, error) {
	if am.kerbValidator == nil {
		return nil, nil
	}

	if !IsNegotiateAuth(r) {
		return nil, nil // No Negotiate token provided
	}

	user, _, err := am.kerbValidator.ValidateRequest(r)
	if err != nil {
		return nil, err
	}
	return user, nil
}

// handleAuthError sends an appropriate authentication error response.
func (am *AuthMiddleware) handleAuthError(w http.ResponseWriter, _ *http.Request, err error) {
	w.Header().Set("Content-Type", "application/json")

	switch am.mode {
	case "jwt":
		w.Header().Set("WWW-Authenticate", "Bearer")
	case "kerberos":
		w.Header().Set("WWW-Authenticate", "Negotiate")
	}

	w.WriteHeader(http.StatusUnauthorized)

	errMsg := "Authentication required"
	if err != nil {
		errMsg = err.Error()
	}

	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": errMsg,
	})
}

// RequireAuth creates a middleware that requires authentication.
// This is useful for routes that should never be accessed anonymously.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUserFromContext(r.Context())
		if user == nil || user.ID == "anonymous" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "Authentication required",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// NewRateLimiter creates a rate limiting middleware based on configuration.
// Rate limiting is per authenticated caller (user ID).
// Returns nil if rate limiting is disabled (RateLimitRequests == 0).
func NewRateLimiter(cfg config.Config) func(http.Handler) http.Handler {
	if cfg.RateLimitRequests <= 0 {
		log.Println("Rate limiting disabled (RATE_LIMIT_REQUESTS=0)")
		return nil
	}

	log.Printf("Rate limiting enabled: %d requests per %v per caller", cfg.RateLimitRequests, cfg.RateLimitWindow)

	limiter := httprate.Limit(
		cfg.RateLimitRequests,
		cfg.RateLimitWindow,
		httprate.WithKeyFuncs(func(r *http.Request) (string, error) {
			// Rate limit by authenticated user ID
			user := GetUserFromContext(r.Context())
			if user != nil && user.ID != "" {
				return user.ID, nil
			}
			// Fall back to IP for unauthenticated requests
			return httprate.KeyByIP(r)
		}),
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "Rate limit exceeded. Please slow down.",
			})
		}),
	)

	// Wrap to exclude certain paths from rate limiting
	return func(next http.Handler) http.Handler {
		limited := limiter(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			// Skip rate limiting for SSE, health checks, and cluster status
			if path == "/v1/events" || path == "/health" || strings.HasPrefix(path, "/v1/cluster/") {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

// RateLimitWindow returns the window duration for rate limiting headers.
func RateLimitWindow(cfg config.Config) time.Duration {
	return cfg.RateLimitWindow
}
