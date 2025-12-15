package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppPort       string
	DBURL         string
	DBReadURL     string // Optional read replica URL
	DBMaxConns    int32  // Max connections for the pool
	DBMinConns    int32  // Min connections for the pool
	RedisAddr     string
	RedisPass     string
	AuthzCacheTTL time.Duration
	Environment   string
	CORSOrigins   string

	// Authentication configuration
	AuthMode        string // "jwt", "kerberos", or "none"
	APIKey          string // Optional API Key for external read-only access
	AzureTenantID   string // Entra ID tenant ID
	AzureClientID   string // App registration client ID
	AzureAudience   string // Expected token audience
	KerberosKeytab  string // Path to keytab file
	KerberosService string // Service principal (e.g., HTTP/cedar.example.com)

	// Rate Limiting
	RateLimitRequests int           // Max requests per window per caller (0 = disabled)
	RateLimitWindow   time.Duration // Time window for rate limiting
}

// Load reads configuration from environment with sensible defaults.
func Load() Config {
	cfg := Config{
		AppPort:       getenv("APP_PORT", "8080"),
		DBURL:         getenv("DATABASE_URL", "postgres://cedar:cedar@localhost:5432/cedar?sslmode=disable"),
		DBReadURL:     getenv("DATABASE_READ_URL", ""),
		DBMaxConns:    getint("DB_MAX_CONNS", 25), // Default to 25 connections
		DBMinConns:    getint("DB_MIN_CONNS", 5),  // Default to 5 idle connections
		RedisAddr:     getenv("REDIS_ADDR", "localhost:6379"),
		RedisPass:     getenv("REDIS_PASSWORD", ""),
		AuthzCacheTTL: getduration("AUTHZ_CACHE_TTL", 5*time.Second),
		Environment:   getenv("APP_ENV", "development"),
		CORSOrigins:   getenv("CORS_ALLOW_ORIGINS", "*"),

		// Authentication
		AuthMode:        getenv("AUTH_MODE", "none"),
		APIKey:          getenv("API_KEY", ""),
		AzureTenantID:   getenv("AZURE_TENANT_ID", ""),
		AzureClientID:   getenv("AZURE_CLIENT_ID", ""),
		AzureAudience:   getenv("AZURE_AUDIENCE", ""),
		KerberosKeytab:  getenv("KERBEROS_KEYTAB", ""),
		KerberosService: getenv("KERBEROS_SERVICE", ""),

		// Rate Limiting
		RateLimitRequests: int(getint("RATE_LIMIT_REQUESTS", 100)),       // Default: 100 requests
		RateLimitWindow:   getduration("RATE_LIMIT_WINDOW", time.Minute), // Default: per minute
	}
	return cfg
}

func (c Config) Addr() string {
	return fmt.Sprintf(":%s", c.AppPort)
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getduration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func getint(key string, def int32) int32 {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.ParseInt(v, 10, 32); err == nil {
			return int32(i)
		}
	}
	return def
}
