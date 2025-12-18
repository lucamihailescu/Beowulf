package simulation

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	"github.com/cedar-policy/cedar-go"
	"cedar/internal/storage"
)

// Service provides policy simulation capabilities
type Service struct {
	simRepo     *storage.SimulationRepo
	policyRepo  *storage.PolicyRepo
	entityRepo  *storage.EntityRepo
	auditRepo   AuditLogReader
}

// AuditLogReader is an interface for reading audit logs for production replay
type AuditLogReader interface {
	// GetRecentRequests returns recent authorization requests for an application
	GetRecentRequests(ctx context.Context, appID int64, duration time.Duration, limit int) ([]AuthRequest, error)
}

// AuthRequest represents a historical authorization request
type AuthRequest struct {
	Principal string                 `json:"principal"`
	Action    string                 `json:"action"`
	Resource  string                 `json:"resource"`
	Context   map[string]interface{} `json:"context,omitempty"`
}

// SimulateRequest contains parameters for a simulation
type SimulateRequest struct {
	ApplicationID     int64                  `json:"application_id"`
	PolicyID          int64                  `json:"policy_id"`
	NewPolicyText     string                 `json:"new_policy_text"`
	CurrentPolicyText string                 `json:"current_policy_text,omitempty"` // If provided, compare against this instead of loading from DB
	Mode              storage.SimulationMode `json:"mode"`
	TimeRange         string                 `json:"time_range,omitempty"` // e.g., "24h", "7d"
	SampleSize        int                    `json:"sample_size,omitempty"`
	CustomScenarios   []AuthRequest          `json:"custom_scenarios,omitempty"`
	CreatedBy         string                 `json:"created_by"`
}

// SimulateResponse contains simulation results
type SimulateResponse struct {
	SimulationID     int64                       `json:"simulation_id"`
	RequestsAnalyzed int                         `json:"requests_analyzed"`
	CurrentPolicy    DecisionSummary             `json:"current_policy"`
	NewPolicy        DecisionSummary             `json:"new_policy"`
	Impact           ImpactSummary               `json:"impact"`
	Status           storage.SimulationStatus    `json:"status"`
}

// DecisionSummary contains allow/deny counts
type DecisionSummary struct {
	AllowCount int `json:"allow_count"`
	DenyCount  int `json:"deny_count"`
}

// ImpactSummary contains the impact of the policy change
type ImpactSummary struct {
	NewlyDenied        int                         `json:"newly_denied"`
	NewlyAllowed       int                         `json:"newly_allowed"`
	AffectedPrincipals []storage.AffectedPrincipal `json:"affected_principals"`
	SampleRequests     []storage.SimulatedRequest  `json:"sample_requests"`
}

// NewService creates a new simulation service
func NewService(simRepo *storage.SimulationRepo, policyRepo *storage.PolicyRepo, entityRepo *storage.EntityRepo, auditRepo AuditLogReader) *Service {
	return &Service{
		simRepo:    simRepo,
		policyRepo: policyRepo,
		entityRepo: entityRepo,
		auditRepo:  auditRepo,
	}
}

