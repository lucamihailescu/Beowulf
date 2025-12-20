package storage

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// BackendAuthMode represents the authentication mode for backend instances
type BackendAuthMode string

const (
	BackendAuthModeNone         BackendAuthMode = "none"
	BackendAuthModeSharedSecret BackendAuthMode = "shared_secret"
	BackendAuthModeMTLS         BackendAuthMode = "mtls"
)

// BackendAuthConfig represents the backend authentication configuration
type BackendAuthConfig struct {
	ID               int64           `json:"id"`
	AuthMode         BackendAuthMode `json:"auth_mode"`
	SharedSecretHash string          `json:"-"` // Never expose hash
	ApprovalRequired bool            `json:"approval_required"`

	// mTLS fields
	CACertificate  string     `json:"ca_certificate,omitempty"`
	CAPrivateKey   string     `json:"-"` // Never expose private key
	CASubject      string     `json:"ca_subject,omitempty"`
	CAIssuer       string     `json:"ca_issuer,omitempty"`
	CASerialNumber string     `json:"ca_serial_number,omitempty"`
	CANotBefore    *time.Time `json:"ca_not_before,omitempty"`
	CANotAfter     *time.Time `json:"ca_not_after,omitempty"`
	CAFingerprint  string     `json:"ca_fingerprint,omitempty"`

	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by,omitempty"`
}

