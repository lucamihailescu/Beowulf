package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MCPApprovalStatus string

const (
	MCPApprovalStatusPending  MCPApprovalStatus = "pending"
	MCPApprovalStatusApproved MCPApprovalStatus = "approved"
	MCPApprovalStatusRejected MCPApprovalStatus = "rejected"
	MCPApprovalStatusExpired  MCPApprovalStatus = "expired"
)

type MCPApprovalRequest struct {
	ID              int64             `json:"id"`
	RequestID       string            `json:"request_id"`
	ApplicationID   *int64            `json:"application_id,omitempty"`
	GatewayID       string            `json:"gateway_id"`
	PrincipalType   string            `json:"principal_type"`
	PrincipalID     string            `json:"principal_id"`
	Action          string            `json:"action"`
	Resource        string            `json:"resource"`
	ToolServer      string            `json:"tool_server"`
	ToolName        string            `json:"tool_name"`
	Status          MCPApprovalStatus `json:"status"`
	RequestedBy     string            `json:"requested_by,omitempty"`
	Reason          string            `json:"reason,omitempty"`
	DecisionCtx     map[string]any    `json:"decision_context,omitempty"`
	ExpiresAt       *time.Time        `json:"expires_at,omitempty"`
	ApprovedAt      *time.Time        `json:"approved_at,omitempty"`
	ApprovedBy      string            `json:"approved_by,omitempty"`
	RejectedAt      *time.Time        `json:"rejected_at,omitempty"`
	RejectedBy      string            `json:"rejected_by,omitempty"`
	RejectionReason string            `json:"rejection_reason,omitempty"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

type MCPApprovalCreateRequest struct {
	RequestID     string         `json:"request_id,omitempty"`
	ApplicationID *int64         `json:"application_id,omitempty"`
	GatewayID     string         `json:"gateway_id"`
	PrincipalType string         `json:"principal_type"`
	PrincipalID   string         `json:"principal_id"`
	Action        string         `json:"action"`
	Resource      string         `json:"resource"`
	ToolServer    string         `json:"tool_server"`
	ToolName      string         `json:"tool_name"`
	RequestedBy   string         `json:"requested_by,omitempty"`
	Reason        string         `json:"reason,omitempty"`
	DecisionCtx   map[string]any `json:"decision_context,omitempty"`
	ExpiresAt     *time.Time     `json:"expires_at,omitempty"`
}

type MCPApprovalFilter struct {
	Status        *MCPApprovalStatus
	ApplicationID *int64
	GatewayID     string
	Limit         int
	Offset        int
}

type MCPApprovalRepo struct {
	pool *pgxpool.Pool
}

func NewMCPApprovalRepo(pool *pgxpool.Pool) *MCPApprovalRepo {
	return &MCPApprovalRepo{pool: pool}
}

func (r *MCPApprovalRepo) Create(ctx context.Context, req MCPApprovalCreateRequest) (*MCPApprovalRequest, error) {
	if req.GatewayID == "" || req.PrincipalType == "" || req.PrincipalID == "" || req.Action == "" || req.Resource == "" || req.ToolServer == "" || req.ToolName == "" {
		return nil, fmt.Errorf("gateway_id, principal, action, resource, tool_server, and tool_name are required")
	}
	if req.RequestID == "" {
		req.RequestID = newApprovalRequestID()
	}
	metaJSON, _ := json.Marshal(req.DecisionCtx)
	if len(metaJSON) == 0 {
		metaJSON = []byte("{}")
	}

	query := `
		INSERT INTO mcp_approval_requests (
			request_id, application_id, gateway_id,
			principal_type, principal_id, action, resource,
			tool_server, tool_name, status, requested_by, reason, decision_context, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13)
		RETURNING id, request_id, application_id, gateway_id,
		          principal_type, principal_id, action, resource,
		          tool_server, tool_name, status, requested_by, reason,
		          decision_context, expires_at,
		          approved_at, approved_by, rejected_at, rejected_by, rejection_reason,
		          created_at, updated_at
	`
	return r.scanOne(ctx, query,
		req.RequestID, req.ApplicationID, req.GatewayID,
		req.PrincipalType, req.PrincipalID, req.Action, req.Resource,
		req.ToolServer, req.ToolName, req.RequestedBy, req.Reason, metaJSON, req.ExpiresAt,
	)
}

func (r *MCPApprovalRepo) GetByRequestID(ctx context.Context, requestID string) (*MCPApprovalRequest, error) {
	query := `
		SELECT id, request_id, application_id, gateway_id,
		       principal_type, principal_id, action, resource,
		       tool_server, tool_name, status, requested_by, reason,
		       decision_context, expires_at,
		       approved_at, approved_by, rejected_at, rejected_by, rejection_reason,
		       created_at, updated_at
		FROM mcp_approval_requests
		WHERE request_id = $1
	`
	item, err := r.scanOne(ctx, query, requestID)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return item, err
}

func (r *MCPApprovalRepo) List(ctx context.Context, filter MCPApprovalFilter) ([]MCPApprovalRequest, int, error) {
	where := " WHERE 1=1"
	args := []any{}
	argN := 1
	if filter.Status != nil {
		where += fmt.Sprintf(" AND status = $%d", argN)
		args = append(args, *filter.Status)
		argN++
	}
	if filter.ApplicationID != nil {
		where += fmt.Sprintf(" AND application_id = $%d", argN)
		args = append(args, *filter.ApplicationID)
		argN++
	}
	if filter.GatewayID != "" {
		where += fmt.Sprintf(" AND gateway_id = $%d", argN)
		args = append(args, filter.GatewayID)
		argN++
	}

	var total int
	countQuery := "SELECT COUNT(*) FROM mcp_approval_requests" + where
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count mcp approvals: %w", err)
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	query := fmt.Sprintf(`
		SELECT id, request_id, application_id, gateway_id,
		       principal_type, principal_id, action, resource,
		       tool_server, tool_name, status, requested_by, reason,
		       decision_context, expires_at,
		       approved_at, approved_by, rejected_at, rejected_by, rejection_reason,
		       created_at, updated_at
		FROM mcp_approval_requests
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, argN, argN+1)
	args = append(args, limit, offset)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list mcp approvals: %w", err)
	}
	defer rows.Close()

	items := make([]MCPApprovalRequest, 0)
	for rows.Next() {
		item, err := scanApprovalRow(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, *item)
	}
	return items, total, rows.Err()
}

