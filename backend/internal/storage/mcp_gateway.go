package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MCPGatewayStatus string

const (
	MCPGatewayStatusPending   MCPGatewayStatus = "pending"
	MCPGatewayStatusApproved  MCPGatewayStatus = "approved"
	MCPGatewayStatusRejected  MCPGatewayStatus = "rejected"
	MCPGatewayStatusSuspended MCPGatewayStatus = "suspended"
)

type MCPGateway struct {
	ID        int64            `json:"id"`
	GatewayID string           `json:"gateway_id"`
	Name      string           `json:"name"`
	Endpoint  string           `json:"endpoint,omitempty"`
	Status    MCPGatewayStatus `json:"status"`
	AuthMode  string           `json:"auth_mode"`

	RequestedAt     time.Time      `json:"requested_at"`
	ApprovedAt      *time.Time     `json:"approved_at,omitempty"`
	ApprovedBy      string         `json:"approved_by,omitempty"`
	RejectedAt      *time.Time     `json:"rejected_at,omitempty"`
	RejectedBy      string         `json:"rejected_by,omitempty"`
	RejectionReason string         `json:"rejection_reason,omitempty"`
	LastHeartbeat   *time.Time     `json:"last_heartbeat,omitempty"`
	Metadata        map[string]any `json:"metadata,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type MCPGatewayRegisterRequest struct {
	GatewayID string         `json:"gateway_id"`
	Name      string         `json:"name"`
	Endpoint  string         `json:"endpoint,omitempty"`
	AuthMode  string         `json:"auth_mode,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type MCPGatewayRepo struct {
	pool *pgxpool.Pool
}

func NewMCPGatewayRepo(pool *pgxpool.Pool) *MCPGatewayRepo {
	return &MCPGatewayRepo{pool: pool}
}

func (r *MCPGatewayRepo) Register(ctx context.Context, req MCPGatewayRegisterRequest) (*MCPGateway, error) {
	if req.GatewayID == "" || req.Name == "" {
		return nil, fmt.Errorf("gateway_id and name are required")
	}
	if req.AuthMode == "" {
		req.AuthMode = "none"
	}
	metaJSON, _ := json.Marshal(req.Metadata)
	if len(metaJSON) == 0 {
		metaJSON = []byte("{}")
	}

	query := `
		INSERT INTO mcp_gateways (
			gateway_id, name, endpoint, auth_mode, last_heartbeat, metadata
		) VALUES ($1, $2, $3, $4, NOW(), $5)
		ON CONFLICT (gateway_id) DO UPDATE SET
			name = EXCLUDED.name,
			endpoint = EXCLUDED.endpoint,
			auth_mode = EXCLUDED.auth_mode,
			last_heartbeat = NOW(),
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
		RETURNING id, gateway_id, name, endpoint, status, auth_mode,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          last_heartbeat, metadata, created_at, updated_at
	`

	return r.scanOne(ctx, query, req.GatewayID, req.Name, req.Endpoint, req.AuthMode, metaJSON)
}

func (r *MCPGatewayRepo) GetByGatewayID(ctx context.Context, gatewayID string) (*MCPGateway, error) {
	query := `
		SELECT id, gateway_id, name, endpoint, status, auth_mode,
		       requested_at, approved_at, approved_by,
		       rejected_at, rejected_by, rejection_reason,
		       last_heartbeat, metadata, created_at, updated_at
		FROM mcp_gateways
		WHERE gateway_id = $1
	`
	gw, err := r.scanOne(ctx, query, gatewayID)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return gw, nil
}

func (r *MCPGatewayRepo) List(ctx context.Context, status *MCPGatewayStatus) ([]MCPGateway, error) {
	query := `
		SELECT id, gateway_id, name, endpoint, status, auth_mode,
		       requested_at, approved_at, approved_by,
		       rejected_at, rejected_by, rejection_reason,
		       last_heartbeat, metadata, created_at, updated_at
		FROM mcp_gateways
	`
	args := []any{}
	if status != nil {
		query += ` WHERE status = $1`
		args = append(args, *status)
	}
	query += ` ORDER BY requested_at DESC`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list mcp gateways: %w", err)
	}
	defer rows.Close()

	items := make([]MCPGateway, 0)
	for rows.Next() {
		item, err := scanGatewayRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, rows.Err()
}

