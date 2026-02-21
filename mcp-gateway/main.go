package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

type config struct {
	Enabled            bool
	Port               string
	BackendURL         string
	DefaultAppID       int64
	GatewayID          string
	GatewayName        string
	GatewayEndpoint    string
	GatewayAuthMode    string
	RegisterInterval   time.Duration
	ApprovalActions    map[string]struct{}
	ServerAllowlist    []string
	ApprovalTTLSeconds int64
}

type gatewayServer struct {
	cfg       config
	http      *http.Client
	startedAt time.Time
}

type entityRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type invokeRequest struct {
	ApplicationID      int64          `json:"application_id"`
	Principal          entityRef      `json:"principal"`
	ActionID           string         `json:"action_id,omitempty"`
	ToolServer         string         `json:"tool_server"`
	ToolName           string         `json:"tool_name"`
	ToolInput          any            `json:"tool_input,omitempty"`
	Context            map[string]any `json:"context,omitempty"`
	DelegationToken    string         `json:"delegation_token,omitempty"`
	ApprovalRequestID  string         `json:"approval_request_id,omitempty"`
	RequireApproval    bool           `json:"require_approval,omitempty"`
	DownstreamURL      string         `json:"downstream_url,omitempty"`
	DownstreamTimeoutS int            `json:"downstream_timeout_seconds,omitempty"`
}

type authorizeRequest struct {
	ApplicationID int64          `json:"application_id"`
	Principal     entityRef      `json:"principal"`
	Action        entityRef      `json:"action"`
	Resource      entityRef      `json:"resource"`
	Context       map[string]any `json:"context,omitempty"`
}

type authorizeResponse struct {
	Decision string   `json:"decision"`
	Reasons  []string `json:"reasons"`
	Errors   []string `json:"errors"`
}

type approvalResponse struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
}

type introspectResponse struct {
	Active bool `json:"active"`
	Grant  struct {
		GrantID       string `json:"grant_id"`
		DelegatorType string `json:"delegator_type"`
		DelegatorID   string `json:"delegator_id"`
		DelegateType  string `json:"delegate_type"`
		DelegateID    string `json:"delegate_id"`
		ScopeAction   string `json:"scope_action"`
	} `json:"grant"`
}

func main() {
	cfg := loadConfig()
	s := &gatewayServer{
		cfg:       cfg,
		http:      &http.Client{Timeout: 10 * time.Second},
		startedAt: time.Now(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/v1/tool/invoke", s.handleInvokeTool)
	mux.HandleFunc("/v1/register", s.handleRegisterNow)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.registerLoop(ctx)
	go func() {
		log.Printf("mcp-gateway listening on :%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}

func loadConfig() config {
	gatewayID := getenv("MCP_GATEWAY_ID", "")
	if gatewayID == "" {
		host, _ := os.Hostname()
		gatewayID = fmt.Sprintf("%s-%d", host, time.Now().UnixNano()%10000)
	}
	actions := map[string]struct{}{}
	for _, action := range strings.Split(getenv("MCP_GATEWAY_APPROVAL_ACTIONS", ""), ",") {
		action = strings.TrimSpace(action)
		if action != "" {
			actions[action] = struct{}{}
		}
	}
	allowlist := []string{}
	for _, item := range strings.Split(getenv("MCP_SERVER_ALLOWLIST", ""), ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			allowlist = append(allowlist, item)
		}
	}
	return config{
		Enabled:            getenvBool("MCP_GATEWAY_ENABLED", true),
		Port:               getenv("APP_PORT", "8090"),
		BackendURL:         strings.TrimRight(getenv("CEDAR_BACKEND_URL", "http://backend:8080"), "/"),
		DefaultAppID:       getenvInt64("CEDAR_APP_ID", 1),
		GatewayID:          gatewayID,
		GatewayName:        getenv("MCP_GATEWAY_NAME", "cedar-mcp-gateway"),
		GatewayEndpoint:    getenv("MCP_GATEWAY_ENDPOINT", ""),
		GatewayAuthMode:    getenv("MCP_GATEWAY_AUTH_MODE", "none"),
		RegisterInterval:   getenvDuration("MCP_GATEWAY_REGISTER_INTERVAL", 10*time.Second),
		ApprovalActions:    actions,
		ServerAllowlist:    allowlist,
		ApprovalTTLSeconds: getenvInt64("MCP_GATEWAY_APPROVAL_TTL_SECONDS", 300),
	}
}

func (s *gatewayServer) handleHealth(w http.ResponseWriter, _ *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":     "ok",
		"gateway_id": s.cfg.GatewayID,
		"uptime":     time.Since(s.startedAt).String(),
	})
}

func (s *gatewayServer) handleRegisterNow(w http.ResponseWriter, r *http.Request) {
	if err := s.register(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "registered"})
}

func (s *gatewayServer) registerLoop(ctx context.Context) {
	_ = s.register(ctx)
	ticker := time.NewTicker(s.cfg.RegisterInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := s.register(ctx); err != nil {
				log.Printf("mcp-gateway register failed: %v", err)
			}
		case <-ctx.Done():
			return
		}
	}
}

