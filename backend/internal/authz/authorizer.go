package authz

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	cedar "github.com/cedar-policy/cedar-go"
)

// Reference identifies a Cedar entity (type + id).
type Reference struct {
	Type string
	ID   string
}

// EvaluateInput describes an authorization request scoped to an application.
type EvaluateInput struct {
	ApplicationID int64
	Principal     Reference
	Action        Reference
	Resource      Reference
	Context       map[string]any
}

// LookupInput describes a request to find accessible resources.
type LookupInput struct {
	ApplicationID int64
	Principal     Reference
	Action        Reference
	ResourceType  string
	Context       map[string]any
}

// EvaluationResult is a transport-friendly result for handlers.
type EvaluationResult struct {
	Decision string
	Reasons  []string
	Errors   []string
}

// PolicyProvider supplies active policy texts for an application.
type PolicyProvider interface {
	ActivePolicies(ctx context.Context, applicationID int64) ([]PolicyText, error)
	ActivePolicySet(ctx context.Context, applicationID int64) (*cedar.PolicySet, error)
}

// EntityProvider supplies entities for an application as Cedar-compatible data.
type EntityProvider interface {
	Entities(ctx context.Context, applicationID int64) (cedar.EntityMap, error)
	// SearchEntities returns IDs of entities of a specific type.
	SearchEntities(ctx context.Context, applicationID int64, entityType string) ([]string, error)
}

// PolicyText is a simple carrier for policy content.
type PolicyText struct {
	ID   string
	Text string
}

// Service encapsulates policy evaluation using cedar-go.
type Service struct {
	policies PolicyProvider
	entities EntityProvider
}

// NewService wires an authz service with its data providers.
func NewService(policies PolicyProvider, entities EntityProvider) *Service {
	return &Service{policies: policies, entities: entities}
}

// Evaluate loads policies/entities for the application and runs Cedar authorization.
func (s *Service) Evaluate(ctx context.Context, in EvaluateInput) (EvaluationResult, error) {
	ps, err := s.policies.ActivePolicySet(ctx, in.ApplicationID)
	if err != nil {
		return EvaluationResult{}, fmt.Errorf("load policies: %w", err)
	}

	entities, err := s.entities.Entities(ctx, in.ApplicationID)
	if err != nil {
		return EvaluationResult{}, fmt.Errorf("load entities: %w", err)
	}

	req := cedar.Request{
		Principal: cedar.NewEntityUID(cedar.EntityType(in.Principal.Type), cedar.String(in.Principal.ID)),
		Action:    cedar.NewEntityUID(cedar.EntityType(in.Action.Type), cedar.String(in.Action.ID)),
		Resource:  cedar.NewEntityUID(cedar.EntityType(in.Resource.Type), cedar.String(in.Resource.ID)),
		Context:   mapToRecord(in.Context),
	}

	decision, diag := cedar.Authorize(ps, entities, req)

	res := EvaluationResult{
		Decision: "deny",
		Reasons:  reasonsToStrings(diag.Reasons),
		Errors:   diagnosticErrorsToStrings(diag.Errors),
	}
	if decision == cedar.Allow {
		res.Decision = "allow"
	}

	return res, nil
}

// LookupResources returns a list of resource IDs of the given type that the principal can perform the action on.
func (s *Service) LookupResources(ctx context.Context, in LookupInput) ([]string, error) {
	// 1. Load Policies
	ps, err := s.policies.ActivePolicySet(ctx, in.ApplicationID)
	if err != nil {
		return nil, fmt.Errorf("load policies: %w", err)
	}

	// 2. Load Entities (Context for evaluation)
	entities, err := s.entities.Entities(ctx, in.ApplicationID)
	if err != nil {
		return nil, fmt.Errorf("load entities: %w", err)
	}

	// 3. Find candidate resources
	candidates, err := s.entities.SearchEntities(ctx, in.ApplicationID, in.ResourceType)
	if err != nil {
		return nil, fmt.Errorf("search entities: %w", err)
	}

	// 4. Evaluate for each candidate
	principal := cedar.NewEntityUID(cedar.EntityType(in.Principal.Type), cedar.String(in.Principal.ID))
	action := cedar.NewEntityUID(cedar.EntityType(in.Action.Type), cedar.String(in.Action.ID))
	context := mapToRecord(in.Context)
	targetType := cedar.EntityType(in.ResourceType)

	var allowedIDs []string
	for _, id := range candidates {
		req := cedar.Request{
			Principal: principal,
			Action:    action,
			Resource:  cedar.NewEntityUID(targetType, cedar.String(id)),
			Context:   context,
		}

		if decision, _ := cedar.Authorize(ps, entities, req); decision == cedar.Allow {
			allowedIDs = append(allowedIDs, id)
		}
	}

	return allowedIDs, nil
}

func mapToRecord(ctx map[string]any) cedar.Record {
	if len(ctx) == 0 {
		return cedar.NewRecord(cedar.RecordMap{})
	}
	rec := cedar.RecordMap{}
	for k, v := range ctx {
		rec[cedar.String(k)] = toValue(v)
	}
	return cedar.NewRecord(rec)
}

func toValue(v any) cedar.Value {
	switch t := v.(type) {
	case string:
		return cedar.String(t)
	case bool:
		if t {
			return cedar.True
		}
		return cedar.False
	case int:
		return cedar.Long(t)
	case int64:
		return cedar.Long(t)
	case float64:
		if math.Trunc(t) == t {
			return cedar.Long(int64(t))
		}
		return cedar.String(fmt.Sprint(t))
	case map[string]any:
		return mapToRecord(t)
	default:
		return cedar.String(fmt.Sprint(v))
	}
}

func reasonsToStrings(reasons []cedar.DiagnosticReason) []string {
	out := make([]string, 0, len(reasons))
	for _, r := range reasons {
		if data, err := json.Marshal(r); err == nil {
			out = append(out, string(data))
			continue
		}
		out = append(out, fmt.Sprintf("%v", r))
	}
	return out
}

func diagnosticErrorsToStrings(errs []cedar.DiagnosticError) []string {
	out := make([]string, 0, len(errs))
	for _, e := range errs {
		out = append(out, e.String())
	}
	return out
}
