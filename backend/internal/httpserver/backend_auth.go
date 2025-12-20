package httpserver

import (
	"encoding/json"
	"net/http"

	"cedar/internal/storage"
)

// backendAuthConfigRequest is the request body for updating backend auth config
type backendAuthConfigRequest struct {
	AuthMode      string `json:"auth_mode"`
	CACertificate string `json:"ca_certificate,omitempty"`
	CAPrivateKey  string `json:"ca_private_key,omitempty"`
	SharedSecret  string `json:"shared_secret,omitempty"`
}

// handleGetBackendAuthConfig returns the current backend auth configuration
func (a *API) handleGetBackendAuthConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cfg, err := a.backendAuthRepo.GetPublic(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

// handleUpdateBackendAuthConfig updates the backend auth configuration
func (a *API) handleUpdateBackendAuthConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req backendAuthConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	// Validate auth mode
	authMode := storage.BackendAuthMode(req.AuthMode)
	switch authMode {
	case storage.BackendAuthModeNone, storage.BackendAuthModeSharedSecret, storage.BackendAuthModeMTLS:
		// valid
	default:
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid auth_mode, must be 'none', 'shared_secret', or 'mtls'"})
		return
	}

	// Get current user for audit
	updatedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		updatedBy = user.ID
	}

	// Update auth mode
	if err := a.backendAuthRepo.UpdateAuthMode(ctx, authMode, updatedBy); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Handle mode-specific updates
	switch authMode {
	case storage.BackendAuthModeSharedSecret:
		if req.SharedSecret != "" {
			if len(req.SharedSecret) < 16 {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "shared_secret must be at least 16 characters"})
				return
			}
			if err := a.backendAuthRepo.UpdateSharedSecret(ctx, req.SharedSecret, updatedBy); err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
		}

	case storage.BackendAuthModeMTLS:
		if req.CACertificate != "" {
			if err := a.backendAuthRepo.UpdateCACertificate(ctx, req.CACertificate, req.CAPrivateKey, updatedBy); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
		}
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

// handleUploadCACertificate handles CA certificate upload for mTLS
func (a *API) handleUploadCACertificate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		CACertificate string `json:"ca_certificate"`
		CAPrivateKey  string `json:"ca_private_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
		return
	}

	if req.CACertificate == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "ca_certificate is required"})
		return
	}

	// Get current user for audit
	updatedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		updatedBy = user.ID
	}

	if err := a.backendAuthRepo.UpdateCACertificate(ctx, req.CACertificate, req.CAPrivateKey, updatedBy); err != nil {
		w.WriteHeader(http.StatusBadRequest)
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

// handleRemoveCACertificate removes the CA certificate
func (a *API) handleRemoveCACertificate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get current user for audit
	updatedBy := "system"
	if user := GetUserFromContext(ctx); user != nil {
		updatedBy = user.ID
	}

	if err := a.backendAuthRepo.RemoveCACertificate(ctx, updatedBy); err != nil {
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

// handleVerifyBackendAuth verifies a backend's authentication credentials
// This is called by backends when registering to verify their credentials
func (a *API) handleVerifyBackendAuth(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get current config
	cfg, err := a.backendAuthRepo.Get(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Check based on auth mode
	switch cfg.AuthMode {
	case storage.BackendAuthModeNone:
		// No authentication required
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"authenticated": true,
			"mode":          "none",
		})
		return

	case storage.BackendAuthModeSharedSecret:
		// Check for X-Cluster-Secret header
		secret := r.Header.Get("X-Cluster-Secret")
		if secret == "" {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "X-Cluster-Secret header required"})
			return
		}

		valid, err := a.backendAuthRepo.VerifySharedSecret(ctx, secret)
		if err != nil || !valid {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid cluster secret"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"authenticated": true,
			"mode":          "shared_secret",
		})
		return

	case storage.BackendAuthModeMTLS:
		// Check for client certificate in TLS connection
		if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "client certificate required"})
			return
		}

		// The TLS handshake already verified the cert against our CA
		// (configured in the TLS config), so if we get here, it's valid
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"authenticated": true,
			"mode":          "mtls",
			"subject":       r.TLS.PeerCertificates[0].Subject.String(),
		})
		return

	default:
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "unknown auth mode"})
	}
}