func (r *MCPGatewayRepo) Approve(ctx context.Context, gatewayID, actor string) (*MCPGateway, error) {
	query := `
		UPDATE mcp_gateways SET
			status = 'approved',
			approved_at = NOW(),
			approved_by = $2,
			rejected_at = NULL,
			rejected_by = NULL,
			rejection_reason = NULL
		WHERE gateway_id = $1 AND status IN ('pending', 'suspended')
		RETURNING id, gateway_id, name, endpoint, status, auth_mode,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          last_heartbeat, metadata, created_at, updated_at
	`
	return r.scanOne(ctx, query, gatewayID, actor)
}

func (r *MCPGatewayRepo) Reject(ctx context.Context, gatewayID, actor, reason string) (*MCPGateway, error) {
	query := `
		UPDATE mcp_gateways SET
			status = 'rejected',
			rejected_at = NOW(),
			rejected_by = $2,
			rejection_reason = $3
		WHERE gateway_id = $1 AND status IN ('pending', 'approved', 'suspended')
		RETURNING id, gateway_id, name, endpoint, status, auth_mode,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          last_heartbeat, metadata, created_at, updated_at
	`
	return r.scanOne(ctx, query, gatewayID, actor, reason)
}

func (r *MCPGatewayRepo) Suspend(ctx context.Context, gatewayID string) (*MCPGateway, error) {
	query := `
		UPDATE mcp_gateways SET
			status = 'suspended',
			updated_at = NOW()
		WHERE gateway_id = $1 AND status = 'approved'
		RETURNING id, gateway_id, name, endpoint, status, auth_mode,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          last_heartbeat, metadata, created_at, updated_at
	`
	return r.scanOne(ctx, query, gatewayID)
}

func (r *MCPGatewayRepo) Unsuspend(ctx context.Context, gatewayID string) (*MCPGateway, error) {
	query := `
		UPDATE mcp_gateways SET
			status = 'approved',
			updated_at = NOW()
		WHERE gateway_id = $1 AND status = 'suspended'
		RETURNING id, gateway_id, name, endpoint, status, auth_mode,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          last_heartbeat, metadata, created_at, updated_at
	`
	return r.scanOne(ctx, query, gatewayID)
}

func (r *MCPGatewayRepo) Delete(ctx context.Context, gatewayID string) error {
	result, err := r.pool.Exec(ctx, `DELETE FROM mcp_gateways WHERE gateway_id = $1`, gatewayID)
	if err != nil {
		return fmt.Errorf("delete mcp gateway: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("mcp gateway not found")
	}
	return nil
}

func (r *MCPGatewayRepo) CountByStatus(ctx context.Context) (map[MCPGatewayStatus]int, error) {
	rows, err := r.pool.Query(ctx, `SELECT status, COUNT(*) FROM mcp_gateways GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("count mcp gateways: %w", err)
	}
	defer rows.Close()

	out := make(map[MCPGatewayStatus]int)
	for rows.Next() {
		var s MCPGatewayStatus
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			return nil, err
		}
		out[s] = n
	}
	return out, rows.Err()
}

func (r *MCPGatewayRepo) scanOne(ctx context.Context, query string, args ...any) (*MCPGateway, error) {
	row := r.pool.QueryRow(ctx, query, args...)
	return scanGatewayRow(row)
}

func scanGatewayRow(scanner interface{ Scan(...any) error }) (*MCPGateway, error) {
	var item MCPGateway
	var endpoint, approvedBy, rejectedBy, rejectionReason *string
	var approvedAt, rejectedAt, lastHeartbeat *time.Time
	var metaBytes []byte

	if err := scanner.Scan(
		&item.ID, &item.GatewayID, &item.Name, &endpoint, &item.Status, &item.AuthMode,
		&item.RequestedAt, &approvedAt, &approvedBy,
		&rejectedAt, &rejectedBy, &rejectionReason,
		&lastHeartbeat, &metaBytes, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}

	if endpoint != nil {
		item.Endpoint = *endpoint
	}
	if approvedAt != nil {
		item.ApprovedAt = approvedAt
	}
	if approvedBy != nil {
		item.ApprovedBy = *approvedBy
	}
	if rejectedAt != nil {
		item.RejectedAt = rejectedAt
	}
	if rejectedBy != nil {
		item.RejectedBy = *rejectedBy
	}
	if rejectionReason != nil {
		item.RejectionReason = *rejectionReason
	}
	if lastHeartbeat != nil {
		item.LastHeartbeat = lastHeartbeat
	}
	if len(metaBytes) > 0 {
		_ = json.Unmarshal(metaBytes, &item.Metadata)
	}
	return &item, nil
}
