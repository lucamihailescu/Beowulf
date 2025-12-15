package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	cedar "github.com/cedar-policy/cedar-go"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"cedar/internal/authz"
	"cedar/internal/config"
	"cedar/internal/storage"
)

type CacheInvalidator interface {
	InvalidateApp(ctx context.Context, appID int64) error
}

type healthResponse struct {
	Status string `json:"status"`
}

type authorizeRequest struct {
	ApplicationID int64           `json:"application_id"`
	Principal     entityReference `json:"principal"`
	Action        entityReference `json:"action"`
	Resource      entityReference `json:"resource"`
	Context       map[string]any  `json:"context,omitempty"`
}

type entityReference struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type authorizeResponse struct {
	Decision string   `json:"decision"`
	Reasons  []string `json:"reasons"`
	Errors   []string `json:"errors"`
}

type createAppRequest struct {
	Name        string `json:"name"`
	NamespaceID int64  `json:"namespace_id"`
	Description string `json:"description"`
}

type createNamespaceRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type createPolicyRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	PolicyText  string `json:"policy_text"`
	Activate    bool   `json:"activate"`
}

type upsertEntityRequest struct {
	Type       string              `json:"type"`
	ID         string              `json:"id"`
	Attributes json.RawMessage     `json:"attributes"`
	Parents    []storage.ParentRef `json:"parents"`
}

type createSchemaRequest struct {
	SchemaText string `json:"schema_text"`
	Activate   bool   `json:"activate"`
}

type activateSchemaRequest struct {
	Version int `json:"version"`
}

type auditListResponse struct {
	Items []storage.AuditLog `json:"items"`
	Total int                `json:"total"`
}

// AuditLogger is used to record audit events.
type AuditLogger interface {
	Log(ctx context.Context, applicationID *int64, actor, action, target, decision string, auditContext map[string]any) error
}

// SchemaProvider is used to validate policies against schemas.
type SchemaProvider interface {
	GetActiveSchema(ctx context.Context, applicationID int64) (*storage.Schema, error)
}

