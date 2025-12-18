package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// SimulationMode defines how simulation requests are generated
type SimulationMode string

const (
	SimulationModeProductionReplay SimulationMode = "production_replay"
	SimulationModeSampleData       SimulationMode = "sample_data"
	SimulationModeCustom           SimulationMode = "custom"
)

// SimulationStatus tracks the simulation lifecycle
type SimulationStatus string

const (
	SimulationStatusPending   SimulationStatus = "pending"
	SimulationStatusRunning   SimulationStatus = "running"
	SimulationStatusCompleted SimulationStatus = "completed"
	SimulationStatusFailed    SimulationStatus = "failed"
)

// Simulation represents a policy simulation run
type Simulation struct {
	ID            int64            `json:"id"`
	ApplicationID int64            `json:"application_id"`
	PolicyID      int64            `json:"policy_id"`
	PolicyVersion int              `json:"policy_version"`
	Mode          SimulationMode   `json:"mode"`
	TimeRange     string           `json:"time_range,omitempty"`
	SampleSize    int              `json:"sample_size,omitempty"`

	// Results
	RequestsAnalyzed int `json:"requests_analyzed"`
	CurrentAllows    int `json:"current_allows"`
	CurrentDenies    int `json:"current_denies"`
	NewAllows        int `json:"new_allows"`
	NewDenies        int `json:"new_denies"`

	// Detailed impact
	ImpactDetails *SimulationImpact `json:"impact_details,omitempty"`

	// Metadata
	Status       SimulationStatus `json:"status"`
	ErrorMessage string           `json:"error_message,omitempty"`
	CreatedBy    string           `json:"created_by"`
	CreatedAt    time.Time        `json:"created_at"`
	CompletedAt  *time.Time       `json:"completed_at,omitempty"`
}

// SimulationImpact contains detailed simulation results
type SimulationImpact struct {
	// Principals affected by the policy change
	AffectedPrincipals []AffectedPrincipal `json:"affected_principals"`

	// Sample requests that changed decision
	SampleRequests []SimulatedRequest `json:"sample_requests"`

	// Summary statistics
	NewlyDenied  int `json:"newly_denied"`
	NewlyAllowed int `json:"newly_allowed"`
	Unchanged    int `json:"unchanged"`
}

// AffectedPrincipal represents a principal whose access changes
type AffectedPrincipal struct {
	Principal       string   `json:"principal"`
	CurrentDecision string   `json:"current_decision"`
	NewDecision     string   `json:"new_decision"`
	AffectedActions []string `json:"affected_actions"`
	RequestCount    int      `json:"request_count"`
}

// SimulatedRequest represents a single simulated authorization request
type SimulatedRequest struct {
	Principal          string `json:"principal"`
	Action             string `json:"action"`
	Resource           string `json:"resource"`
	CurrentDecision    string `json:"current_decision"`
	NewDecision        string `json:"new_decision"`
	DeterminingPolicy  string `json:"determining_policy,omitempty"`
	DeterminingReasons string `json:"determining_reasons,omitempty"`
}

// SimulationRepo handles simulation persistence
type SimulationRepo struct {
	db *DB
}

// NewSimulationRepo creates a new simulation repository
func NewSimulationRepo(db *DB) *SimulationRepo {
	return &SimulationRepo{db: db}
}

// Create creates a new simulation record
func (r *SimulationRepo) Create(ctx context.Context, sim *Simulation) error {
	query := `
		INSERT INTO policy_simulations (
			application_id, policy_id, policy_version, mode, time_range, sample_size,
			status, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at
	`

	return r.db.writePool.QueryRow(ctx, query,
		sim.ApplicationID,
		sim.PolicyID,
		sim.PolicyVersion,
		sim.Mode,
		nullString(sim.TimeRange),
		nullInt(sim.SampleSize),
		sim.Status,
		sim.CreatedBy,
	).Scan(&sim.ID, &sim.CreatedAt)
}

// UpdateStatus updates simulation status and optionally error message
func (r *SimulationRepo) UpdateStatus(ctx context.Context, id int64, status SimulationStatus, errorMsg string) error {
	query := `
		UPDATE policy_simulations 
		SET status = $2, error_message = $3, completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE NULL END
		WHERE id = $1
	`
	_, err := r.db.writePool.Exec(ctx, query, id, status, nullString(errorMsg))
	return err
}