// RunSimulation executes a policy simulation
func (s *Service) RunSimulation(ctx context.Context, req SimulateRequest) (*SimulateResponse, error) {
	// Determine current policy text - use provided text or load from DB
	var currentPolicyText string
	var policyVersion int

	if req.CurrentPolicyText != "" {
		// Use the policy text provided by the client (from the UI)
		currentPolicyText = req.CurrentPolicyText
		// Still need to get policy info for versioning
		currentPolicy, err := s.policyRepo.Get(ctx, req.PolicyID)
		if err != nil {
			return nil, fmt.Errorf("failed to get policy info: %w", err)
		}
		policyVersion = currentPolicy.ActiveVersion
	} else {
		// Load the active policy from the database
		currentPolicy, err := s.policyRepo.Get(ctx, req.PolicyID)
		if err != nil {
			return nil, fmt.Errorf("failed to get current policy: %w", err)
		}
		currentPolicyText = currentPolicy.ActivePolicyText
		policyVersion = currentPolicy.ActiveVersion
	}

	// Create simulation record
	sim := &storage.Simulation{
		ApplicationID: req.ApplicationID,
		PolicyID:      req.PolicyID,
		PolicyVersion: policyVersion,
		Mode:          req.Mode,
		TimeRange:     req.TimeRange,
		SampleSize:    req.SampleSize,
		Status:        storage.SimulationStatusPending,
		CreatedBy:     req.CreatedBy,
	}

	if err := s.simRepo.Create(ctx, sim); err != nil {
		return nil, fmt.Errorf("failed to create simulation record: %w", err)
	}

	// Update status to running
	if err := s.simRepo.UpdateStatus(ctx, sim.ID, storage.SimulationStatusRunning, ""); err != nil {
		log.Printf("Failed to update simulation status: %v", err)
	}

	// Generate test requests based on mode
	requests, err := s.generateRequests(ctx, req)
	if err != nil {
		s.simRepo.UpdateStatus(ctx, sim.ID, storage.SimulationStatusFailed, err.Error())
		return nil, fmt.Errorf("failed to generate test requests: %w", err)
	}

	// Get entities for authorization context (using cedar.EntityMap directly)
	entityStore, err := s.entityRepo.Entities(ctx, req.ApplicationID)
	if err != nil {
		s.simRepo.UpdateStatus(ctx, sim.ID, storage.SimulationStatusFailed, err.Error())
		return nil, fmt.Errorf("failed to get entities: %w", err)
	}

	// Build Cedar policy sets
	currentPolicySet, err := s.buildPolicySet(currentPolicyText)
	if err != nil {
		s.simRepo.UpdateStatus(ctx, sim.ID, storage.SimulationStatusFailed, err.Error())
		return nil, fmt.Errorf("failed to parse current policy: %w", err)
	}

	newPolicySet, err := s.buildPolicySet(req.NewPolicyText)
	if err != nil {
		s.simRepo.UpdateStatus(ctx, sim.ID, storage.SimulationStatusFailed, err.Error())
		return nil, fmt.Errorf("failed to parse new policy: %w", err)
	}

	// Run simulation
	result, err := s.executeSimulation(ctx, requests, currentPolicySet, newPolicySet, entityStore)
	if err != nil {
		s.simRepo.UpdateStatus(ctx, sim.ID, storage.SimulationStatusFailed, err.Error())
		return nil, fmt.Errorf("simulation failed: %w", err)
	}

	// Update simulation with results
	sim.RequestsAnalyzed = result.RequestsAnalyzed
	sim.CurrentAllows = result.CurrentPolicy.AllowCount
	sim.CurrentDenies = result.CurrentPolicy.DenyCount
	sim.NewAllows = result.NewPolicy.AllowCount
	sim.NewDenies = result.NewPolicy.DenyCount
	sim.ImpactDetails = &storage.SimulationImpact{
		AffectedPrincipals: result.Impact.AffectedPrincipals,
		SampleRequests:     result.Impact.SampleRequests,
		NewlyDenied:        result.Impact.NewlyDenied,
		NewlyAllowed:       result.Impact.NewlyAllowed,
		Unchanged:          result.RequestsAnalyzed - result.Impact.NewlyDenied - result.Impact.NewlyAllowed,
	}

	if err := s.simRepo.UpdateResults(ctx, sim.ID, sim); err != nil {
		log.Printf("Failed to save simulation results: %v", err)
	}

	result.SimulationID = sim.ID
	result.Status = storage.SimulationStatusCompleted

	return result, nil
}

// generateRequests creates test requests based on simulation mode
func (s *Service) generateRequests(ctx context.Context, req SimulateRequest) ([]AuthRequest, error) {
	switch req.Mode {
	case storage.SimulationModeProductionReplay:
		return s.generateProductionReplayRequests(ctx, req)
	case storage.SimulationModeSampleData:
		return s.generateSampleDataRequests(ctx, req)
	case storage.SimulationModeCustom:
		return req.CustomScenarios, nil
	default:
		return nil, fmt.Errorf("unknown simulation mode: %s", req.Mode)
	}
}