// NewRouter configures the HTTP router with basic endpoints.
func NewRouter(cfg config.Config, authzSvc *authz.Service, apps *storage.ApplicationRepo, policies *storage.PolicyRepo, entities *storage.EntityRepo, schemas *storage.SchemaRepo, audits *storage.AuditRepo, namespaces *storage.NamespaceRepo, cache CacheInvalidator) http.Handler {
	r := chi.NewRouter()
	r.Use(corsMiddleware(cfg))
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// Initialize auth middleware
	authMiddleware, err := NewAuthMiddleware(cfg)
	if err != nil {
		panic("failed to create auth middleware: " + err.Error())
	}
	r.Use(authMiddleware.Middleware)

	// Initialize rate limiter (must be after auth middleware to access user context)
	if rateLimiter := NewRateLimiter(cfg); rateLimiter != nil {
		r.Use(rateLimiter)
	}

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(healthResponse{Status: "ok"})
	})

	// Get current authenticated user
	r.Get("/v1/me", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		user := GetUserFromContext(r.Context())
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "not authenticated"})
			return
		}
		_ = json.NewEncoder(w).Encode(user)
	})

	r.Post("/v1/authorize", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req authorizeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request payload"})
			return
		}

		if req.ApplicationID == 0 || req.Principal.Type == "" || req.Action.Type == "" || req.Resource.Type == "" || req.Principal.ID == "" || req.Action.ID == "" || req.Resource.ID == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "application_id, principal, action, and resource are required"})
			return
		}

		// Prepare context with cache source tracker
		var cacheSource string = "DB" // Default if not updated
		ctx := context.WithValue(r.Context(), storage.CtxKeyCacheSource, &cacheSource)

		result, err := authzSvc.Evaluate(ctx, authz.EvaluateInput{
			ApplicationID: req.ApplicationID,
			Principal:     authz.Reference{Type: req.Principal.Type, ID: req.Principal.ID},
			Action:        authz.Reference{Type: req.Action.Type, ID: req.Action.ID},
			Resource:      authz.Reference{Type: req.Resource.Type, ID: req.Resource.ID},
			Context:       req.Context,
		})
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		// Set response header to indicate cache source (L1, L2, or DB)
		w.Header().Set("X-Cedar-Cache", cacheSource)

		// Log authorization decision to audit trail
		if audits != nil {
			appID := req.ApplicationID
			principal := req.Principal.Type + "::" + req.Principal.ID
			action := req.Action.Type + "::" + req.Action.ID
			resource := req.Resource.Type + "::" + req.Resource.ID

			// Get the authenticated caller (service/user making the request)
			caller := "unknown"
			if user := GetUserFromContext(r.Context()); user != nil {
				caller = user.ID
			}

			auditCtx := map[string]any{
				"caller":    caller,    // Authenticated service/user making the request
				"principal": principal, // Subject of the authorization check
				"action":    action,
				"resource":  resource,
				"reasons":   result.Reasons,
				"errors":    result.Errors,
			}
			if req.Context != nil {
				auditCtx["request_context"] = req.Context
			}
			// Actor is the authenticated caller, not the principal being checked
			_ = audits.Log(r.Context(), &appID, caller, "authorize", resource, result.Decision, auditCtx)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(authorizeResponse{
			Decision: result.Decision,
			Reasons:  result.Reasons,
			Errors:   result.Errors,
		})
	})

	r.Route("/v1/apps", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			appsList, err := apps.List(r.Context())
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(appsList)
		})

		r.Post("/", func(w http.ResponseWriter, r *http.Request) {
			var req createAppRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid request payload"})
				return
			}
			if req.Name == "" || req.NamespaceID == 0 {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "name and namespace_id are required"})
				return
			}

			id, err := apps.Create(r.Context(), req.Name, req.NamespaceID, req.Description)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}

			// Log application creation to audit trail
			if audits != nil {
				auditCtx := map[string]any{
					"name":         req.Name,
					"namespace_id": req.NamespaceID,
					"description":  req.Description,
				}
				_ = audits.Log(r.Context(), &id, "api", "application.create", req.Name, "", auditCtx)
			}

			json.NewEncoder(w).Encode(map[string]any{"id": id})
		})
	})

	// Namespace endpoints
	r.Route("/v1/namespaces", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			list, err := namespaces.List(r.Context())
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			if list == nil {
				list = []storage.Namespace{}
			}
			json.NewEncoder(w).Encode(list)
		})

		r.Post("/", func(w http.ResponseWriter, r *http.Request) {
			var req createNamespaceRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid request payload"})
				return
			}
			if req.Name == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "name is required"})
				return
			}

			id, err := namespaces.Create(r.Context(), req.Name, req.Description)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}

			// Log namespace creation to audit trail
			if audits != nil {
				auditCtx := map[string]any{
					"name":        req.Name,
					"description": req.Description,
				}
				_ = audits.Log(r.Context(), nil, "api", "namespace.create", req.Name, "", auditCtx)
			}

			json.NewEncoder(w).Encode(map[string]any{"id": id})
		})
	})

	r.Post("/v1/apps/{id}/policies", func(w http.ResponseWriter, r *http.Request) {
		appID, err := parseIDParam(r, "id")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
			return
		}

		var req createPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request payload"})
			return
		}
		if req.Name == "" || req.PolicyText == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "name and policy_text are required"})
			return
		}

		// Validate Cedar syntax early.
		var tmpPolicy cedar.Policy
		if err := tmpPolicy.UnmarshalCedar([]byte(req.PolicyText)); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid cedar policy syntax: " + err.Error()})
			return
		}

		// Check if schema exists for information purposes
		// Note: Runtime policy-against-schema validation requires cedar-go schema validation support
		// For now, we record if a schema exists for the application
		var hasActiveSchema bool
		if schemas != nil {
			activeSchema, err := schemas.GetActiveSchema(r.Context(), appID)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "failed to check schema: " + err.Error()})
				return
			}
			hasActiveSchema = activeSchema != nil
		}
		_ = hasActiveSchema // Available for future schema validation integration

		policyID, version, err := policies.UpsertPolicyWithVersion(r.Context(), appID, req.Name, req.Description, req.PolicyText, req.Activate)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		if cache != nil {
			_ = cache.InvalidateApp(r.Context(), appID)
		}

		// Log policy creation/update to audit trail
		if audits != nil {
			auditAction := "policy.create"
			auditCtx := map[string]any{
				"policy_name": req.Name,
				"version":     version,
				"activated":   req.Activate,
			}
			_ = audits.Log(r.Context(), &appID, "api", auditAction, req.Name, "", auditCtx)
		}

		json.NewEncoder(w).Encode(map[string]any{"policy_id": policyID, "version": version})
	})

	r.Get("/v1/apps/{id}/policies", func(w http.ResponseWriter, r *http.Request) {
		appID, err := parseIDParam(r, "id")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
			return
		}

		items, err := policies.ListPolicies(r.Context(), appID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(items)
	})

	r.Get("/v1/apps/{id}/policies/{policyId}", func(w http.ResponseWriter, r *http.Request) {
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

		item, err := policies.GetPolicy(r.Context(), appID, policyID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(item)
	})

	r.Post("/v1/apps/{id}/entities", func(w http.ResponseWriter, r *http.Request) {
		appID, err := parseIDParam(r, "id")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
			return
		}

		var req upsertEntityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request payload"})
			return
		}
		if req.Type == "" || req.ID == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "type and id are required"})
			return
		}

		if err := entities.UpsertEntity(r.Context(), appID, req.Type, req.ID, req.Attributes, req.Parents); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		if cache != nil {
			_ = cache.InvalidateApp(r.Context(), appID)
		}

		// Log entity upsert to audit trail
		if audits != nil {
			entityRef := req.Type + "::" + req.ID
			auditCtx := map[string]any{
				"entity_type": req.Type,
				"entity_id":   req.ID,
			}
			if len(req.Parents) > 0 {
				auditCtx["parents"] = req.Parents
			}
			_ = audits.Log(r.Context(), &appID, "api", "entity.upsert", entityRef, "", auditCtx)
		}

		w.WriteHeader(http.StatusNoContent)
	})

	r.Get("/v1/apps/{id}/entities", func(w http.ResponseWriter, r *http.Request) {
		appID, err := parseIDParam(r, "id")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
			return
		}
		entitiesMap, err := entities.Entities(r.Context(), appID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(entitiesMap)
	})

	// Schema endpoints
	r.Route("/v1/apps/{id}/schemas", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			appID, err := parseIDParam(r, "id")
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
				return
			}
			items, err := schemas.ListSchemas(r.Context(), appID)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			if items == nil {
				items = []storage.Schema{}
			}
			json.NewEncoder(w).Encode(items)
		})

		r.Post("/", func(w http.ResponseWriter, r *http.Request) {
			appID, err := parseIDParam(r, "id")
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
				return
			}

			var req createSchemaRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid request payload"})
				return
			}
			if req.SchemaText == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "schema_text is required"})
				return
			}

			// Validate Cedar schema syntax (JSON format)
			var schemaCheck map[string]any
			if err := json.Unmarshal([]byte(req.SchemaText), &schemaCheck); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid cedar schema JSON: " + err.Error()})
				return
			}

			schemaID, version, err := schemas.CreateSchema(r.Context(), appID, req.SchemaText, req.Activate)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}

			// Log schema creation to audit trail
			if audits != nil {
				auditCtx := map[string]any{
					"version":   version,
					"activated": req.Activate,
				}
				_ = audits.Log(r.Context(), &appID, "api", "schema.create", "", "", auditCtx)
			}

			json.NewEncoder(w).Encode(map[string]any{"schema_id": schemaID, "version": version})
		})

		r.Get("/active", func(w http.ResponseWriter, r *http.Request) {
			appID, err := parseIDParam(r, "id")
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
				return
			}
			schema, err := schemas.GetActiveSchema(r.Context(), appID)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			if schema == nil {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"error": "no active schema"})
				return
			}
			json.NewEncoder(w).Encode(schema)
		})

		r.Post("/activate", func(w http.ResponseWriter, r *http.Request) {
			appID, err := parseIDParam(r, "id")
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
				return
			}

			var req activateSchemaRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid request payload"})
				return
			}
			if req.Version <= 0 {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "version is required"})
				return
			}

			if err := schemas.ActivateSchema(r.Context(), appID, req.Version); err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}

			// Log schema activation to audit trail
			if audits != nil {
				auditCtx := map[string]any{
					"version": req.Version,
				}
				_ = audits.Log(r.Context(), &appID, "api", "schema.activate", "", "", auditCtx)
			}

			w.WriteHeader(http.StatusNoContent)
		})
	})

	// Permissions endpoint - list permissions for a principal
	r.Get("/v1/apps/{id}/permissions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		appID, err := parseIDParam(r, "id")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
			return
		}

		principalType := r.URL.Query().Get("principal_type")
		principalID := r.URL.Query().Get("principal_id")

		if principalType == "" || principalID == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "principal_type and principal_id query parameters are required"})
			return
		}

		// Create permissions service with entity adapter for group memberships
		groupProvider := &entityGroupAdapter{entities: entities}
		permSvc := authz.NewPermissionsService(policies, groupProvider)

		result, err := permSvc.ListPermissions(r.Context(), appID, principalType, principalID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		json.NewEncoder(w).Encode(result)
	})

	// Audit log endpoints
	r.Route("/v1/audit", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			filter := storage.AuditFilter{
				Limit:  50,
				Offset: 0,
			}

			// Parse query params
			if v := r.URL.Query().Get("application_id"); v != "" {
				if id, err := strconv.ParseInt(v, 10, 64); err == nil {
					filter.ApplicationID = &id
				}
			}
			if v := r.URL.Query().Get("action"); v != "" {
				filter.Action = v
			}
			if v := r.URL.Query().Get("decision"); v != "" {
				filter.Decision = v
			}
			if v := r.URL.Query().Get("limit"); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
					filter.Limit = n
				}
			}
			if v := r.URL.Query().Get("offset"); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n >= 0 {
					filter.Offset = n
				}
			}

			items, total, err := audits.List(r.Context(), filter)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			if items == nil {
				items = []storage.AuditLog{}
			}
			json.NewEncoder(w).Encode(auditListResponse{Items: items, Total: total})
		})
	})

	return r
}

func parseIDParam(r *http.Request, key string) (int64, error) {
	val := chi.URLParam(r, key)
	return strconv.ParseInt(val, 10, 64)
}

// entityGroupAdapter adapts storage.EntityRepo to authz.GroupMembershipProvider.
type entityGroupAdapter struct {
	entities *storage.EntityRepo
}

func (a *entityGroupAdapter) GetGroupMemberships(ctx context.Context, applicationID int64, entityType, entityID string) ([]authz.GroupRef, error) {
	parents, err := a.entities.GetGroupMemberships(ctx, applicationID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	result := make([]authz.GroupRef, len(parents))
	for i, p := range parents {
		result[i] = authz.GroupRef{Type: p.Type, ID: p.ID}
	}
	return result, nil
}
