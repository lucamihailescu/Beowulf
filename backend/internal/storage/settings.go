package storage

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

// Setting represents a configuration setting.
type Setting struct {
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	Encrypted   bool      `json:"encrypted"`
	Description string    `json:"description,omitempty"`
	UpdatedBy   string    `json:"updated_by,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// SettingsRepo manages settings in the database.
type SettingsRepo struct {
	db            *DB
	encryptionKey []byte
}

// NewSettingsRepo creates a new settings repository.
// The encryption key is read from SETTINGS_ENCRYPTION_KEY env var.
// If not set, a default key is used (not recommended for production).
func NewSettingsRepo(db *DB) *SettingsRepo {
	key := os.Getenv("SETTINGS_ENCRYPTION_KEY")
	if key == "" {
		// Default key for development - 32 bytes for AES-256
		key = "cedar-default-encryption-key-32"
	}
	
	// Ensure key is 32 bytes for AES-256
	keyBytes := []byte(key)
	if len(keyBytes) < 32 {
		// Pad with zeros
		padded := make([]byte, 32)
		copy(padded, keyBytes)
		keyBytes = padded
	} else if len(keyBytes) > 32 {
		keyBytes = keyBytes[:32]
	}
	
	return &SettingsRepo{
		db:            db,
		encryptionKey: keyBytes,
	}
}

// Get retrieves a setting by key.
func (r *SettingsRepo) Get(ctx context.Context, key string) (*Setting, error) {
	query := `
		SELECT key, value, encrypted, description, updated_by, created_at, updated_at
		FROM settings
		WHERE key = $1
	`
	
	var s Setting
	err := r.db.Reader().QueryRow(ctx, query, key).Scan(
		&s.Key, &s.Value, &s.Encrypted, &s.Description, &s.UpdatedBy, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get setting: %w", err)
	}
	
	// Decrypt if encrypted
	if s.Encrypted {
		decrypted, err := r.decrypt(s.Value)
		if err != nil {
			return nil, fmt.Errorf("decrypt setting: %w", err)
		}
		s.Value = decrypted
	}
	
	return &s, nil
}

// GetValue retrieves just the value for a setting, returning empty string if not found.
func (r *SettingsRepo) GetValue(ctx context.Context, key string) string {
	s, err := r.Get(ctx, key)
	if err != nil || s == nil {
		return ""
	}
	return s.Value
}

// Set creates or updates a setting.
func (r *SettingsRepo) Set(ctx context.Context, key, value, description, updatedBy string, encrypt bool) error {
	storedValue := value
	if encrypt {
		encrypted, err := r.encrypt(value)
		if err != nil {
			return fmt.Errorf("encrypt setting: %w", err)
		}
		storedValue = encrypted
	}
	
	query := `
		INSERT INTO settings (key, value, encrypted, description, updated_by)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (key) DO UPDATE SET
			value = EXCLUDED.value,
			encrypted = EXCLUDED.encrypted,
			description = COALESCE(EXCLUDED.description, settings.description),
			updated_by = EXCLUDED.updated_by,
			updated_at = NOW()
	`
	
	_, err := r.db.Writer().Exec(ctx, query, key, storedValue, encrypt, description, updatedBy)
	if err != nil {
		return fmt.Errorf("set setting: %w", err)
	}
	
	return nil
}

// Delete removes a setting.
func (r *SettingsRepo) Delete(ctx context.Context, key string) error {
	query := `DELETE FROM settings WHERE key = $1`
	_, err := r.db.Writer().Exec(ctx, query, key)
	if err != nil {
		return fmt.Errorf("delete setting: %w", err)
	}
	return nil
}

// List retrieves all settings (values are masked for encrypted settings).
func (r *SettingsRepo) List(ctx context.Context) ([]Setting, error) {
	query := `
		SELECT key, value, encrypted, description, updated_by, created_at, updated_at
		FROM settings
		ORDER BY key
	`
	
	rows, err := r.db.Reader().Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list settings: %w", err)
	}
	defer rows.Close()
	
	var settings []Setting
	for rows.Next() {
		var s Setting
		if err := rows.Scan(&s.Key, &s.Value, &s.Encrypted, &s.Description, &s.UpdatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan setting: %w", err)
		}
		
		// Mask encrypted values
		if s.Encrypted {
			s.Value = "********"
		}
		
		settings = append(settings, s)
	}
	
	return settings, rows.Err()
}

// encrypt encrypts a value using AES-256-GCM.
func (r *SettingsRepo) encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(r.encryptionKey)
	if err != nil {
		return "", err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// decrypt decrypts a value using AES-256-GCM.
func (r *SettingsRepo) decrypt(ciphertext string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	
	block, err := aes.NewCipher(r.encryptionKey)
	if err != nil {
		return "", err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	
	nonce, ciphertextBytes := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return "", err
	}
	
	return string(plaintext), nil
}

// Entra configuration keys
const (
	SettingEntraTenantID     = "entra.tenant_id"
	SettingEntraClientID     = "entra.client_id"
	SettingEntraClientSecret = "entra.client_secret"
	SettingEntraRedirectURI  = "entra.redirect_uri"
	SettingEntraAuthEnabled  = "entra.auth_enabled"
)

// EntraConfig holds Entra ID configuration.
type EntraConfig struct {
	TenantID     string `json:"tenant_id"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret,omitempty"`
	RedirectURI  string `json:"redirect_uri,omitempty"`
	AuthEnabled  bool   `json:"auth_enabled"`
	Configured   bool   `json:"configured"`
}