// BackendAuthConfigPublic is the public view of the config (no secrets)
type BackendAuthConfigPublic struct {
	AuthMode         BackendAuthMode `json:"auth_mode"`
	ApprovalRequired bool            `json:"approval_required"`
	CAConfigured     bool            `json:"ca_configured,omitempty"`
	CASubject        string          `json:"ca_subject,omitempty"`
	CAIssuer         string          `json:"ca_issuer,omitempty"`
	CANotAfter       *time.Time      `json:"ca_not_after,omitempty"`
	CAFingerprint    string          `json:"ca_fingerprint,omitempty"`
	SecretConfigured bool            `json:"secret_configured,omitempty"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// BackendAuthRepo handles backend auth configuration storage
type BackendAuthRepo struct {
	pool *pgxpool.Pool
}

// NewBackendAuthRepo creates a new BackendAuthRepo
func NewBackendAuthRepo(pool *pgxpool.Pool) *BackendAuthRepo {
	return &BackendAuthRepo{pool: pool}
}

// Get retrieves the current backend auth configuration
func (r *BackendAuthRepo) Get(ctx context.Context) (*BackendAuthConfig, error) {
	query := `
		SELECT id, auth_mode, shared_secret_hash, COALESCE(approval_required, false),
		       ca_certificate, ca_private_key, ca_subject, ca_issuer, ca_serial_number,
		       ca_not_before, ca_not_after, ca_fingerprint,
		       updated_at, updated_by
		FROM backend_auth_config
		LIMIT 1
	`

	var cfg BackendAuthConfig
	var sharedSecretHash, caCert, caKey, caSubject, caIssuer, caSerial, caFingerprint, updatedBy *string
	var caNotBefore, caNotAfter *time.Time

	err := r.pool.QueryRow(ctx, query).Scan(
		&cfg.ID, &cfg.AuthMode, &sharedSecretHash, &cfg.ApprovalRequired,
		&caCert, &caKey, &caSubject, &caIssuer, &caSerial,
		&caNotBefore, &caNotAfter, &caFingerprint,
		&cfg.UpdatedAt, &updatedBy,
	)
	if err == pgx.ErrNoRows {
		// Return default config
		return &BackendAuthConfig{
			AuthMode:  BackendAuthModeNone,
			UpdatedAt: time.Now(),
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get backend auth config: %w", err)
	}

	if sharedSecretHash != nil {
		cfg.SharedSecretHash = *sharedSecretHash
	}
	if caCert != nil {
		cfg.CACertificate = *caCert
	}
	if caKey != nil {
		cfg.CAPrivateKey = *caKey
	}
	if caSubject != nil {
		cfg.CASubject = *caSubject
	}
	if caIssuer != nil {
		cfg.CAIssuer = *caIssuer
	}
	if caSerial != nil {
		cfg.CASerialNumber = *caSerial
	}
	if caFingerprint != nil {
		cfg.CAFingerprint = *caFingerprint
	}
	if updatedBy != nil {
		cfg.UpdatedBy = *updatedBy
	}
	cfg.CANotBefore = caNotBefore
	cfg.CANotAfter = caNotAfter

	return &cfg, nil
}

// GetPublic retrieves the public view of the config (no secrets)
func (r *BackendAuthRepo) GetPublic(ctx context.Context) (*BackendAuthConfigPublic, error) {
	cfg, err := r.Get(ctx)
	if err != nil {
		return nil, err
	}

	return &BackendAuthConfigPublic{
		AuthMode:         cfg.AuthMode,
		ApprovalRequired: cfg.ApprovalRequired,
		CAConfigured:     cfg.CACertificate != "",
		CASubject:        cfg.CASubject,
		CAIssuer:         cfg.CAIssuer,
		CANotAfter:       cfg.CANotAfter,
		CAFingerprint:    cfg.CAFingerprint,
		SecretConfigured: cfg.SharedSecretHash != "",
		UpdatedAt:        cfg.UpdatedAt,
	}, nil
}

// UpdateApprovalRequired updates whether backend approval is required
func (r *BackendAuthRepo) UpdateApprovalRequired(ctx context.Context, required bool, updatedBy string) error {
	query := `
		UPDATE backend_auth_config
		SET approval_required = $1, updated_by = $2
		WHERE id = (SELECT id FROM backend_auth_config LIMIT 1)
	`
	_, err := r.pool.Exec(ctx, query, required, updatedBy)
	return err
}

// UpdateAuthMode updates the authentication mode
func (r *BackendAuthRepo) UpdateAuthMode(ctx context.Context, mode BackendAuthMode, updatedBy string) error {
	query := `
		UPDATE backend_auth_config
		SET auth_mode = $1, updated_by = $2
		WHERE id = (SELECT id FROM backend_auth_config LIMIT 1)
	`
	_, err := r.pool.Exec(ctx, query, mode, updatedBy)
	return err
}

// UpdateSharedSecret updates the shared secret (stores bcrypt hash)
func (r *BackendAuthRepo) UpdateSharedSecret(ctx context.Context, secret string, updatedBy string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash secret: %w", err)
	}

	query := `
		UPDATE backend_auth_config
		SET shared_secret_hash = $1, updated_by = $2
		WHERE id = (SELECT id FROM backend_auth_config LIMIT 1)
	`
	_, err = r.pool.Exec(ctx, query, string(hash), updatedBy)
	return err
}

// UpdateCACertificate updates the CA certificate for mTLS
func (r *BackendAuthRepo) UpdateCACertificate(ctx context.Context, certPEM string, privateKeyPEM string, updatedBy string) error {
	// Parse and validate the certificate
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		return fmt.Errorf("failed to decode PEM block")
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse certificate: %w", err)
	}

	// Validate it's a CA certificate
	if !cert.IsCA {
		return fmt.Errorf("certificate is not a CA certificate")
	}

	// Validate private key if provided
	if privateKeyPEM != "" {
		block, _ := pem.Decode([]byte(privateKeyPEM))
		if block == nil {
			return fmt.Errorf("failed to decode private key PEM block")
		}
		// Basic validation that it parses
		if _, err := x509.ParsePKCS1PrivateKey(block.Bytes); err != nil {
			if _, err := x509.ParsePKCS8PrivateKey(block.Bytes); err != nil {
				return fmt.Errorf("failed to parse private key: %w", err)
			}
		}
	}

	// Calculate fingerprint
	fingerprint := sha256.Sum256(cert.Raw)
	fingerprintHex := hex.EncodeToString(fingerprint[:])

	query := `
		UPDATE backend_auth_config
		SET ca_certificate = $1,
		    ca_private_key = COALESCE(NULLIF($2, ''), ca_private_key),
		    ca_subject = $3,
		    ca_issuer = $4,
		    ca_serial_number = $5,
		    ca_not_before = $6,
		    ca_not_after = $7,
		    ca_fingerprint = $8,
		    updated_by = $9
		WHERE id = (SELECT id FROM backend_auth_config LIMIT 1)
	`

	_, err = r.pool.Exec(ctx, query,
		certPEM,
		privateKeyPEM,
		cert.Subject.String(),
		cert.Issuer.String(),
		cert.SerialNumber.String(),
		cert.NotBefore,
		cert.NotAfter,
		fingerprintHex,
		updatedBy,
	)
	return err
}

// RemoveCACertificate removes the CA certificate
func (r *BackendAuthRepo) RemoveCACertificate(ctx context.Context, updatedBy string) error {
	query := `
		UPDATE backend_auth_config
		SET ca_certificate = NULL,
		    ca_private_key = NULL,
		    ca_subject = NULL,
		    ca_issuer = NULL,
		    ca_serial_number = NULL,
		    ca_not_before = NULL,
		    ca_not_after = NULL,
		    ca_fingerprint = NULL,
		    updated_by = $1
		WHERE id = (SELECT id FROM backend_auth_config LIMIT 1)
	`
	_, err := r.pool.Exec(ctx, query, updatedBy)
	return err
}

// VerifySharedSecret verifies a shared secret against the stored hash
func (r *BackendAuthRepo) VerifySharedSecret(ctx context.Context, secret string) (bool, error) {
	cfg, err := r.Get(ctx)
	if err != nil {
		return false, err
	}

	if cfg.SharedSecretHash == "" {
		return false, fmt.Errorf("no shared secret configured")
	}

	err = bcrypt.CompareHashAndPassword([]byte(cfg.SharedSecretHash), []byte(secret))
	return err == nil, nil
}

// VerifyCertificate verifies a client certificate against the stored CA
func (r *BackendAuthRepo) VerifyCertificate(ctx context.Context, certPEM string) (bool, error) {
	cfg, err := r.Get(ctx)
	if err != nil {
		return false, err
	}

	if cfg.CACertificate == "" {
		return false, fmt.Errorf("no CA certificate configured")
	}

	// Parse CA certificate
	caBlock, _ := pem.Decode([]byte(cfg.CACertificate))
	if caBlock == nil {
		return false, fmt.Errorf("failed to decode CA certificate")
	}

	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		return false, fmt.Errorf("failed to parse CA certificate: %w", err)
	}

	// Parse client certificate
	clientBlock, _ := pem.Decode([]byte(certPEM))
	if clientBlock == nil {
		return false, fmt.Errorf("failed to decode client certificate")
	}

	clientCert, err := x509.ParseCertificate(clientBlock.Bytes)
	if err != nil {
		return false, fmt.Errorf("failed to parse client certificate: %w", err)
	}

	// Create cert pool with CA
	roots := x509.NewCertPool()
	roots.AddCert(caCert)

	// Verify client certificate
	opts := x509.VerifyOptions{
		Roots: roots,
	}

	_, err = clientCert.Verify(opts)
	return err == nil, nil
}

// GetCACertPool returns a certificate pool with the configured CA for TLS verification
func (r *BackendAuthRepo) GetCACertPool(ctx context.Context) (*x509.CertPool, error) {
	cfg, err := r.Get(ctx)
	if err != nil {
		return nil, err
	}

	if cfg.CACertificate == "" {
		return nil, fmt.Errorf("no CA certificate configured")
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(cfg.CACertificate)) {
		return nil, fmt.Errorf("failed to append CA certificate to pool")
	}

	return pool, nil
}