func (s *gatewayServer) register(ctx context.Context) error {
	payload := map[string]any{
		"gateway_id": s.cfg.GatewayID,
		"name":       s.cfg.GatewayName,
		"endpoint":   s.cfg.GatewayEndpoint,
		"auth_mode":  s.cfg.GatewayAuthMode,
		"metadata": map[string]any{
			"uptime_seconds": int64(time.Since(s.startedAt).Seconds()),
			"version":        "v1",
		},
	}
	_, _, err := s.postJSON(ctx, s.cfg.BackendURL+"/v1/mcp/gateways/register", payload)
	return err
}

func (s *gatewayServer) handleInvokeTool(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Enabled {
		http.Error(w, "mcp gateway disabled", http.StatusServiceUnavailable)
		return
	}
	ctx := r.Context()
	var req invokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.ToolServer == "" || req.ToolName == "" {
		http.Error(w, "tool_server and tool_name are required", http.StatusBadRequest)
		return
	}
	if req.Principal.Type == "" || req.Principal.ID == "" {
		http.Error(w, "principal is required", http.StatusBadRequest)
		return
	}
	if req.ActionID == "" {
		req.ActionID = "tool.invoke"
	}
	if req.ApplicationID == 0 {
		req.ApplicationID = s.cfg.DefaultAppID
	}

	principal := req.Principal
	if req.DelegationToken != "" {
		intro, err := s.introspectDelegation(ctx, req.DelegationToken)
		if err != nil {
			http.Error(w, "delegation introspection failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		if !intro.Active {
			http.Error(w, "delegation token inactive", http.StatusForbidden)
			return
		}
		if intro.Grant.ScopeAction != "" && intro.Grant.ScopeAction != req.ActionID {
			http.Error(w, "delegation scope does not allow action", http.StatusForbidden)
			return
		}
		principal = entityRef{Type: intro.Grant.DelegatorType, ID: intro.Grant.DelegatorID}
		if req.Context == nil {
			req.Context = map[string]any{}
		}
		req.Context["delegation_grant_id"] = intro.Grant.GrantID
		req.Context["delegated_actor"] = fmt.Sprintf("%s::%s", intro.Grant.DelegateType, intro.Grant.DelegateID)
	}

	resourceID := req.ToolServer + ":" + req.ToolName
	shouldRequireApproval := req.RequireApproval || s.actionNeedsApproval(req.ActionID)
	if shouldRequireApproval {
		if req.ApprovalRequestID == "" {
			created, err := s.createApproval(ctx, req, principal, resourceID)
			if err != nil {
				http.Error(w, "create approval failed: "+err.Error(), http.StatusBadGateway)
				return
			}
			_ = s.audit(ctx, req.ApplicationID, "mcp.gateway.pending_approval", resourceID, "pending", map[string]any{
				"approval_request_id": created.RequestID,
				"tool_server":         req.ToolServer,
				"tool_name":           req.ToolName,
			})
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":              "pending_approval",
				"approval_request_id": created.RequestID,
			})
			return
		}
		approval, err := s.getApproval(ctx, req.ApprovalRequestID)
		if err != nil {
			http.Error(w, "check approval failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		if approval.Status != "approved" {
			statusCode := http.StatusAccepted
			if approval.Status == "rejected" || approval.Status == "expired" {
				statusCode = http.StatusForbidden
			}
			w.WriteHeader(statusCode)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":              approval.Status,
				"approval_request_id": req.ApprovalRequestID,
			})
			return
		}
		if req.Context == nil {
			req.Context = map[string]any{}
		}
		req.Context["approval_status"] = "approved"
		req.Context["approval_request_id"] = req.ApprovalRequestID
	}

	decision, err := s.authorize(ctx, authorizeRequest{
		ApplicationID: req.ApplicationID,
		Principal:     principal,
		Action:        entityRef{Type: "MCP::Action", ID: req.ActionID},
		Resource:      entityRef{Type: "MCP::Tool", ID: resourceID},
		Context:       req.Context,
	})
	if err != nil {
		http.Error(w, "authorize failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	if decision.Decision != "allow" {
		_ = s.audit(ctx, req.ApplicationID, "mcp.gateway.decision", resourceID, "deny", map[string]any{
			"tool_server": req.ToolServer,
			"tool_name":   req.ToolName,
			"reasons":     decision.Reasons,
			"errors":      decision.Errors,
		})
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":   "denied",
			"decision": decision.Decision,
			"reasons":  decision.Reasons,
			"errors":   decision.Errors,
		})
		return
	}

	var downstream any
	var downstreamErr error
	if req.DownstreamURL != "" {
		if !s.allowedDownstream(req.DownstreamURL) {
			http.Error(w, "downstream_url is not in allowlist", http.StatusBadRequest)
			return
		}
		downstream, downstreamErr = s.invokeDownstream(ctx, req)
	}
	if downstreamErr != nil {
		_ = s.audit(ctx, req.ApplicationID, "mcp.gateway.downstream_error", resourceID, "allow", map[string]any{
			"error": downstreamErr.Error(),
		})
		http.Error(w, "downstream invocation failed: "+downstreamErr.Error(), http.StatusBadGateway)
		return
	}

	_ = s.audit(ctx, req.ApplicationID, "mcp.gateway.decision", resourceID, "allow", map[string]any{
		"tool_server": req.ToolServer,
		"tool_name":   req.ToolName,
		"action_id":   req.ActionID,
	})
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":     "allowed",
		"decision":   decision.Decision,
		"downstream": downstream,
	})
}