// generateProductionReplayRequests fetches recent requests from audit logs
func (s *Service) generateProductionReplayRequests(ctx context.Context, req SimulateRequest) ([]AuthRequest, error) {
	duration, err := parseDuration(req.TimeRange)
	if err != nil {
		duration = 24 * time.Hour // Default to 24h
	}

	if s.auditRepo != nil {
		return s.auditRepo.GetRecentRequests(ctx, req.ApplicationID, duration, 10000)
	}

	// If no audit repo, fall back to sample data
	log.Println("No audit log reader configured, falling back to sample data")
	return s.generateSampleDataRequests(ctx, req)
}

// generateSampleDataRequests creates synthetic test requests
func (s *Service) generateSampleDataRequests(ctx context.Context, req SimulateRequest) ([]AuthRequest, error) {
	sampleSize := req.SampleSize
	if sampleSize <= 0 {
		sampleSize = 100
	}

	// Get entities to generate realistic requests
	entities, err := s.entityRepo.List(ctx, req.ApplicationID)
	if err != nil {
		return nil, err
	}

	// Extract principals, actions, and resources from entities
	var principals, actions, resources []string

	for _, e := range entities {
		switch {
		case strings.HasPrefix(e.Type, "User") || strings.HasPrefix(e.Type, "Group"):
			principals = append(principals, fmt.Sprintf("%s::\"%s\"", e.Type, e.EntityID))
		case strings.HasPrefix(e.Type, "Action"):
			actions = append(actions, fmt.Sprintf("Action::\"%s\"", e.EntityID))
		default:
			resources = append(resources, fmt.Sprintf("%s::\"%s\"", e.Type, e.EntityID))
		}
	}

	// Default values if no entities found
	if len(principals) == 0 {
		principals = []string{
			`User::"alice"`,
			`User::"bob"`,
			`User::"admin"`,
		}
	}
	if len(actions) == 0 {
		actions = []string{
			`Action::"view"`,
			`Action::"edit"`,
			`Action::"delete"`,
			`Action::"admin"`,
		}
	}
	if len(resources) == 0 {
		resources = []string{
			`Document::"doc1"`,
			`Document::"doc2"`,
			`Folder::"folder1"`,
		}
	}

	// Generate random combinations
	requests := make([]AuthRequest, sampleSize)
	for i := 0; i < sampleSize; i++ {
		requests[i] = AuthRequest{
			Principal: principals[rand.Intn(len(principals))],
			Action:    actions[rand.Intn(len(actions))],
			Resource:  resources[rand.Intn(len(resources))],
		}
	}

	return requests, nil
}

// buildPolicySet parses Cedar policy text into a PolicySet
func (s *Service) buildPolicySet(policyText string) (*cedar.PolicySet, error) {
	ps, err := cedar.NewPolicySetFromBytes("policy.cedar", []byte(policyText))
	if err != nil {
		return nil, fmt.Errorf("failed to parse policy: %w", err)
	}
	return ps, nil
}


