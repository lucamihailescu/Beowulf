package httpserver

import (
	"context"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"time"

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
	CSR                   string                 `json:"csr,omitempty"`
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
		CSR:                   req.CSR,
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

	// Fetch instance to get CSR
	instance, err := a.backendInstanceRepo.GetByInstanceID(ctx, instanceID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	if instance == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "instance not found"})
		return
	}

	var signedCert string
	if instance.CSR != "" {
		// Try to sign CSR
		signedCert, err = a.signBackendCSR(ctx, instance.CSR)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("failed to sign CSR: %v", err)})
			return
		}
	}

	instance, err = a.backendInstanceRepo.Approve(ctx, instanceID, approvedBy, signedCert)
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

// handleSuspendBackendInstance suspends an approved backend instance
func (a *API) handleSuspendBackendInstance(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	instanceID := chi.URLParam(r, "instanceId")

	// Get current user for audit
	suspendedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		suspendedBy = user.ID
	}

	instance, err := a.backendInstanceRepo.Suspend(ctx, instanceID, suspendedBy)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Publish SSE event for the backend to pick up
	if a.sseBroker != nil {
		a.sseBroker.Publish(SSEEvent{
			Type: "backend_suspended",
			Data: map[string]interface{}{
				"instance_id": instanceID,
				"status":      "suspended",
			},
		})
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, suspendedBy, "backend.suspend", instanceID, "", map[string]interface{}{
			"hostname": instance.Hostname,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(instance)
}

// handleUnsuspendBackendInstance reactivates a suspended backend instance
func (a *API) handleUnsuspendBackendInstance(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	instanceID := chi.URLParam(r, "instanceId")

	// Get current user for audit
	unsuspendedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		unsuspendedBy = user.ID
	}

	instance, err := a.backendInstanceRepo.Unsuspend(ctx, instanceID, unsuspendedBy)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Publish SSE event for the backend to pick up
	if a.sseBroker != nil {
		a.sseBroker.Publish(SSEEvent{
			Type: "backend_unsuspended",
			Data: map[string]interface{}{
				"instance_id": instanceID,
				"status":      "approved",
			},
		})
	}

	// Audit log
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, unsuspendedBy, "backend.unsuspend", instanceID, "", map[string]interface{}{
			"hostname": instance.Hostname,
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

	// Also clean up from Redis to prevent the instance from appearing in cluster status
	if a.redisClient != nil {
		redisKey := "cedar:instance:" + instanceID
		_ = a.redisClient.Del(ctx, redisKey).Err()
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

func (a *API) signBackendCSR(ctx context.Context, csrPEM string) (string, error) {
	// Get CA config
	authConfig, err := a.backendAuthRepo.Get(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get auth config: %w", err)
	}
	if authConfig == nil || authConfig.CACertificate == "" || authConfig.CAPrivateKey == "" {
		// CA not configured, cannot sign
		return "", nil
	}

	// Parse CA cert
	block, _ := pem.Decode([]byte(authConfig.CACertificate))
	if block == nil {
		return "", fmt.Errorf("failed to decode CA certificate")
	}
	caCert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("failed to parse CA certificate: %w", err)
	}

	// Parse CA private key
	block, _ = pem.Decode([]byte(authConfig.CAPrivateKey))
	if block == nil {
		return "", fmt.Errorf("failed to decode CA private key")
	}

	var caKey interface{}
	if block.Type == "RSA PRIVATE KEY" {
		caKey, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	} else {
		caKey, err = x509.ParsePKCS8PrivateKey(block.Bytes)
	}
	if err != nil {
		return "", fmt.Errorf("failed to parse CA private key: %w", err)
	}

	// Parse CSR
	block, _ = pem.Decode([]byte(csrPEM))
	if block == nil {
		return "", fmt.Errorf("failed to decode CSR")
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("failed to parse CSR: %w", err)
	}
	if err := csr.CheckSignature(); err != nil {
		return "", fmt.Errorf("invalid CSR signature: %w", err)
	}

	// Create certificate
	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialNumberLimit)
	if err != nil {
		return "", fmt.Errorf("failed to generate serial number: %w", err)
	}

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject:      csr.Subject,
		NotBefore:    time.Now(),
		NotAfter:     time.Now().AddDate(1, 0, 0), // 1 year validity
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
	}

	certBytes, err := x509.CreateCertificate(rand.Reader, &template, caCert, csr.PublicKey, caKey)
	if err != nil {
		return "", fmt.Errorf("failed to create certificate: %w", err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certBytes})
	return string(certPEM), nil
}
