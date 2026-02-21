package storage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MCPDelegationStatus string

const (
	MCPDelegationStatusActive  MCPDelegationStatus = "active"
	MCPDelegationStatusRevoked MCPDelegationStatus = "revoked"
	MCPDelegationStatusExpired MCPDelegationStatus = "expired"
)

type MCPDelegationGrant struct {
	ID                  int64               `json:"id"`
	GrantID             string              `json:"grant_id"`
	ApplicationID       int64               `json:"application_id"`
	GatewayID           string              `json:"gateway_id,omitempty"`
	DelegatorType       string              `json:"delegator_type"`
	DelegatorID         string              `json:"delegator_id"`
	DelegateType        string              `json:"delegate_type"`
	DelegateID          string              `json:"delegate_id"`
	ScopeAction         string              `json:"scope_action"`
	ScopeResourcePrefix string              `json:"scope_resource_prefix,omitempty"`
	Status              MCPDelegationStatus `json:"status"`
	IssuedAt            time.Time           `json:"issued_at"`
	ExpiresAt           time.Time           `json:"expires_at"`
	RevokedAt           *time.Time          `json:"revoked_at,omitempty"`
	RevokedBy           string              `json:"revoked_by,omitempty"`
	Metadata            map[string]any      `json:"metadata,omitempty"`
	CreatedAt           time.Time           `json:"created_at"`
	UpdatedAt           time.Time           `json:"updated_at"`
}

type MCPDelegationCreateRequest struct {
	ApplicationID       int64          `json:"application_id"`
	GatewayID           string         `json:"gateway_id,omitempty"`
	DelegatorType       string         `json:"delegator_type"`
	DelegatorID         string         `json:"delegator_id"`
	DelegateType        string         `json:"delegate_type"`
	DelegateID          string         `json:"delegate_id"`
	ScopeAction         string         `json:"scope_action,omitempty"`
	ScopeResourcePrefix string         `json:"scope_resource_prefix,omitempty"`
	ExpiresAt           time.Time      `json:"expires_at"`
	Metadata            map[string]any `json:"metadata,omitempty"`
}

type MCPDelegationIssueResult struct {
	Grant MCPDelegationGrant `json:"grant"`
	Token string             `json:"token"`
}

type MCPDelegationRepo struct {
	pool *pgxpool.Pool
}

func NewMCPDelegationRepo(pool *pgxpool.Pool) *MCPDelegationRepo {
	return &MCPDelegationRepo{pool: pool}
}

func (r *MCPDelegationRepo) Create(ctx context.Context, req MCPDelegationCreateRequest) (*MCPDelegationIssueResult, error) {
	if req.ApplicationID == 0 || req.DelegatorType == "" || req.DelegatorID == "" || req.DelegateType == "" || req.DelegateID == "" {
		return nil, fmt.Errorf("application_id, delegator, and delegate are required")
	}
	if req.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("expires_at is required")
	}
	if req.ScopeAction == "" {
		req.ScopeAction = "tool.invoke"
	}
	grantID := "mcp-grant-" + randomHex(8)
	token := "mcpdel_" + randomHex(24)
	tokenHash := hashToken(token)
	metaJSON, _ := json.Marshal(req.Metadata)
	if len(metaJSON) == 0 {
		metaJSON = []byte("{}")
	}

	query := `
		INSERT INTO mcp_delegation_grants (
			grant_id, token_hash, application_id, gateway_id,
			delegator_type, delegator_id, delegate_type, delegate_id,
			scope_action, scope_resource_prefix, status, expires_at, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12)
		RETURNING id, grant_id, application_id, gateway_id,
		          delegator_type, delegator_id, delegate_type, delegate_id,
		          scope_action, scope_resource_prefix, status, issued_at, expires_at,
		          revoked_at, revoked_by, metadata, created_at, updated_at
	`
	grant, err := r.scanOne(ctx, query,
		grantID, tokenHash, req.ApplicationID, req.GatewayID,
		req.DelegatorType, req.DelegatorID, req.DelegateType, req.DelegateID,
		req.ScopeAction, req.ScopeResourcePrefix, req.ExpiresAt, metaJSON,
	)
	if err != nil {
		return nil, err
	}
	return &MCPDelegationIssueResult{Grant: *grant, Token: token}, nil
}