func (r *MCPApprovalRepo) Approve(ctx context.Context, requestID, actor string) (*MCPApprovalRequest, error) {
	query := `
		UPDATE mcp_approval_requests SET
			status = 'approved',
			approved_at = NOW(),
			approved_by = $2
		WHERE request_id = $1 AND status = 'pending'
		RETURNING id, request_id, application_id, gateway_id,
		          principal_type, principal_id, action, resource,
		          tool_server, tool_name, status, requested_by, reason,
		          decision_context, expires_at,
		          approved_at, approved_by, rejected_at, rejected_by, rejection_reason,
		          created_at, updated_at
	`
	return r.scanOne(ctx, query, requestID, actor)
}

func (r *MCPApprovalRepo) Reject(ctx context.Context, requestID, actor, reason string) (*MCPApprovalRequest, error) {
	query := `
		UPDATE mcp_approval_requests SET
			status = 'rejected',
			rejected_at = NOW(),
			rejected_by = $2,
			rejection_reason = $3
		WHERE request_id = $1 AND status = 'pending'
		RETURNING id, request_id, application_id, gateway_id,
		          principal_type, principal_id, action, resource,
		          tool_server, tool_name, status, requested_by, reason,
		          decision_context, expires_at,
		          approved_at, approved_by, rejected_at, rejected_by, rejection_reason,
		          created_at, updated_at
	`
	return r.scanOne(ctx, query, requestID, actor, reason)
}

func (r *MCPApprovalRepo) Expire(ctx context.Context, requestID string) (*MCPApprovalRequest, error) {
	query := `
		UPDATE mcp_approval_requests SET
			status = 'expired',
			updated_at = NOW()
		WHERE request_id = $1 AND status = 'pending'
		RETURNING id, request_id, application_id, gateway_id,
		          principal_type, principal_id, action, resource,
		          tool_server, tool_name, status, requested_by, reason,
		          decision_context, expires_at,
		          approved_at, approved_by, rejected_at, rejected_by, rejection_reason,
		          created_at, updated_at
	`
	return r.scanOne(ctx, query, requestID)
}

func (r *MCPApprovalRepo) ExpirePastDue(ctx context.Context) (int, error) {
	result, err := r.pool.Exec(ctx, `
		UPDATE mcp_approval_requests
		SET status = 'expired', updated_at = NOW()
		WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
	`)
	if err != nil {
		return 0, err
	}
	return int(result.RowsAffected()), nil
}

func (r *MCPApprovalRepo) scanOne(ctx context.Context, query string, args ...any) (*MCPApprovalRequest, error) {
	return scanApprovalRow(r.pool.QueryRow(ctx, query, args...))
}

func scanApprovalRow(scanner interface{ Scan(...any) error }) (*MCPApprovalRequest, error) {
	var item MCPApprovalRequest
	var requestedBy, reason, approvedBy, rejectedBy, rejectionReason *string
	var decisionCtx []byte

	if err := scanner.Scan(
		&item.ID, &item.RequestID, &item.ApplicationID, &item.GatewayID,
		&item.PrincipalType, &item.PrincipalID, &item.Action, &item.Resource,
		&item.ToolServer, &item.ToolName, &item.Status, &requestedBy, &reason,
		&decisionCtx, &item.ExpiresAt,
		&item.ApprovedAt, &approvedBy, &item.RejectedAt, &rejectedBy, &rejectionReason,
		&item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if requestedBy != nil {
		item.RequestedBy = *requestedBy
	}
	if reason != nil {
		item.Reason = *reason
	}
	if approvedBy != nil {
		item.ApprovedBy = *approvedBy
	}
	if rejectedBy != nil {
		item.RejectedBy = *rejectedBy
	}
	if rejectionReason != nil {
		item.RejectionReason = *rejectionReason
	}
	if len(decisionCtx) > 0 {
		_ = json.Unmarshal(decisionCtx, &item.DecisionCtx)
	}
	return &item, nil
}

func newApprovalRequestID() string {
	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	return "mcp-apr-" + hex.EncodeToString(randBytes)
}
