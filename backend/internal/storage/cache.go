package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	cedar "github.com/cedar-policy/cedar-go"
	"github.com/redis/go-redis/v9"

	"cedar/internal/authz"
)

type Cache struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewCache(rdb *redis.Client, ttl time.Duration) *Cache {
	return &Cache{rdb: rdb, ttl: ttl}
}

func (c *Cache) enabled() bool {
	return c != nil && c.rdb != nil && c.ttl > 0
}

func (c *Cache) keyActivePolicies(appID int64) string {
	return fmt.Sprintf("cedar:app:%d:active_policies", appID)
}

func (c *Cache) keyEntities(appID int64) string {
	return fmt.Sprintf("cedar:app:%d:entities", appID)
}

// InvalidateApp clears cached authz inputs for a given app.
// This is best-effort and should not be treated as a hard failure.
func (c *Cache) InvalidateApp(ctx context.Context, appID int64) error {
	if !c.enabled() {
		return nil
	}
	return c.rdb.Del(ctx, c.keyActivePolicies(appID), c.keyEntities(appID)).Err()
}

type CachedPolicyProvider struct {
	cache *Cache
	base  authz.PolicyProvider
}

func NewCachedPolicyProvider(cache *Cache, base authz.PolicyProvider) *CachedPolicyProvider {
	return &CachedPolicyProvider{cache: cache, base: base}
}

func (p *CachedPolicyProvider) ActivePolicies(ctx context.Context, applicationID int64) ([]authz.PolicyText, error) {
	if p.cache == nil || !p.cache.enabled() {
		return p.base.ActivePolicies(ctx, applicationID)
	}

	key := p.cache.keyActivePolicies(applicationID)
	if b, err := p.cache.rdb.Get(ctx, key).Bytes(); err == nil {
		var out []authz.PolicyText
		if jsonErr := json.Unmarshal(b, &out); jsonErr == nil {
			return out, nil
		}
	} else if err != redis.Nil {
		// Cache failure should not fail authorization.
	}

	out, err := p.base.ActivePolicies(ctx, applicationID)
	if err != nil {
		return nil, err
	}
	if b, err := json.Marshal(out); err == nil {
		_ = p.cache.rdb.Set(ctx, key, b, p.cache.ttl).Err()
	}
	return out, nil
}

type CachedEntityProvider struct {
	cache *Cache
	base  authz.EntityProvider
}

func NewCachedEntityProvider(cache *Cache, base authz.EntityProvider) *CachedEntityProvider {
	return &CachedEntityProvider{cache: cache, base: base}
}

func (e *CachedEntityProvider) Entities(ctx context.Context, applicationID int64) (cedar.EntityMap, error) {
	if e.cache == nil || !e.cache.enabled() {
		return e.base.Entities(ctx, applicationID)
	}

	key := e.cache.keyEntities(applicationID)
	if b, err := e.cache.rdb.Get(ctx, key).Bytes(); err == nil {
		var out cedar.EntityMap
		if jsonErr := json.Unmarshal(b, &out); jsonErr == nil {
			return out, nil
		}
	} else if err != redis.Nil {
		// Cache failure should not fail authorization.
	}

	out, err := e.base.Entities(ctx, applicationID)
	if err != nil {
		return nil, err
	}
	if b, err := json.Marshal(out); err == nil {
		_ = e.cache.rdb.Set(ctx, key, b, e.cache.ttl).Err()
	}
	return out, nil
}

func (e *CachedEntityProvider) SearchEntities(ctx context.Context, applicationID int64, entityType string) ([]string, error) {
	// For now, pass through to base provider (DB) without caching specific searches
	return e.base.SearchEntities(ctx, applicationID, entityType)
}
