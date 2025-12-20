package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"

	"cedar/internal/observability"
)

type observabilityConfigRequest struct {
	Enabled  bool   `json:"enabled"`
	Endpoint string `json:"endpoint"`
}

// GetObservabilityConfig returns the current observability configuration.
// @Summary Get observability configuration
// @Description Get the current observability configuration
// @Tags settings
// @Produce json
// @Success 200 {object} observability.Config
// @Failure 500 {object} map[string]string
// @Router /v1/settings/observability [get]
func (api *API) GetObservabilityConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get settings from database
	enabledStr := api.settings.GetValue(ctx, "observability.enabled")
	endpoint := api.settings.GetValue(ctx, "observability.endpoint")

	config := observability.Config{
		Enabled:  enabledStr == "true",
		Endpoint: endpoint,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// UpdateObservabilityConfig updates the observability configuration.
// @Summary Update observability configuration
// @Description Update the observability configuration
// @Tags settings
// @Accept json
// @Produce json
// @Success 200 {object} observability.Config
// @Failure 400 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Router /v1/settings/observability [put]
func (api *API) UpdateObservabilityConfig(w http.ResponseWriter, r *http.Request) {
	var req observabilityConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	updatedBy := "admin" // TODO: Get from context

	// Save to database
	enabledStr := "false"
	if req.Enabled {
		enabledStr = "true"
	}

	if err := api.settings.Set(ctx, "observability.enabled", enabledStr, "Enable OpenTelemetry tracing", updatedBy, false); err != nil {
		http.Error(w, "Failed to save enabled setting", http.StatusInternalServerError)
		return
	}

	if err := api.settings.Set(ctx, "observability.endpoint", req.Endpoint, "OpenTelemetry OTLP endpoint", updatedBy, false); err != nil {
		http.Error(w, "Failed to save endpoint setting", http.StatusInternalServerError)
		return
	}

	// Apply changes
	config := observability.Config{
		Enabled:  req.Enabled,
		Endpoint: req.Endpoint,
	}

	// Re-initialize tracer
	// Note: In a real distributed system, this would need to be propagated to all instances.
	// For now, we'll just update the current instance.
	// Ideally, we should use Redis Pub/Sub to notify all instances to reload settings.
	_, err := observability.InitTracer(ctx, "cedar-backend", config)
	if err != nil {
		// Log error but don't fail the request as settings are saved
		fmt.Printf("Failed to re-initialize tracer: %v\n", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}