func (s *gatewayServer) authorize(ctx context.Context, req authorizeRequest) (*authorizeResponse, error) {
	body, status, err := s.postJSON(ctx, s.cfg.BackendURL+"/v1/authorize", req)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("authorize status %d", status)
	}
	var out authorizeResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *gatewayServer) createApproval(ctx context.Context, req invokeRequest, principal entityRef, resourceID string) (*approvalResponse, error) {
	payload := map[string]any{
		"application_id":     req.ApplicationID,
		"gateway_id":         s.cfg.GatewayID,
		"principal_type":     principal.Type,
		"principal_id":       principal.ID,
		"action":             req.ActionID,
		"resource":           resourceID,
		"tool_server":        req.ToolServer,
		"tool_name":          req.ToolName,
		"requested_by":       "mcp-gateway",
		"reason":             "high-risk MCP action",
		"decision_context":   req.Context,
		"expires_in_seconds": s.cfg.ApprovalTTLSeconds,
	}
	body, _, err := s.postJSON(ctx, s.cfg.BackendURL+"/v1/mcp/approvals/", payload)
	if err != nil {
		return nil, err
	}
	var out approvalResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *gatewayServer) getApproval(ctx context.Context, requestID string) (*approvalResponse, error) {
	body, status, err := s.get(ctx, s.cfg.BackendURL+"/v1/mcp/approvals/"+requestID)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("approval status %d", status)
	}
	var out approvalResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *gatewayServer) introspectDelegation(ctx context.Context, token string) (*introspectResponse, error) {
	body, _, err := s.postJSON(ctx, s.cfg.BackendURL+"/v1/mcp/delegations/introspect", map[string]string{"token": token})
	if err != nil {
		return nil, err
	}
	var out introspectResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *gatewayServer) invokeDownstream(ctx context.Context, req invokeRequest) (any, error) {
	timeout := 20 * time.Second
	if req.DownstreamTimeoutS > 0 {
		timeout = time.Duration(req.DownstreamTimeoutS) * time.Second
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	payload := map[string]any{
		"tool":    req.ToolName,
		"server":  req.ToolServer,
		"input":   req.ToolInput,
		"context": req.Context,
	}
	body, status, err := s.postJSON(callCtx, req.DownstreamURL, payload)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("downstream returned status %d", status)
	}
	var out any
	if len(body) == 0 {
		return map[string]any{"status": "ok"}, nil
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return string(body), nil
	}
	return out, nil
}

func (s *gatewayServer) audit(ctx context.Context, appID int64, action, target, decision string, auditCtx map[string]any) error {
	payload := map[string]any{
		"application_id": &appID,
		"actor":          "mcp-gateway",
		"action":         action,
		"target":         target,
		"decision":       decision,
		"context":        auditCtx,
	}
	_, _, err := s.postJSON(ctx, s.cfg.BackendURL+"/v1/mcp/audit", payload)
	return err
}

func (s *gatewayServer) actionNeedsApproval(action string) bool {
	_, ok := s.cfg.ApprovalActions[action]
	return ok
}

func (s *gatewayServer) allowedDownstream(url string) bool {
	if len(s.cfg.ServerAllowlist) == 0 {
		return true
	}
	for _, prefix := range s.cfg.ServerAllowlist {
		if strings.HasPrefix(url, prefix) {
			return true
		}
	}
	return false
}

func (s *gatewayServer) postJSON(ctx context.Context, url string, payload any) ([]byte, int, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body := new(bytes.Buffer)
	_, _ = body.ReadFrom(resp.Body)
	return body.Bytes(), resp.StatusCode, nil
}

func (s *gatewayServer) get(ctx context.Context, url string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body := new(bytes.Buffer)
	_, _ = body.ReadFrom(resp.Body)
	return body.Bytes(), resp.StatusCode, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt64(key string, def int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	var out int64
	if _, err := fmt.Sscanf(v, "%d", &out); err != nil {
		return def
	}
	return out
}

func getenvDuration(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}

func getenvBool(key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return def
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}
