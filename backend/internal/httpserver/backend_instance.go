package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"cedar/internal/storage"
)

// backendInstanceRegisterRequest is the request body for registering a backend instance
type backendInstanceRegisterRequest struct {
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

// backendInstanceRejectRequest is the request body for rejecting a backend instance
type backendInstanceRejectRequest struct {
	Reason string `json:"reason,omitempty"`
}

// backendInstancesListResponse is the response for listing backend instances
type backendInstancesListResponse struct {
	Instances []storage.BackendInstance `json:"instances"`
	Total     int                       `json:"total"`
	Counts    map[string]int            `json:"counts"`
}

// handleRegisterBackendInstance registers a new backend instance or updates heartbeat
func (a *API) handleRegisterBackendInstance(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req backendInstanceRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	if req.InstanceID == "" || req.Hostname == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "instance_id and hostname are required"})
		return
	}

	instance, err := a.backendInstanceRepo.Register(ctx, storage.BackendInstanceRegisterRequest{
		InstanceID:            req.InstanceID,
		Hostname:              req.Hostname,
		IPAddress:             req.IPAddress,
		CertFingerprint:       req.CertFingerprint,
		ClusterSecretVerified: req.ClusterSecretVerified,
		CedarVersion:          req.CedarVersion,
		OSInfo:                req.OSInfo,
		Arch:                  req.Arch,
		Metadata:              req.Metadata,
	})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(instance)
}

// handleGetBackendInstanceStatus returns the status of a specific backend instance
func (a *API) handleGetBackendInstanceStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	instanceID := chi.URLParam(r, "instanceId")

	instance, err := a.backendInstanceRepo.GetByInstanceID(ctx, instanceID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	if instance == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "backend instance not found"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(instance)
}

// handleListBackendInstances returns all backend instances
func (a *API) handleListBackendInstances(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check for status filter
	var statusFilter *storage.BackendInstanceStatus
	if statusParam := r.URL.Query().Get("status"); statusParam != "" {
		status := storage.BackendInstanceStatus(statusParam)
		statusFilter = &status
	}

	instances, err := a.backendInstanceRepo.List(ctx, statusFilter)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Get counts by status
	counts, err := a.backendInstanceRepo.CountByStatus(ctx)
	if err != nil {
		counts = make(map[storage.BackendInstanceStatus]int)
	}

	// Convert counts to string keys for JSON
	countsStr := make(map[string]int)
	for k, v := range counts {
		countsStr[string(k)] = v
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(backendInstancesListResponse{
		Instances: instances,
		Total:     len(instances),
		Counts:    countsStr,
	})
}

// handleListPendingBackendInstances returns pending backend instances
func (a *API) handleListPendingBackendInstances(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	status := storage.BackendStatusPending
	instances, err := a.backendInstanceRepo.List(ctx, &status)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"instances": instances,
		"total":     len(instances),
	})
}

// handleApproveBackendInstance approves a pending backend instance
func (a *API) handleApproveBackendInstance(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	instanceID := chi.URLParam(r, "instanceId")

	// Get current user for audit
	approvedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		approvedBy = user.ID
	}

	instance, err := a.backendInstanceRepo.Approve(ctx, instanceID, approvedBy)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Publish SSE event for the backend to pick up
	if a.sseBroker != nil {
		a.sseBroker.Publish(SSEEvent{
			Type: "backend_approved",
			Data: map[string]interface{}{
				"instance_id": instanceID,
				"status":      "approved",
			},
		})
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, approvedBy, "backend.approve", instanceID, "", map[string]interface{}{
			"hostname": instance.Hostname,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(instance)
}

// handleRejectBackendInstance rejects a pending backend instance
func (a *API) handleRejectBackendInstance(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	instanceID := chi.URLParam(r, "instanceId")

	var req backendInstanceRejectRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	// Get current user for audit
	rejectedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		rejectedBy = user.ID
	}

	instance, err := a.backendInstanceRepo.Reject(ctx, instanceID, rejectedBy, req.Reason)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Publish SSE event for the backend to pick up
	if a.sseBroker != nil {
		a.sseBroker.Publish(SSEEvent{
			Type: "backend_rejected",
			Data: map[string]interface{}{
				"instance_id": instanceID,
				"status":      "rejected",
				"reason":      req.Reason,
			},
		})
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, rejectedBy, "backend.reject", instanceID, "", map[string]interface{}{
			"hostname": instance.Hostname,
			"reason":   req.Reason,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(instance)
}

// handleDeleteBackendInstance removes a backend instance
func (a *API) handleDeleteBackendInstance(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	instanceID := chi.URLParam(r, "instanceId")

	// Get current user for audit
	deletedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		deletedBy = user.ID
	}

	err := a.backendInstanceRepo.Delete(ctx, instanceID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, deletedBy, "backend.delete", instanceID, "", nil)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// handleUpdateApprovalRequired updates whether backend approval is required
func (a *API) handleUpdateApprovalRequired(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		ApprovalRequired bool `json:"approval_required"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	// Get current user for audit
	updatedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		updatedBy = user.ID
	}

	if err := a.backendAuthRepo.UpdateApprovalRequired(ctx, req.ApprovalRequired, updatedBy); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Return updated config
	cfg, err := a.backendAuthRepo.GetPublic(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