// UpdateResults updates simulation results
func (r *SimulationRepo) UpdateResults(ctx context.Context, id int64, results *Simulation) error {
	impactJSON, err := json.Marshal(results.ImpactDetails)
	if err != nil {
		return err
	}

	query := `
		UPDATE policy_simulations 
		SET 
			requests_analyzed = $2,
			current_allows = $3,
			current_denies = $4,
			new_allows = $5,
			new_denies = $6,
			impact_details = $7,
			status = 'completed',
			completed_at = NOW()
		WHERE id = $1
	`
	_, err = r.db.writePool.Exec(ctx, query,
		id,
		results.RequestsAnalyzed,
		results.CurrentAllows,
		results.CurrentDenies,
		results.NewAllows,
		results.NewDenies,
		impactJSON,
	)
	return err
}

// Get retrieves a simulation by ID
func (r *SimulationRepo) Get(ctx context.Context, id int64) (*Simulation, error) {
	query := `
		SELECT 
			id, application_id, policy_id, policy_version, mode, 
			COALESCE(time_range, ''), COALESCE(sample_size, 0),
			requests_analyzed, current_allows, current_denies, new_allows, new_denies,
			impact_details, status, COALESCE(error_message, ''), created_by, created_at, completed_at
		FROM policy_simulations
		WHERE id = $1
	`

	var sim Simulation
	var impactJSON []byte
	var completedAt sql.NullTime

	err := r.db.readPool.QueryRow(ctx, query, id).Scan(
		&sim.ID,
		&sim.ApplicationID,
		&sim.PolicyID,
		&sim.PolicyVersion,
		&sim.Mode,
		&sim.TimeRange,
		&sim.SampleSize,
		&sim.RequestsAnalyzed,
		&sim.CurrentAllows,
		&sim.CurrentDenies,
		&sim.NewAllows,
		&sim.NewDenies,
		&impactJSON,
		&sim.Status,
		&sim.ErrorMessage,
		&sim.CreatedBy,
		&sim.CreatedAt,
		&completedAt,
	)
	if err != nil {
		return nil, err
	}

	if completedAt.Valid {
		sim.CompletedAt = &completedAt.Time
	}

	if len(impactJSON) > 0 {
		var impact SimulationImpact
		if err := json.Unmarshal(impactJSON, &impact); err == nil {
			sim.ImpactDetails = &impact
		}
	}

	return &sim, nil
}

// ListByPolicy lists simulations for a specific policy
func (r *SimulationRepo) ListByPolicy(ctx context.Context, policyID int64, limit int) ([]Simulation, error) {
	if limit <= 0 {
		limit = 10
	}

	query := `
		SELECT 
			id, application_id, policy_id, policy_version, mode, 
			COALESCE(time_range, ''), COALESCE(sample_size, 0),
			requests_analyzed, current_allows, current_denies, new_allows, new_denies,
			status, COALESCE(error_message, ''), created_by, created_at, completed_at
		FROM policy_simulations
		WHERE policy_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`

	rows, err := r.db.readPool.Query(ctx, query, policyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var simulations []Simulation
	for rows.Next() {
		var sim Simulation
		var completedAt sql.NullTime

		err := rows.Scan(
			&sim.ID,
			&sim.ApplicationID,
			&sim.PolicyID,
			&sim.PolicyVersion,
			&sim.Mode,
			&sim.TimeRange,
			&sim.SampleSize,
			&sim.RequestsAnalyzed,
			&sim.CurrentAllows,
			&sim.CurrentDenies,
			&sim.NewAllows,
			&sim.NewDenies,
			&sim.Status,
			&sim.ErrorMessage,
			&sim.CreatedBy,
			&sim.CreatedAt,
			&completedAt,
		)
		if err != nil {
			return nil, err
		}

		if completedAt.Valid {
			sim.CompletedAt = &completedAt.Time
		}

		simulations = append(simulations, sim)
	}

	return simulations, rows.Err()
}

// Delete removes a simulation
func (r *SimulationRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.writePool.Exec(ctx, "DELETE FROM policy_simulations WHERE id = $1", id)
	return err
}

// Helper functions
func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(i int) interface{} {
	if i == 0 {
		return nil
	}
	return i
}

