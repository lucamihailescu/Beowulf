package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BackendInstanceStatus represents the approval status of a backend instance
type BackendInstanceStatus string

const (
	BackendStatusPending  BackendInstanceStatus = "pending"
	BackendStatusApproved BackendInstanceStatus = "approved"
	BackendStatusRejected BackendInstanceStatus = "rejected"
)

// BackendInstance represents a backend instance in the cluster
type BackendInstance struct {
	ID                    int64                 `json:"id"`
	InstanceID            string                `json:"instance_id"`
	Hostname              string                `json:"hostname"`
	IPAddress             string                `json:"ip_address,omitempty"`
	Status                BackendInstanceStatus `json:"status"`
	CertFingerprint       string                `json:"cert_fingerprint,omitempty"`
	ClusterSecretVerified bool                  `json:"cluster_secret_verified"`

	// Approval workflow
	RequestedAt     time.Time  `json:"requested_at"`
	ApprovedAt      *time.Time `json:"approved_at,omitempty"`
	ApprovedBy      string     `json:"approved_by,omitempty"`
	RejectedAt      *time.Time `json:"rejected_at,omitempty"`
	RejectedBy      string     `json:"rejected_by,omitempty"`
	RejectionReason string     `json:"rejection_reason,omitempty"`

	// Instance metadata
	CedarVersion  string                 `json:"cedar_version,omitempty"`
	OSInfo        string                 `json:"os_info,omitempty"`
	Arch          string                 `json:"arch,omitempty"`
	LastHeartbeat *time.Time             `json:"last_heartbeat,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// BackendInstanceRegisterRequest is the request to register a new backend instance
type BackendInstanceRegisterRequest struct {
	InstanceID            string                 `json:"instance_id"`
	Hostname              string                 `json:"hostname"`
	IPAddress             string                 `json:"ip_address,omitempty"`
	CertFingerprint       string                 `json:"cert_fingerprint,omitempty"`
	ClusterSecretVerified bool                   `json:"cluster_secret_verified"`
	CedarVersion          string                 `json:"cedar_version,omitempty"`
	OSInfo                string                 `json:"os_info,omitempty"`
	Arch                  string                 `json:"arch,omitempty"`
	Metadata              map[string]interface{} `json:"metadata,omitempty"`
}

// BackendInstanceRepo handles backend instance storage
type BackendInstanceRepo struct {
	pool         *pgxpool.Pool
	authRepo     *BackendAuthRepo // For checking approval_required setting
}

// NewBackendInstanceRepo creates a new BackendInstanceRepo
func NewBackendInstanceRepo(pool *pgxpool.Pool) *BackendInstanceRepo {
	return &BackendInstanceRepo{pool: pool}
}

// SetAuthRepo sets the BackendAuthRepo for approval checking
func (r *BackendInstanceRepo) SetAuthRepo(repo *BackendAuthRepo) {
	r.authRepo = repo
}

// Register registers a new backend instance or updates an existing one
func (r *BackendInstanceRepo) Register(ctx context.Context, req BackendInstanceRegisterRequest) (*BackendInstance, error) {
	// Check if instance already exists
	existing, err := r.GetByInstanceID(ctx, req.InstanceID)
	if err == nil && existing != nil {
		// Update heartbeat and metadata for existing instance
		return r.UpdateHeartbeat(ctx, req.InstanceID, req)
	}

	// Check if approval is required
	initialStatus := BackendStatusPending
	var autoApprovedAt *time.Time
	var autoApprovedBy *string

	if r.authRepo != nil {
		authConfig, err := r.authRepo.Get(ctx)
		if err == nil && authConfig != nil && !authConfig.ApprovalRequired {
			// Auto-approve if approval is not required
			initialStatus = BackendStatusApproved
			now := time.Now()
			autoApprover := "auto-approved"
			autoApprovedAt = &now
			autoApprovedBy = &autoApprover
		}
	}

	// Insert new instance
	metadataJSON, err := json.Marshal(req.Metadata)
	if err != nil {
		metadataJSON = []byte("{}")
	}

	query := `
		INSERT INTO backend_instances (
			instance_id, hostname, ip_address, status,
			cert_fingerprint, cluster_secret_verified,
			cedar_version, os_info, arch, last_heartbeat, metadata,
			approved_at, approved_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12)
		RETURNING id, instance_id, hostname, ip_address, status,
		          cert_fingerprint, cluster_secret_verified,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          cedar_version, os_info, arch, last_heartbeat, metadata,
		          created_at, updated_at
	`

	var inst BackendInstance
	var ipAddr, certFP, approvedBy, rejectedBy, rejectionReason, cedarVer, osInfo, arch *string
	var approvedAt, rejectedAt, lastHB *time.Time
	var metadata []byte

	err = r.pool.QueryRow(ctx, query,
		req.InstanceID, req.Hostname, req.IPAddress, initialStatus,
		req.CertFingerprint, req.ClusterSecretVerified,
		req.CedarVersion, req.OSInfo, req.Arch, metadataJSON,
		autoApprovedAt, autoApprovedBy,
	).Scan(
		&inst.ID, &inst.InstanceID, &inst.Hostname, &ipAddr, &inst.Status,
		&certFP, &inst.ClusterSecretVerified,
		&inst.RequestedAt, &approvedAt, &approvedBy,
		&rejectedAt, &rejectedBy, &rejectionReason,
		&cedarVer, &osInfo, &arch, &lastHB, &metadata,
		&inst.CreatedAt, &inst.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to register backend instance: %w", err)
	}

	// Set optional fields
	if ipAddr != nil {
		inst.IPAddress = *ipAddr
	}
	if certFP != nil {
		inst.CertFingerprint = *certFP
	}
	if approvedAt != nil {
		inst.ApprovedAt = approvedAt
	}
	if approvedBy != nil {
		inst.ApprovedBy = *approvedBy
	}
	if rejectedAt != nil {
		inst.RejectedAt = rejectedAt
	}
	if rejectedBy != nil {
		inst.RejectedBy = *rejectedBy
	}
	if rejectionReason != nil {
		inst.RejectionReason = *rejectionReason
	}
	if cedarVer != nil {
		inst.CedarVersion = *cedarVer
	}
	if osInfo != nil {
		inst.OSInfo = *osInfo
	}
	if arch != nil {
		inst.Arch = *arch
	}
	if lastHB != nil {
		inst.LastHeartbeat = lastHB
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &inst.Metadata)
	}

	return &inst, nil
}

// UpdateHeartbeat updates the heartbeat and metadata for an existing instance
func (r *BackendInstanceRepo) UpdateHeartbeat(ctx context.Context, instanceID string, req BackendInstanceRegisterRequest) (*BackendInstance, error) {
	metadataJSON, err := json.Marshal(req.Metadata)
	if err != nil {
		metadataJSON = []byte("{}")
	}

	query := `
		UPDATE backend_instances SET
			hostname = $2,
			ip_address = $3,
			cert_fingerprint = $4,
			cluster_secret_verified = $5,
			cedar_version = $6,
			os_info = $7,
			arch = $8,
			last_heartbeat = NOW(),
			metadata = $9
		WHERE instance_id = $1
		RETURNING id, instance_id, hostname, ip_address, status,
		          cert_fingerprint, cluster_secret_verified,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          cedar_version, os_info, arch, last_heartbeat, metadata,
		          created_at, updated_at
	`

	var inst BackendInstance
	var ipAddr, certFP, approvedBy, rejectedBy, rejectionReason, cedarVer, osInfo, arch *string
	var approvedAt, rejectedAt, lastHB *time.Time
	var metadata []byte

	err = r.pool.QueryRow(ctx, query,
		instanceID, req.Hostname, req.IPAddress,
		req.CertFingerprint, req.ClusterSecretVerified,
		req.CedarVersion, req.OSInfo, req.Arch, metadataJSON,
	).Scan(
		&inst.ID, &inst.InstanceID, &inst.Hostname, &ipAddr, &inst.Status,
		&certFP, &inst.ClusterSecretVerified,
		&inst.RequestedAt, &approvedAt, &approvedBy,
		&rejectedAt, &rejectedBy, &rejectionReason,
		&cedarVer, &osInfo, &arch, &lastHB, &metadata,
		&inst.CreatedAt, &inst.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update backend instance: %w", err)
	}

	// Set optional fields
	if ipAddr != nil {
		inst.IPAddress = *ipAddr
	}
	if certFP != nil {
		inst.CertFingerprint = *certFP
	}
	if approvedAt != nil {
		inst.ApprovedAt = approvedAt
	}
	if approvedBy != nil {
		inst.ApprovedBy = *approvedBy
	}
	if rejectedAt != nil {
		inst.RejectedAt = rejectedAt
	}
	if rejectedBy != nil {
		inst.RejectedBy = *rejectedBy
	}
	if rejectionReason != nil {
		inst.RejectionReason = *rejectionReason
	}
	if cedarVer != nil {
		inst.CedarVersion = *cedarVer
	}
	if osInfo != nil {
		inst.OSInfo = *osInfo
	}
	if arch != nil {
		inst.Arch = *arch
	}
	if lastHB != nil {
		inst.LastHeartbeat = lastHB
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &inst.Metadata)
	}

	return &inst, nil
}

// GetByInstanceID retrieves a backend instance by its instance ID
func (r *BackendInstanceRepo) GetByInstanceID(ctx context.Context, instanceID string) (*BackendInstance, error) {
	query := `
		SELECT id, instance_id, hostname, ip_address, status,
		       cert_fingerprint, cluster_secret_verified,
		       requested_at, approved_at, approved_by,
		       rejected_at, rejected_by, rejection_reason,
		       cedar_version, os_info, arch, last_heartbeat, metadata,
		       created_at, updated_at
		FROM backend_instances
		WHERE instance_id = $1
	`

	var inst BackendInstance
	var ipAddr, certFP, approvedBy, rejectedBy, rejectionReason, cedarVer, osInfo, arch *string
	var approvedAt, rejectedAt, lastHB *time.Time
	var metadata []byte

	err := r.pool.QueryRow(ctx, query, instanceID).Scan(
		&inst.ID, &inst.InstanceID, &inst.Hostname, &ipAddr, &inst.Status,
		&certFP, &inst.ClusterSecretVerified,
		&inst.RequestedAt, &approvedAt, &approvedBy,
		&rejectedAt, &rejectedBy, &rejectionReason,
		&cedarVer, &osInfo, &arch, &lastHB, &metadata,
		&inst.CreatedAt, &inst.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get backend instance: %w", err)
	}

	// Set optional fields
	if ipAddr != nil {
		inst.IPAddress = *ipAddr
	}
	if certFP != nil {
		inst.CertFingerprint = *certFP
	}
	if approvedAt != nil {
		inst.ApprovedAt = approvedAt
	}
	if approvedBy != nil {
		inst.ApprovedBy = *approvedBy
	}
	if rejectedAt != nil {
		inst.RejectedAt = rejectedAt
	}
	if rejectedBy != nil {
		inst.RejectedBy = *rejectedBy
	}
	if rejectionReason != nil {
		inst.RejectionReason = *rejectionReason
	}
	if cedarVer != nil {
		inst.CedarVersion = *cedarVer
	}
	if osInfo != nil {
		inst.OSInfo = *osInfo
	}
	if arch != nil {
		inst.Arch = *arch
	}
	if lastHB != nil {
		inst.LastHeartbeat = lastHB
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &inst.Metadata)
	}

	return &inst, nil
}

// List retrieves all backend instances, optionally filtered by status
func (r *BackendInstanceRepo) List(ctx context.Context, status *BackendInstanceStatus) ([]BackendInstance, error) {
	var query string
	var args []interface{}

	if status != nil {
		query = `
			SELECT id, instance_id, hostname, ip_address, status,
			       cert_fingerprint, cluster_secret_verified,
			       requested_at, approved_at, approved_by,
			       rejected_at, rejected_by, rejection_reason,
			       cedar_version, os_info, arch, last_heartbeat, metadata,
			       created_at, updated_at
			FROM backend_instances
			WHERE status = $1
			ORDER BY requested_at DESC
		`
		args = []interface{}{*status}
	} else {
		query = `
			SELECT id, instance_id, hostname, ip_address, status,
			       cert_fingerprint, cluster_secret_verified,
			       requested_at, approved_at, approved_by,
			       rejected_at, rejected_by, rejection_reason,
			       cedar_version, os_info, arch, last_heartbeat, metadata,
			       created_at, updated_at
			FROM backend_instances
			ORDER BY 
				CASE status
					WHEN 'pending' THEN 1
					WHEN 'approved' THEN 2
					WHEN 'rejected' THEN 3
				END,
				requested_at DESC
		`
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list backend instances: %w", err)
	}
	defer rows.Close()

	var instances []BackendInstance
	for rows.Next() {
		var inst BackendInstance
		var ipAddr, certFP, approvedBy, rejectedBy, rejectionReason, cedarVer, osInfo, arch *string
		var approvedAt, rejectedAt, lastHB *time.Time
		var metadata []byte

		err := rows.Scan(
			&inst.ID, &inst.InstanceID, &inst.Hostname, &ipAddr, &inst.Status,
			&certFP, &inst.ClusterSecretVerified,
			&inst.RequestedAt, &approvedAt, &approvedBy,
			&rejectedAt, &rejectedBy, &rejectionReason,
			&cedarVer, &osInfo, &arch, &lastHB, &metadata,
			&inst.CreatedAt, &inst.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan backend instance: %w", err)
		}

		// Set optional fields
		if ipAddr != nil {
			inst.IPAddress = *ipAddr
		}
		if certFP != nil {
			inst.CertFingerprint = *certFP
		}
		if approvedAt != nil {
			inst.ApprovedAt = approvedAt
		}
		if approvedBy != nil {
			inst.ApprovedBy = *approvedBy
		}
		if rejectedAt != nil {
			inst.RejectedAt = rejectedAt
		}
		if rejectedBy != nil {
			inst.RejectedBy = *rejectedBy
		}
		if rejectionReason != nil {
			inst.RejectionReason = *rejectionReason
		}
		if cedarVer != nil {
			inst.CedarVersion = *cedarVer
		}
		if osInfo != nil {
			inst.OSInfo = *osInfo
		}
		if arch != nil {
			inst.Arch = *arch
		}
		if lastHB != nil {
			inst.LastHeartbeat = lastHB
		}
		if len(metadata) > 0 {
			_ = json.Unmarshal(metadata, &inst.Metadata)
		}

		instances = append(instances, inst)
	}

	return instances, nil
}

// Approve approves a pending backend instance
func (r *BackendInstanceRepo) Approve(ctx context.Context, instanceID string, approvedBy string) (*BackendInstance, error) {
	query := `
		UPDATE backend_instances SET
			status = $2,
			approved_at = NOW(),
			approved_by = $3
		WHERE instance_id = $1 AND status = 'pending'
		RETURNING id, instance_id, hostname, ip_address, status,
		          cert_fingerprint, cluster_secret_verified,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          cedar_version, os_info, arch, last_heartbeat, metadata,
		          created_at, updated_at
	`

	var inst BackendInstance
	var ipAddr, certFP, approvedByOut, rejectedBy, rejectionReason, cedarVer, osInfo, arch *string
	var approvedAt, rejectedAt, lastHB *time.Time
	var metadata []byte

	err := r.pool.QueryRow(ctx, query, instanceID, BackendStatusApproved, approvedBy).Scan(
		&inst.ID, &inst.InstanceID, &inst.Hostname, &ipAddr, &inst.Status,
		&certFP, &inst.ClusterSecretVerified,
		&inst.RequestedAt, &approvedAt, &approvedByOut,
		&rejectedAt, &rejectedBy, &rejectionReason,
		&cedarVer, &osInfo, &arch, &lastHB, &metadata,
		&inst.CreatedAt, &inst.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("backend instance not found or not pending")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to approve backend instance: %w", err)
	}

	// Set optional fields
	if ipAddr != nil {
		inst.IPAddress = *ipAddr
	}
	if certFP != nil {
		inst.CertFingerprint = *certFP
	}
	if approvedAt != nil {
		inst.ApprovedAt = approvedAt
	}
	if approvedByOut != nil {
		inst.ApprovedBy = *approvedByOut
	}
	if rejectedAt != nil {
		inst.RejectedAt = rejectedAt
	}
	if rejectedBy != nil {
		inst.RejectedBy = *rejectedBy
	}
	if rejectionReason != nil {
		inst.RejectionReason = *rejectionReason
	}
	if cedarVer != nil {
		inst.CedarVersion = *cedarVer
	}
	if osInfo != nil {
		inst.OSInfo = *osInfo
	}
	if arch != nil {
		inst.Arch = *arch
	}
	if lastHB != nil {
		inst.LastHeartbeat = lastHB
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &inst.Metadata)
	}

	return &inst, nil
}

// Reject rejects a pending backend instance
func (r *BackendInstanceRepo) Reject(ctx context.Context, instanceID string, rejectedBy string, reason string) (*BackendInstance, error) {
	query := `
		UPDATE backend_instances SET
			status = $2,
			rejected_at = NOW(),
			rejected_by = $3,
			rejection_reason = $4
		WHERE instance_id = $1 AND status = 'pending'
		RETURNING id, instance_id, hostname, ip_address, status,
		          cert_fingerprint, cluster_secret_verified,
		          requested_at, approved_at, approved_by,
		          rejected_at, rejected_by, rejection_reason,
		          cedar_version, os_info, arch, last_heartbeat, metadata,
		          created_at, updated_at
	`

	var inst BackendInstance
	var ipAddr, certFP, approvedByOut, rejectedByOut, rejectionReasonOut, cedarVer, osInfo, arch *string
	var approvedAt, rejectedAt, lastHB *time.Time
	var metadata []byte

	err := r.pool.QueryRow(ctx, query, instanceID, BackendStatusRejected, rejectedBy, reason).Scan(
		&inst.ID, &inst.InstanceID, &inst.Hostname, &ipAddr, &inst.Status,
		&certFP, &inst.ClusterSecretVerified,
		&inst.RequestedAt, &approvedAt, &approvedByOut,
		&rejectedAt, &rejectedByOut, &rejectionReasonOut,
		&cedarVer, &osInfo, &arch, &lastHB, &metadata,
		&inst.CreatedAt, &inst.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("backend instance not found or not pending")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to reject backend instance: %w", err)
	}

	// Set optional fields
	if ipAddr != nil {
		inst.IPAddress = *ipAddr
	}
	if certFP != nil {
		inst.CertFingerprint = *certFP
	}
	if approvedAt != nil {
		inst.ApprovedAt = approvedAt
	}
	if approvedByOut != nil {
		inst.ApprovedBy = *approvedByOut
	}
	if rejectedAt != nil {
		inst.RejectedAt = rejectedAt
	}
	if rejectedByOut != nil {
		inst.RejectedBy = *rejectedByOut
	}
	if rejectionReasonOut != nil {
		inst.RejectionReason = *rejectionReasonOut
	}
	if cedarVer != nil {
		inst.CedarVersion = *cedarVer
	}
	if osInfo != nil {
		inst.OSInfo = *osInfo
	}
	if arch != nil {
		inst.Arch = *arch
	}
	if lastHB != nil {
		inst.LastHeartbeat = lastHB
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &inst.Metadata)
	}

	return &inst, nil
}

// Delete removes a backend instance
func (r *BackendInstanceRepo) Delete(ctx context.Context, instanceID string) error {
	query := `DELETE FROM backend_instances WHERE instance_id = $1`
	result, err := r.pool.Exec(ctx, query, instanceID)
	if err != nil {
		return fmt.Errorf("failed to delete backend instance: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("backend instance not found")
	}
	return nil
}

// CountByStatus returns the count of instances by status
func (r *BackendInstanceRepo) CountByStatus(ctx context.Context) (map[BackendInstanceStatus]int, error) {
	query := `
		SELECT status, COUNT(*) as count
		FROM backend_instances
		GROUP BY status
	`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to count backend instances: %w", err)
	}
	defer rows.Close()

	counts := make(map[BackendInstanceStatus]int)
	for rows.Next() {
		var status BackendInstanceStatus
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, fmt.Errorf("failed to scan count: %w", err)
		}
		counts[status] = count
	}

	return counts, nil
}

// CleanupStale removes instances that haven't sent a heartbeat in the given duration
func (r *BackendInstanceRepo) CleanupStale(ctx context.Context, staleAfter time.Duration) (int, error) {
	query := `
		DELETE FROM backend_instances
		WHERE last_heartbeat < $1
	`
	result, err := r.pool.Exec(ctx, query, time.Now().Add(-staleAfter))
	if err != nil {
		return 0, fmt.Errorf("failed to cleanup stale instances: %w", err)
	}
	return int(result.RowsAffected()), nil
}