// GetEntraConfig retrieves the Entra configuration.
func (r *SettingsRepo) GetEntraConfig(ctx context.Context) (*EntraConfig, error) {
	tenantID := r.GetValue(ctx, SettingEntraTenantID)
	clientID := r.GetValue(ctx, SettingEntraClientID)
	clientSecret := r.GetValue(ctx, SettingEntraClientSecret)
	redirectURI := r.GetValue(ctx, SettingEntraRedirectURI)
	authEnabled := r.GetValue(ctx, SettingEntraAuthEnabled) == "true"
	
	return &EntraConfig{
		TenantID:     tenantID,
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURI:  redirectURI,
		AuthEnabled:  authEnabled,
		Configured:   tenantID != "" && clientID != "" && clientSecret != "",
	}, nil
}

// SetEntraConfig saves the Entra configuration.
func (r *SettingsRepo) SetEntraConfig(ctx context.Context, config *EntraConfig, updatedBy string) error {
	if err := r.Set(ctx, SettingEntraTenantID, config.TenantID, "Microsoft Entra Tenant ID", updatedBy, false); err != nil {
		return err
	}
	if err := r.Set(ctx, SettingEntraClientID, config.ClientID, "Microsoft Entra Client ID", updatedBy, false); err != nil {
		return err
	}
	if config.ClientSecret != "" {
		if err := r.Set(ctx, SettingEntraClientSecret, config.ClientSecret, "Microsoft Entra Client Secret (encrypted)", updatedBy, true); err != nil {
			return err
		}
	}
	if config.RedirectURI != "" {
		if err := r.Set(ctx, SettingEntraRedirectURI, config.RedirectURI, "Microsoft Entra Redirect URI for SPA", updatedBy, false); err != nil {
			return err
		}
	}
	authEnabledStr := "false"
	if config.AuthEnabled {
		authEnabledStr = "true"
	}
	if err := r.Set(ctx, SettingEntraAuthEnabled, authEnabledStr, "Enable Entra ID authentication for users", updatedBy, false); err != nil {
		return err
	}
	return nil
}

// DeleteEntraConfig removes all Entra configuration.
func (r *SettingsRepo) DeleteEntraConfig(ctx context.Context) error {
	_ = r.Delete(ctx, SettingEntraTenantID)
	_ = r.Delete(ctx, SettingEntraClientID)
	_ = r.Delete(ctx, SettingEntraClientSecret)
	return nil
}

