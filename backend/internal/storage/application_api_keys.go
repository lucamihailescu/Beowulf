package storage

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	defaultAppAPIKeyName = "default"
)

// ApplicationAPIKey holds API key metadata. The plaintext key is never persisted.
type ApplicationAPIKey struct {
	ID            int64      `json:"id"`
	ApplicationID int64      `json:"application_id"`
	Name          string     `json:"name"`
	KeyPrefix     string     `json:"key_prefix"`
	CreatedBy     string     `json:"created_by,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	LastUsedAt    *time.Time `json:"last_used_at,omitempty"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	RevokedBy     string     `json:"revoked_by,omitempty"`
}

// AuthenticatedApplicationAPIKey is returned for successful API key authentication.
type AuthenticatedApplicationAPIKey struct {
	ApplicationAPIKey
}

// CreateApplicationAPIKeyResult returns metadata and one-time plaintext key.
type CreateApplicationAPIKeyResult struct {
	ApplicationAPIKey
	PlaintextKey string `json:"api_key"`
}

// ApplicationAPIKeyRepo manages per-application runtime API keys.
type ApplicationAPIKeyRepo struct {
	db *DB
}

// NewApplicationAPIKeyRepo constructs an API key repository.
func NewApplicationAPIKeyRepo(db *DB) *ApplicationAPIKeyRepo {
	return &ApplicationAPIKeyRepo{db: db}
}

// CreateInitialKey creates an initial key for a newly created application.
func (r *ApplicationAPIKeyRepo) CreateInitialKey(ctx context.Context, applicationID int64, actor string) (*CreateApplicationAPIKeyResult, error) {
	return r.CreateKey(ctx, applicationID, defaultAppAPIKeyName, actor)
}

// CreateKey creates a new API key for an application and returns plaintext once.
func (r *ApplicationAPIKeyRepo) CreateKey(ctx context.Context, applicationID int64, name, actor string) (*CreateApplicationAPIKeyResult, error) {
	keyName := strings.TrimSpace(name)
	if keyName == "" {
		keyName = defaultAppAPIKeyName
	}
	if strings.TrimSpace(actor) == "" {
		actor = "system"
	}

	plaintext, prefix, err := generateApplicationAPIKey(applicationID)
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash API key: %w", err)
	}

	var out CreateApplicationAPIKeyResult
	err = r.db.Writer().QueryRow(ctx, `
		INSERT INTO application_api_keys (application_id, name, key_prefix, key_hash, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, application_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at, COALESCE(revoked_by, '')
	`, applicationID, keyName, prefix, string(hash), actor).Scan(
		&out.ID, &out.ApplicationID, &out.Name, &out.KeyPrefix, &out.CreatedBy, &out.CreatedAt, &out.LastUsedAt, &out.RevokedAt, &out.RevokedBy,
	)
	if err != nil {
		return nil, fmt.Errorf("create application API key: %w", err)
	}
	out.PlaintextKey = plaintext
	return &out, nil
}

// ListKeys returns API key metadata for an application.
func (r *ApplicationAPIKeyRepo) ListKeys(ctx context.Context, applicationID int64) ([]ApplicationAPIKey, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT id, application_id, name, key_prefix, COALESCE(created_by, ''), created_at, last_used_at, revoked_at, COALESCE(revoked_by, '')
		FROM application_api_keys
		WHERE application_id = $1
		ORDER BY created_at DESC
	`, applicationID)
	if err != nil {
		return nil, fmt.Errorf("list application API keys: %w", err)
	}
	defer rows.Close()

	out := make([]ApplicationAPIKey, 0)
	for rows.Next() {
		var item ApplicationAPIKey
		if err := rows.Scan(
			&item.ID, &item.ApplicationID, &item.Name, &item.KeyPrefix, &item.CreatedBy, &item.CreatedAt, &item.LastUsedAt, &item.RevokedAt, &item.RevokedBy,
		); err != nil {
			return nil, fmt.Errorf("scan application API key: %w", err)
		}
		out = append(out, item)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate application API keys: %w", rows.Err())
	}
	return out, nil
}

// RevokeKey revokes a key for an application.
func (r *ApplicationAPIKeyRepo) RevokeKey(ctx context.Context, applicationID, keyID int64, actor string) error {
	if strings.TrimSpace(actor) == "" {
		actor = "system"
	}
	res, err := r.db.Writer().Exec(ctx, `
		UPDATE application_api_keys
		SET revoked_at = NOW(), revoked_by = $1
		WHERE id = $2 AND application_id = $3 AND revoked_at IS NULL
	`, actor, keyID, applicationID)
	if err != nil {
		return fmt.Errorf("revoke application API key: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("application API key not found or already revoked")
	}
	return nil
}

// AuthenticateKey authenticates an API key and returns app binding metadata.
func (r *ApplicationAPIKeyRepo) AuthenticateKey(ctx context.Context, rawKey string) (*AuthenticatedApplicationAPIKey, error) {
	prefix, err := parseApplicationAPIKeyPrefix(rawKey)
	if err != nil {
		return nil, nil
	}

	var out AuthenticatedApplicationAPIKey
	var keyHash string
	err = r.db.Reader().QueryRow(ctx, `
		SELECT id, application_id, name, key_prefix, COALESCE(created_by, ''), created_at, last_used_at, revoked_at, COALESCE(revoked_by, ''), key_hash
		FROM application_api_keys
		WHERE key_prefix = $1 AND revoked_at IS NULL
		LIMIT 1
	`, prefix).Scan(
		&out.ID, &out.ApplicationID, &out.Name, &out.KeyPrefix, &out.CreatedBy, &out.CreatedAt, &out.LastUsedAt, &out.RevokedAt, &out.RevokedBy, &keyHash,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup application API key: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(keyHash), []byte(rawKey)); err != nil {
		return nil, nil
	}

	// Best-effort usage timestamp update off critical decision path.
	go func(id int64) {
		updateCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = r.MarkKeyUsed(updateCtx, id)
	}(out.ID)

	return &out, nil
}

// MarkKeyUsed updates the usage timestamp for an API key.
func (r *ApplicationAPIKeyRepo) MarkKeyUsed(ctx context.Context, keyID int64) error {
	_, err := r.db.Writer().Exec(ctx, `
		UPDATE application_api_keys
		SET last_used_at = NOW()
		WHERE id = $1
	`, keyID)
	if err != nil {
		return fmt.Errorf("mark application API key used: %w", err)
	}
	return nil
}

func generateApplicationAPIKey(applicationID int64) (fullKey, prefix string, err error) {
	prefixRand, err := randomURLToken(6)
	if err != nil {
		return "", "", fmt.Errorf("generate API key prefix: %w", err)
	}
	secretRand, err := randomURLToken(24)
	if err != nil {
		return "", "", fmt.Errorf("generate API key secret: %w", err)
	}

	prefix = fmt.Sprintf("cedar_app_%d_%s", applicationID, prefixRand)
	fullKey = prefix + "." + secretRand
	return fullKey, prefix, nil
}

func parseApplicationAPIKeyPrefix(rawKey string) (string, error) {
	key := strings.TrimSpace(rawKey)
	if key == "" {
		return "", fmt.Errorf("empty key")
	}
	parts := strings.SplitN(key, ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", fmt.Errorf("invalid key format")
	}
	if !strings.HasPrefix(parts[0], "cedar_app_") {
		return "", fmt.Errorf("invalid key prefix")
	}
	return parts[0], nil
}

func randomURLToken(byteLen int) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
