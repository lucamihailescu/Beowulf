package storage

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	cedar "github.com/cedar-policy/cedar-go"
	"github.com/redis/go-redis/v9"

	"cedar/internal/authz"
)

type benchBasePolicyProvider struct {
	policies []authz.PolicyText
}

func (p *benchBasePolicyProvider) ActivePolicies(context.Context, int64) ([]authz.PolicyText, error) {
	return p.policies, nil
}

func (p *benchBasePolicyProvider) ActivePolicySet(context.Context, int64) (*cedar.PolicySet, error) {
	ps := cedar.NewPolicySet()
	for _, pText := range p.policies {
		var policy cedar.Policy
		if err := policy.UnmarshalCedar([]byte(pText.Text)); err != nil {
			return nil, err
		}
		ps.Add(cedar.PolicyID(pText.ID), &policy)
	}
	return ps, nil
}

type benchBaseEntityProvider struct {
	entities cedar.EntityMap
}

func (e *benchBaseEntityProvider) Entities(context.Context, int64) (cedar.EntityMap, error) {
	return e.entities, nil
}

func (e *benchBaseEntityProvider) SearchEntities(context.Context, int64, string, int) ([]string, error) {
	return []string{}, nil
}

func newBenchmarkRedisClient(tb testing.TB) *redis.Client {
	tb.Helper()
	mr := miniredis.RunT(tb)
	return redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})
}

func newCachedProvidersForBenchmark(tb testing.TB) (*Cache, *CachedPolicyProvider, *CachedEntityProvider) {
	tb.Helper()
	rdb := newBenchmarkRedisClient(tb)
	tb.Cleanup(func() {
		_ = rdb.Close()
	})

	cache := NewCache(rdb, 5*time.Minute)
	policyProvider := NewCachedPolicyProvider(cache, &benchBasePolicyProvider{
		policies: []authz.PolicyText{
			{ID: "p1", Text: `permit(principal, action, resource);`},
		},
	})
	entityProvider := NewCachedEntityProvider(cache, &benchBaseEntityProvider{
		entities: cedar.EntityMap{},
	})
	return cache, policyProvider, entityProvider
}

func BenchmarkCachedPolicyProviderWarm(b *testing.B) {
	ctx := context.Background()
	cache, policyProvider, _ := newCachedProvidersForBenchmark(b)
	const appID int64 = 1

	// Prime L1 cache before measuring.
	_, _ = policyProvider.ActivePolicySet(ctx, appID)
	_ = cache.InvalidateApp(ctx, appID)
	_, _ = policyProvider.ActivePolicySet(ctx, appID)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := policyProvider.ActivePolicySet(ctx, appID); err != nil {
			b.Fatalf("warm policy set failed: %v", err)
		}
	}
}

func BenchmarkCachedPolicyProviderCold(b *testing.B) {
	ctx := context.Background()
	cache, policyProvider, _ := newCachedProvidersForBenchmark(b)
	const appID int64 = 1

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cache.InvalidateApp(ctx, appID)
		if _, err := policyProvider.ActivePolicySet(ctx, appID); err != nil {
			b.Fatalf("cold policy set failed: %v", err)
		}
	}
}

func BenchmarkCachedEntityProviderWarm(b *testing.B) {
	ctx := context.Background()
	cache, _, entityProvider := newCachedProvidersForBenchmark(b)
	const appID int64 = 1

	// Prime L1 cache before measuring.
	_, _ = entityProvider.Entities(ctx, appID)
	_ = cache.InvalidateApp(ctx, appID)
	_, _ = entityProvider.Entities(ctx, appID)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := entityProvider.Entities(ctx, appID); err != nil {
			b.Fatalf("warm entities failed: %v", err)
		}
	}
}

func BenchmarkCachedEntityProviderCold(b *testing.B) {
	ctx := context.Background()
	cache, _, entityProvider := newCachedProvidersForBenchmark(b)
	const appID int64 = 1

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cache.InvalidateApp(ctx, appID)
		if _, err := entityProvider.Entities(ctx, appID); err != nil {
			b.Fatalf("cold entities failed: %v", err)
		}
	}
}