func (r *MCPDelegationRepo) GetByGrantID(ctx context.Context, grantID string) (*MCPDelegationGrant, error) {
	query := `
		SELECT id, grant_id, application_id, gateway_id,
		       delegator_type, delegator_id, delegate_type, delegate_id,
		       scope_action, scope_resource_prefix, status, issued_at, expires_at,
		       revoked_at, revoked_by, metadata, created_at, updated_at
		FROM mcp_delegation_grants
		WHERE grant_id = $1
	`
	item, err := r.scanOne(ctx, query, grantID)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return item, err
}

func (r *MCPDelegationRepo) IntrospectToken(ctx context.Context, token string) (*MCPDelegationGrant, error) {
	query := `
		SELECT id, grant_id, application_id, gateway_id,
		       delegator_type, delegator_id, delegate_type, delegate_id,
		       scope_action, scope_resource_prefix, status, issued_at, expires_at,
		       revoked_at, revoked_by, metadata, created_at, updated_at
		FROM mcp_delegation_grants
		WHERE token_hash = $1
	`
	item, err := r.scanOne(ctx, query, hashToken(token))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if item.Status == MCPDelegationStatusRevoked {
		return nil, nil
	}
	if time.Now().After(item.ExpiresAt) {
		_, _ = r.pool.Exec(ctx, `
			UPDATE mcp_delegation_grants
			SET status = 'expired', updated_at = NOW()
			WHERE id = $1 AND status = 'active'
		`, item.ID)
		return nil, nil
	}
	return item, nil
}

func (r *MCPDelegationRepo) Revoke(ctx context.Context, grantID, actor string) (*MCPDelegationGrant, error) {
	query := `
		UPDATE mcp_delegation_grants SET
			status = 'revoked',
			revoked_at = NOW(),
			revoked_by = $2,
			updated_at = NOW()
		WHERE grant_id = $1 AND status = 'active'
		RETURNING id, grant_id, application_id, gateway_id,
		          delegator_type, delegator_id, delegate_type, delegate_id,
		          scope_action, scope_resource_prefix, status, issued_at, expires_at,
		          revoked_at, revoked_by, metadata, created_at, updated_at
	`
	return r.scanOne(ctx, query, grantID, actor)
}

func (r *MCPDelegationRepo) List(ctx context.Context, appID *int64, status *MCPDelegationStatus, limit, offset int) ([]MCPDelegationGrant, error) {
	where := " WHERE 1=1"
	args := []any{}
	argN := 1
	if appID != nil {
		where += fmt.Sprintf(" AND application_id = $%d", argN)
		args = append(args, *appID)
		argN++
	}
	if status != nil {
		where += fmt.Sprintf(" AND status = $%d", argN)
		args = append(args, *status)
		argN++
	}
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := fmt.Sprintf(`
		SELECT id, grant_id, application_id, gateway_id,
		       delegator_type, delegator_id, delegate_type, delegate_id,
		       scope_action, scope_resource_prefix, status, issued_at, expires_at,
		       revoked_at, revoked_by, metadata, created_at, updated_at
		FROM mcp_delegation_grants
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, argN, argN+1)
	args = append(args, limit, offset)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]MCPDelegationGrant, 0)
	for rows.Next() {
		item, err := scanDelegationRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, rows.Err()
}

func (r *MCPDelegationRepo) scanOne(ctx context.Context, query string, args ...any) (*MCPDelegationGrant, error) {
	return scanDelegationRow(r.pool.QueryRow(ctx, query, args...))
}

func scanDelegationRow(scanner interface{ Scan(...any) error }) (*MCPDelegationGrant, error) {
	var item MCPDelegationGrant
	var gatewayID, scopePrefix, revokedBy *string
	var metadataBytes []byte

	if err := scanner.Scan(
		&item.ID, &item.GrantID, &item.ApplicationID, &gatewayID,
		&item.DelegatorType, &item.DelegatorID, &item.DelegateType, &item.DelegateID,
		&item.ScopeAction, &scopePrefix, &item.Status, &item.IssuedAt, &item.ExpiresAt,
		&item.RevokedAt, &revokedBy, &metadataBytes, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if gatewayID != nil {
		item.GatewayID = *gatewayID
	}
	if scopePrefix != nil {
		item.ScopeResourcePrefix = *scopePrefix
	}
	if revokedBy != nil {
		item.RevokedBy = *revokedBy
	}
	if len(metadataBytes) > 0 {
		_ = json.Unmarshal(metadataBytes, &item.Metadata)
	}
	return &item, nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