// executeSimulation runs the actual simulation comparing two policy sets
func (s *Service) executeSimulation(ctx context.Context, requests []AuthRequest, currentPS, newPS *cedar.PolicySet, entities cedar.EntityMap) (*SimulateResponse, error) {
	result := &SimulateResponse{
		CurrentPolicy: DecisionSummary{},
		NewPolicy:     DecisionSummary{},
		Impact: ImpactSummary{
			AffectedPrincipals: []storage.AffectedPrincipal{},
			SampleRequests:     []storage.SimulatedRequest{},
		},
	}

	// Track affected principals
	principalImpact := make(map[string]*storage.AffectedPrincipal)

	for _, req := range requests {
		// Parse request components from string format like `Type::"id"` or just "Type::id"
		principalType, principalID := parseEntityRef(req.Principal)
		actionType, actionID := parseEntityRef(req.Action)
		resourceType, resourceID := parseEntityRef(req.Resource)

		if principalType == "" || actionType == "" || resourceType == "" {
			continue
		}

		cedarReq := cedar.Request{
			Principal: cedar.NewEntityUID(cedar.EntityType(principalType), cedar.String(principalID)),
			Action:    cedar.NewEntityUID(cedar.EntityType(actionType), cedar.String(actionID)),
			Resource:  cedar.NewEntityUID(cedar.EntityType(resourceType), cedar.String(resourceID)),
		}

		// Evaluate with current policy
		currentDecision, _ := cedar.Authorize(currentPS, entities, cedarReq)
		currentAllow := currentDecision == cedar.Allow

		// Evaluate with new policy
		newDecision, _ := cedar.Authorize(newPS, entities, cedarReq)
		newAllow := newDecision == cedar.Allow

		// Update counters
		if currentAllow {
			result.CurrentPolicy.AllowCount++
		} else {
			result.CurrentPolicy.DenyCount++
		}

		if newAllow {
			result.NewPolicy.AllowCount++
		} else {
			result.NewPolicy.DenyCount++
		}

		// Track changes
		if currentAllow != newAllow {
			if currentAllow && !newAllow {
				result.Impact.NewlyDenied++
			} else {
				result.Impact.NewlyAllowed++
			}

			// Track affected principal
			principalKey := req.Principal
			if _, exists := principalImpact[principalKey]; !exists {
				currentDec := "deny"
				if currentAllow {
					currentDec = "allow"
				}
				newDec := "deny"
				if newAllow {
					newDec = "allow"
				}
				principalImpact[principalKey] = &storage.AffectedPrincipal{
					Principal:       req.Principal,
					CurrentDecision: currentDec,
					NewDecision:     newDec,
					AffectedActions: []string{},
				}
			}

			// Add affected action
			ap := principalImpact[principalKey]
			actionStr := strings.TrimPrefix(req.Action, `Action::"`)
			actionStr = strings.TrimSuffix(actionStr, `"`)
			if !contains(ap.AffectedActions, actionStr) {
				ap.AffectedActions = append(ap.AffectedActions, actionStr)
			}
			ap.RequestCount++

			// Add sample request (limit to 50)
			if len(result.Impact.SampleRequests) < 50 {
				currentDec := "deny"
				if currentAllow {
					currentDec = "allow"
				}
				newDec := "deny"
				if newAllow {
					newDec = "allow"
				}

				result.Impact.SampleRequests = append(result.Impact.SampleRequests, storage.SimulatedRequest{
					Principal:       req.Principal,
					Action:          req.Action,
					Resource:        req.Resource,
					CurrentDecision: currentDec,
					NewDecision:     newDec,
				})
			}
		}

		result.RequestsAnalyzed++
	}

	// Convert principal impact map to slice
	for _, ap := range principalImpact {
		result.Impact.AffectedPrincipals = append(result.Impact.AffectedPrincipals, *ap)
	}

	// Limit affected principals to top 50 by request count
	if len(result.Impact.AffectedPrincipals) > 50 {
		result.Impact.AffectedPrincipals = result.Impact.AffectedPrincipals[:50]
	}

	return result, nil
}

// GetSimulation retrieves a simulation by ID
func (s *Service) GetSimulation(ctx context.Context, id int64) (*storage.Simulation, error) {
	return s.simRepo.Get(ctx, id)
}

// ListSimulations lists simulations for a policy
func (s *Service) ListSimulations(ctx context.Context, policyID int64, limit int) ([]storage.Simulation, error) {
	return s.simRepo.ListByPolicy(ctx, policyID, limit)
}

// Helper functions
func parseDuration(s string) (time.Duration, error) {
	if s == "" {
		return 24 * time.Hour, nil
	}

	// Handle shorthand like "24h", "7d", "30d"
	if strings.HasSuffix(s, "d") {
		days := strings.TrimSuffix(s, "d")
		var d int
		fmt.Sscanf(days, "%d", &d)
		return time.Duration(d) * 24 * time.Hour, nil
	}

	return time.ParseDuration(s)
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// parseEntityRef parses entity reference strings like `Type::"id"` or `Type::id`
func parseEntityRef(ref string) (entityType, entityID string) {
	// Look for "::" separator
	idx := strings.Index(ref, "::")
	if idx == -1 {
		return "", ""
	}
	entityType = ref[:idx]
	entityID = ref[idx+2:]
	
	// Remove surrounding quotes if present
	if len(entityID) >= 2 && entityID[0] == '"' && entityID[len(entityID)-1] == '"' {
		entityID = entityID[1 : len(entityID)-1]
	}
	
	return entityType, entityID
}

