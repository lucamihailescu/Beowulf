package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"cedar/internal/simulation"
	"cedar/internal/storage"
)

// simulateRequest is the request body for running a simulation.
type simulateRequest struct {
	NewPolicyText     string                   `json:"new_policy_text"`
	CurrentPolicyText string                   `json:"current_policy_text,omitempty"` // If provided, compare against this instead of DB
	Mode              string                   `json:"mode"`
	TimeRange         string                   `json:"time_range,omitempty"`
	SampleSize        int                      `json:"sample_size,omitempty"`
	CustomScenarios   []simulation.AuthRequest `json:"custom_scenarios,omitempty"`
}

// simulateResponse is the response for a simulation.
type simulateResponse struct {
	SimulationID     int64                           `json:"simulation_id"`
	RequestsAnalyzed int                             `json:"requests_analyzed"`
	CurrentPolicy    simulationDecisionSummary       `json:"current_policy"`
	NewPolicy        simulationDecisionSummary       `json:"new_policy"`
	Impact           simulationImpactSummary         `json:"impact"`
	Status           string                          `json:"status"`
}

type simulationDecisionSummary struct {
	AllowCount int `json:"allow_count"`
	DenyCount  int `json:"deny_count"`
}

type simulationImpactSummary struct {
	NewlyDenied        int                          `json:"newly_denied"`
	NewlyAllowed       int                          `json:"newly_allowed"`
	AffectedPrincipals []storage.AffectedPrincipal  `json:"affected_principals"`
	SampleRequests     []storage.SimulatedRequest   `json:"sample_requests"`
}

// simulationListResponse is the response for listing simulations.
type simulationListResponse struct {
	Simulations []storage.Simulation `json:"simulations"`
	Total       int                  `json:"total"`
}

// SimulationAPI holds simulation-related handlers.
type SimulationAPI struct {
	simulationSvc *simulation.Service
}

// NewSimulationAPI creates a new SimulationAPI.
func NewSimulationAPI(svc *simulation.Service) *SimulationAPI {
	return &SimulationAPI{simulationSvc: svc}
}

// @Summary Run Policy Simulation
// @Description Simulates the impact of a policy change before activation
// @Tags Simulation
// @Accept json
// @Produce json
// @Security ApiKeyAuth
// @Security BearerAuth
// @Param id path int true "Application ID"
// @Param policyId path int true "Policy ID"
// @Param request body simulateRequest true "Simulation Request"
// @Success 200 {object} simulateResponse
// @Failure 400 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Router /v1/apps/{id}/policies/{policyId}/simulate [post]
func (a *SimulationAPI) HandleSimulate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	appID, err := parseIDParam(r, "id")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
		return
	}

	policyID, err := parseIDParam(r, "policyId")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid policy id"})
		return
	}

	var req simulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	if req.NewPolicyText == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "new_policy_text is required"})
		return
	}

	// Default mode to sample_data
	mode := storage.SimulationModeSampleData
	switch req.Mode {
	case "production_replay":
		mode = storage.SimulationModeProductionReplay
	case "custom":
		mode = storage.SimulationModeCustom
	}

	// Get user from context for audit
	user := GetUserFromContext(r.Context())
	createdBy := "unknown"
	if user != nil {
		createdBy = user.ID
	}

	result, err := a.simulationSvc.RunSimulation(r.Context(), simulation.SimulateRequest{
		ApplicationID:     appID,
		PolicyID:          policyID,
		NewPolicyText:     req.NewPolicyText,
		CurrentPolicyText: req.CurrentPolicyText, // If provided, use this instead of loading from DB
		Mode:              mode,
		TimeRange:         req.TimeRange,
		SampleSize:        req.SampleSize,
		CustomScenarios:   req.CustomScenarios,
		CreatedBy:         createdBy,
	})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Convert to API response
	resp := simulateResponse{
		SimulationID:     result.SimulationID,
		RequestsAnalyzed: result.RequestsAnalyzed,
		CurrentPolicy: simulationDecisionSummary{
			AllowCount: result.CurrentPolicy.AllowCount,
			DenyCount:  result.CurrentPolicy.DenyCount,
		},
		NewPolicy: simulationDecisionSummary{
			AllowCount: result.NewPolicy.AllowCount,
			DenyCount:  result.NewPolicy.DenyCount,
		},
		Impact: simulationImpactSummary{
			NewlyDenied:        result.Impact.NewlyDenied,
			NewlyAllowed:       result.Impact.NewlyAllowed,
			AffectedPrincipals: result.Impact.AffectedPrincipals,
			SampleRequests:     result.Impact.SampleRequests,
		},
		Status: string(result.Status),
	}

	json.NewEncoder(w).Encode(resp)
}

// @Summary List Simulations
// @Description Returns a list of simulations for a policy
// @Tags Simulation
// @Produce json
// @Security ApiKeyAuth
// @Security BearerAuth
// @Param id path int true "Application ID"
// @Param policyId path int true "Policy ID"
// @Param limit query int false "Max results (default 10)"
// @Success 200 {object} simulationListResponse
// @Failure 400 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Router /v1/apps/{id}/policies/{policyId}/simulations [get]
func (a *SimulationAPI) HandleListSimulations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	policyID, err := parseIDParam(r, "policyId")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid policy id"})
		return
	}

	limit := 10
	if l := r.URL.Query().Get("limit"); l != "" {
		var n int
		if _, err := fmt.Sscanf(l, "%d", &n); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	simulations, err := a.simulationSvc.ListSimulations(r.Context(), policyID, limit)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	if simulations == nil {
		simulations = []storage.Simulation{}
	}

	json.NewEncoder(w).Encode(simulationListResponse{
		Simulations: simulations,
		Total:       len(simulations),
	})
}

// @Summary Get Simulation
// @Description Returns details of a specific simulation
// @Tags Simulation
// @Produce json
// @Security ApiKeyAuth
// @Security BearerAuth
// @Param id path int true "Application ID"
// @Param policyId path int true "Policy ID"
// @Param simId path int true "Simulation ID"
// @Success 200 {object} storage.Simulation
// @Failure 400 {object} map[string]string
// @Failure 404 {object} map[string]string
// @Router /v1/apps/{id}/policies/{policyId}/simulations/{simId} [get]
func (a *SimulationAPI) HandleGetSimulation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	simID, err := parseIDParam(r, "simId")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid simulation id"})
		return
	}

	sim, err := a.simulationSvc.GetSimulation(r.Context(), simID)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "simulation not found"})
		return
	}

	json.NewEncoder(w).Encode(sim)
}

// RegisterSimulationRoutes adds simulation routes to the chi router.
func RegisterSimulationRoutes(r chi.Router, api *SimulationAPI) {
	r.Post("/v1/apps/{id}/policies/{policyId}/simulate", api.HandleSimulate)
	r.Get("/v1/apps/{id}/policies/{policyId}/simulations", api.HandleListSimulations)
	r.Get("/v1/apps/{id}/policies/{policyId}/simulations/{simId}", api.HandleGetSimulation)
}

