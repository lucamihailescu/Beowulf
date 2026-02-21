package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"cedar/internal/storage"
)

type mcpDelegationCreateRequest struct {
	ApplicationID       int64          `json:"application_id"`
	GatewayID           string         `json:"gateway_id,omitempty"`
	DelegatorType       string         `json:"delegator_type"`
	DelegatorID         string         `json:"delegator_id"`
	DelegateType        string         `json:"delegate_type"`
	DelegateID          string         `json:"delegate_id"`
	ScopeAction         string         `json:"scope_action,omitempty"`
	ScopeResourcePrefix string         `json:"scope_resource_prefix,omitempty"`
	ExpiresAt           string         `json:"expires_at"`
	Metadata            map[string]any `json:"metadata,omitempty"`
}

type mcpDelegationIntrospectRequest struct {
	Token string `json:"token"`
}

type mcpGatewayAuditRequest struct {
	ApplicationID *int64         `json:"application_id,omitempty"`
	Actor         string         `json:"actor"`
	Action        string         `json:"action"`
	Target        string         `json:"target,omitempty"`
	Decision      string         `json:"decision,omitempty"`
	Context       map[string]any `json:"context,omitempty"`
}

func (a *API) handleCreateMCPDelegation(w http.ResponseWriter, r *http.Request) {
	if a.mcpDelegationRepo == nil {
		http.Error(w, "mcp delegation repo not configured", http.StatusNotImplemented)
		return
	}
	var req mcpDelegationCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	expiresAt, err := parseTime(req.ExpiresAt)
	if err != nil {
		http.Error(w, "invalid expires_at", http.StatusBadRequest)
		return
	}
	issued, err := a.mcpDelegationRepo.Create(r.Context(), storage.MCPDelegationCreateRequest{
		ApplicationID:       req.ApplicationID,
		GatewayID:           req.GatewayID,
		DelegatorType:       req.DelegatorType,
		DelegatorID:         req.DelegatorID,
		DelegateType:        req.DelegateType,
		DelegateID:          req.DelegateID,
		ScopeAction:         req.ScopeAction,
		ScopeResourcePrefix: req.ScopeResourcePrefix,
		ExpiresAt:           expiresAt,
		Metadata:            req.Metadata,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if a.audits != nil {
		appID := req.ApplicationID
		_ = a.audits.Log(r.Context(), &appID, actorFromContext(r), "mcp.delegation.create", issued.Grant.GrantID, "allow", map[string]any{
			"delegate": issued.Grant.DelegateType + "::" + issued.Grant.DelegateID,
			"scope":    issued.Grant.ScopeAction,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(issued)
}

func (a *API) handleListMCPDelegations(w http.ResponseWriter, r *http.Request) {
	if a.mcpDelegationRepo == nil {
		http.Error(w, "mcp delegation repo not configured", http.StatusNotImplemented)
		return
	}
	var appID *int64
	if v := r.URL.Query().Get("application_id"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			appID = &id
		}
	}
	var status *storage.MCPDelegationStatus
	if v := r.URL.Query().Get("status"); v != "" {
		st := storage.MCPDelegationStatus(v)
		status = &st
	}
	limit := 50
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			offset = n
		}
	}
	items, err := a.mcpDelegationRepo.List(r.Context(), appID, status, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items": items,
		"total": len(items),
	})
}

func (a *API) handleGetMCPDelegation(w http.ResponseWriter, r *http.Request) {
	if a.mcpDelegationRepo == nil {
		http.Error(w, "mcp delegation repo not configured", http.StatusNotImplemented)
		return
	}
	item, err := a.mcpDelegationRepo.GetByGrantID(r.Context(), chi.URLParam(r, "grantId"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if item == nil {
		http.Error(w, "delegation not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (a *API) handleRevokeMCPDelegation(w http.ResponseWriter, r *http.Request) {
	if a.mcpDelegationRepo == nil {
		http.Error(w, "mcp delegation repo not configured", http.StatusNotImplemented)
		return
	}
	actor := actorFromContext(r)
	item, err := a.mcpDelegationRepo.Revoke(r.Context(), chi.URLParam(r, "grantId"), actor)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if a.audits != nil {
		appID := item.ApplicationID
		_ = a.audits.Log(r.Context(), &appID, actor, "mcp.delegation.revoke", item.GrantID, "allow", nil)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (a *API) handleIntrospectMCPDelegation(w http.ResponseWriter, r *http.Request) {
	if a.mcpDelegationRepo == nil {
		http.Error(w, "mcp delegation repo not configured", http.StatusNotImplemented)
		return
	}
	var req mcpDelegationIntrospectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}
	item, err := a.mcpDelegationRepo.IntrospectToken(r.Context(), req.Token)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if item == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"active": false})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"active": true,
		"grant":  item,
	})
}

func (a *API) handleMCPGatewayAudit(w http.ResponseWriter, r *http.Request) {
	if a.audits == nil {
		http.Error(w, "audit repo not configured", http.StatusNotImplemented)
		return
	}
	var req mcpGatewayAuditRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Action == "" {
		req.Action = "mcp.gateway.event"
	}
	if req.Actor == "" {
		req.Actor = "mcp-gateway"
	}
	if err := a.audits.Log(r.Context(), req.ApplicationID, req.Actor, req.Action, req.Target, req.Decision, req.Context); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func parseTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("empty time")
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339Nano, value)
}
