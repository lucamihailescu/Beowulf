package grpc

import (
	"context"
	"testing"

	authzv1 "cedar/api/gen/v1"
	"cedar/internal/authz"

	cedar "github.com/cedar-policy/cedar-go"
)

type benchPolicyProvider struct {
	policies  []authz.PolicyText
	policySet *cedar.PolicySet
}

func newBenchPolicyProvider() *benchPolicyProvider {
	policyText := `permit(principal, action, resource);`
	var policy cedar.Policy
	_ = policy.UnmarshalCedar([]byte(policyText))
	ps := cedar.NewPolicySet()
	ps.Add(cedar.PolicyID("p1"), &policy)
	return &benchPolicyProvider{
		policies:  []authz.PolicyText{{ID: "p1", Text: policyText}},
		policySet: ps,
	}
}

func (p *benchPolicyProvider) ActivePolicies(context.Context, int64) ([]authz.PolicyText, error) {
	return p.policies, nil
}

func (p *benchPolicyProvider) ActivePolicySet(context.Context, int64) (*cedar.PolicySet, error) {
	return p.policySet, nil
}

type benchEntityProvider struct {
	entities cedar.EntityMap
}

func (e *benchEntityProvider) Entities(context.Context, int64) (cedar.EntityMap, error) {
	return e.entities, nil
}

func (e *benchEntityProvider) SearchEntities(context.Context, int64, string, int) ([]string, error) {
	return []string{}, nil
}

func newBenchmarkServer() *Server {
	svc := authz.NewService(newBenchPolicyProvider(), &benchEntityProvider{entities: cedar.EntityMap{}})
	return &Server{
		authzService: svc,
		port:         "50051",
	}
}

func benchmarkCheckRequest() *authzv1.CheckRequest {
	return &authzv1.CheckRequest{
		ApplicationId: "1",
		Principal:     &authzv1.Entity{Type: "User", Id: "alice"},
		Action:        &authzv1.Entity{Type: "Action", Id: "view"},
		Resource:      &authzv1.Entity{Type: "Document", Id: "doc-1"},
		Context:       map[string]*authzv1.Value{},
	}
}

func benchmarkBatchRequest(size int) *authzv1.BatchCheckRequest {
	checks := make([]*authzv1.CheckRequest, size)
	for i := 0; i < size; i++ {
		checks[i] = benchmarkCheckRequest()
	}
	return &authzv1.BatchCheckRequest{Checks: checks}
}

func BenchmarkServerCheck(b *testing.B) {
	s := newBenchmarkServer()
	ctx := context.Background()
	req := benchmarkCheckRequest()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.Check(ctx, req); err != nil {
			b.Fatalf("check failed: %v", err)
		}
	}
}

func BenchmarkServerBatchCheck_10(b *testing.B) {
	benchmarkServerBatchCheck(b, 10)
}

func BenchmarkServerBatchCheck_100(b *testing.B) {
	benchmarkServerBatchCheck(b, 100)
}

func BenchmarkServerBatchCheck_500(b *testing.B) {
	benchmarkServerBatchCheck(b, 500)
}

func benchmarkServerBatchCheck(b *testing.B, size int) {
	s := newBenchmarkServer()
	ctx := context.Background()
	req := benchmarkBatchRequest(size)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.BatchCheck(ctx, req); err != nil {
			b.Fatalf("batch check failed: %v", err)
		}
	}
}
