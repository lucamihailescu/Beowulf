package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"cedar/internal/storage"
)

type mcpGatewayRegisterRequest struct {
	GatewayID string         `json:"gateway_id"`
	Name      string         `json:"name"`
	Endpoint  string         `json:"endpoint,omitempty"`
	AuthMode  string         `json:"auth_mode,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type mcpGatewayRejectRequest struct {
	Reason string `json:"reason,omitempty"`
}

type mcpGatewayListResponse struct {
	Items  []storage.MCPGateway `json:"items"`
	Total  int                  `json:"total"`
	Counts map[string]int       `json:"counts"`
}

func (a *API) handleRegisterMCPGateway(w http.ResponseWriter, r *http.Request) {
	if a.mcpGatewayRepo == nil {
		http.Error(w, "mcp gateway repo not configured", http.StatusNotImplemented)
		return
	}
	var req mcpGatewayRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	item, err := a.mcpGatewayRepo.Register(r.Context(), storage.MCPGatewayRegisterRequest{
		GatewayID: req.GatewayID,
		Name:      req.Name,
		Endpoint:  req.Endpoint,
		AuthMode:  req.AuthMode,
		Metadata:  req.Metadata,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if a.audits != nil {
		_ = a.audits.Log(r.Context(), nil, "mcp-gateway", "mcp.gateway.register", req.GatewayID, "allow", map[string]any{
			"name":     req.Name,
			"endpoint": req.Endpoint,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (a *API) handleListMCPGateways(w http.ResponseWriter, r *http.Request) {
	if a.mcpGatewayRepo == nil {
		http.Error(w, "mcp gateway repo not configured", http.StatusNotImplemented)
		return
	}
	var status *storage.MCPGatewayStatus
	if s := r.URL.Query().Get("status"); s != "" {
		st := storage.MCPGatewayStatus(s)
		status = &st
	}
	items, err := a.mcpGatewayRepo.List(r.Context(), status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	countMap, err := a.mcpGatewayRepo.CountByStatus(r.Context())
	counts := map[string]int{}
	if err == nil {
		for k, v := range countMap {
			counts[string(k)] = v
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(mcpGatewayListResponse{
		Items:  items,
		Total:  len(items),
		Counts: counts,
	})
}

func (a *API) handleGetMCPGateway(w http.ResponseWriter, r *http.Request) {
	if a.mcpGatewayRepo == nil {
		http.Error(w, "mcp gateway repo not configured", http.StatusNotImplemented)
		return
	}
	item, err := a.mcpGatewayRepo.GetByGatewayID(r.Context(), chi.URLParam(r, "gatewayId"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if item == nil {
		http.Error(w, "mcp gateway not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (a *API) handleApproveMCPGateway(w http.ResponseWriter, r *http.Request) {
	a.transitionMCPGateway(w, r, "approve")
}

func (a *API) handleRejectMCPGateway(w http.ResponseWriter, r *http.Request) {
	a.transitionMCPGateway(w, r, "reject")
}

func (a *API) handleSuspendMCPGateway(w http.ResponseWriter, r *http.Request) {
	a.transitionMCPGateway(w, r, "suspend")
}

func (a *API) handleUnsuspendMCPGateway(w http.ResponseWriter, r *http.Request) {
	a.transitionMCPGateway(w, r, "unsuspend")
}

func (a *API) handleDeleteMCPGateway(w http.ResponseWriter, r *http.Request) {
	if a.mcpGatewayRepo == nil {
		http.Error(w, "mcp gateway repo not configured", http.StatusNotImplemented)
		return
	}
	gatewayID := chi.URLParam(r, "gatewayId")
	if err := a.mcpGatewayRepo.Delete(r.Context(), gatewayID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if a.audits != nil {
		_ = a.audits.Log(r.Context(), nil, actorFromContext(r), "mcp.gateway.delete", gatewayID, "allow", nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func (a *API) transitionMCPGateway(w http.ResponseWriter, r *http.Request, action string) {
	if a.mcpGatewayRepo == nil {
		http.Error(w, "mcp gateway repo not configured", http.StatusNotImplemented)
		return
	}
	ctx := r.Context()
	gatewayID := chi.URLParam(r, "gatewayId")
	actor := actorFromContext(r)

	var (
		item *storage.MCPGateway
		err  error
	)
	switch action {
	case "approve":
		item, err = a.mcpGatewayRepo.Approve(ctx, gatewayID, actor)
	case "suspend":
		item, err = a.mcpGatewayRepo.Suspend(ctx, gatewayID)
	case "unsuspend":
		item, err = a.mcpGatewayRepo.Unsuspend(ctx, gatewayID)
	case "reject":
		var req mcpGatewayRejectRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		item, err = a.mcpGatewayRepo.Reject(ctx, gatewayID, actor, req.Reason)
	default:
		http.Error(w, "unsupported action", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if a.audits != nil {
		_ = a.audits.Log(ctx, nil, actor, "mcp.gateway."+action, gatewayID, "allow", nil)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func actorFromContext(r *http.Request) string {
	actor := "system"
	if user := GetUserFromContext(r.Context()); user != nil && user.ID != "" {
		actor = user.ID
	}
	return actor
}
