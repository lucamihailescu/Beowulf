package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"cedar/internal/storage"
)

type mcpApprovalCreateRequest struct {
	RequestID     string         `json:"request_id,omitempty"`
	ApplicationID *int64         `json:"application_id,omitempty"`
	GatewayID     string         `json:"gateway_id"`
	PrincipalType string         `json:"principal_type"`
	PrincipalID   string         `json:"principal_id"`
	Action        string         `json:"action"`
	Resource      string         `json:"resource"`
	ToolServer    string         `json:"tool_server"`
	ToolName      string         `json:"tool_name"`
	RequestedBy   string         `json:"requested_by,omitempty"`
	Reason        string         `json:"reason,omitempty"`
	DecisionCtx   map[string]any `json:"decision_context,omitempty"`
	ExpiresInSec  int64          `json:"expires_in_seconds,omitempty"`
}

type mcpApprovalRejectRequest struct {
	Reason string `json:"reason,omitempty"`
}

type mcpApprovalListResponse struct {
	Items []storage.MCPApprovalRequest `json:"items"`
	Total int                          `json:"total"`
}

func (a *API) handleCreateMCPApprovalRequest(w http.ResponseWriter, r *http.Request) {
	if a.mcpApprovalRepo == nil {
		http.Error(w, "mcp approval repo not configured", http.StatusNotImplemented)
		return
	}
	var req mcpApprovalCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	requestedBy := req.RequestedBy
	if requestedBy == "" {
		requestedBy = actorFromContext(r)
	}
	var expiresAt *time.Time
	if req.ExpiresInSec > 0 {
		t := time.Now().Add(time.Duration(req.ExpiresInSec) * time.Second)
		expiresAt = &t
	}
	item, err := a.mcpApprovalRepo.Create(r.Context(), storage.MCPApprovalCreateRequest{
		RequestID:     req.RequestID,
		ApplicationID: req.ApplicationID,
		GatewayID:     req.GatewayID,
		PrincipalType: req.PrincipalType,
		PrincipalID:   req.PrincipalID,
		Action:        req.Action,
		Resource:      req.Resource,
		ToolServer:    req.ToolServer,
		ToolName:      req.ToolName,
		RequestedBy:   requestedBy,
		Reason:        req.Reason,
		DecisionCtx:   req.DecisionCtx,
		ExpiresAt:     expiresAt,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if a.audits != nil {
		_ = a.audits.Log(r.Context(), req.ApplicationID, requestedBy, "mcp.approval.create", item.RequestID, "pending", map[string]any{
			"gateway_id": item.GatewayID,
			"tool":       item.ToolServer + ":" + item.ToolName,
			"action":     item.Action,
			"resource":   item.Resource,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(item)
}

func (a *API) handleListMCPApprovalRequests(w http.ResponseWriter, r *http.Request) {
	if a.mcpApprovalRepo == nil {
		http.Error(w, "mcp approval repo not configured", http.StatusNotImplemented)
		return
	}
	filter := storage.MCPApprovalFilter{
		Limit:  50,
		Offset: 0,
	}
	if v := r.URL.Query().Get("status"); v != "" {
		st := storage.MCPApprovalStatus(v)
		filter.Status = &st
	}
	if v := r.URL.Query().Get("gateway_id"); v != "" {
		filter.GatewayID = v
	}
	if v := r.URL.Query().Get("application_id"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			filter.ApplicationID = &id
		}
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			filter.Limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			filter.Offset = n
		}
	}
	items, total, err := a.mcpApprovalRepo.List(r.Context(), filter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(mcpApprovalListResponse{Items: items, Total: total})
}

func (a *API) handleGetMCPApprovalRequest(w http.ResponseWriter, r *http.Request) {
	if a.mcpApprovalRepo == nil {
		http.Error(w, "mcp approval repo not configured", http.StatusNotImplemented)
		return
	}
	item, err := a.mcpApprovalRepo.GetByRequestID(r.Context(), chi.URLParam(r, "requestId"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if item == nil {
		http.Error(w, "approval request not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func (a *API) handleApproveMCPApprovalRequest(w http.ResponseWriter, r *http.Request) {
	a.transitionMCPApproval(w, r, "approve")
}

func (a *API) handleRejectMCPApprovalRequest(w http.ResponseWriter, r *http.Request) {
	a.transitionMCPApproval(w, r, "reject")
}

func (a *API) handleExpireMCPApprovalRequest(w http.ResponseWriter, r *http.Request) {
	a.transitionMCPApproval(w, r, "expire")
}

func (a *API) transitionMCPApproval(w http.ResponseWriter, r *http.Request, action string) {
	if a.mcpApprovalRepo == nil {
		http.Error(w, "mcp approval repo not configured", http.StatusNotImplemented)
		return
	}
	requestID := chi.URLParam(r, "requestId")
	actor := actorFromContext(r)

	var (
		item *storage.MCPApprovalRequest
		err  error
	)
	switch action {
	case "approve":
		item, err = a.mcpApprovalRepo.Approve(r.Context(), requestID, actor)
	case "reject":
		var req mcpApprovalRejectRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		item, err = a.mcpApprovalRepo.Reject(r.Context(), requestID, actor, req.Reason)
	case "expire":
		item, err = a.mcpApprovalRepo.Expire(r.Context(), requestID)
	default:
		http.Error(w, "unsupported action", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if a.audits != nil {
		decision := string(item.Status)
		_ = a.audits.Log(r.Context(), item.ApplicationID, actor, "mcp.approval."+action, requestID, decision, nil)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}
