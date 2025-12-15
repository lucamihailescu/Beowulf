package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	cedar "github.com/cedar-policy/cedar-go"
	gocache "github.com/patrickmn/go-cache"
	"github.com/redis/go-redis/v9"

	"cedar/internal/authz"
)

const invalidationChannel = "cedar:invalidation"

type ctxKey string

const CtxKeyCacheSource ctxKey = "cache_source"

type Cache struct {
	rdb      *redis.Client
	local    *gocache.Cache
	ttl      time.Duration
	localTTL time.Duration
}

func NewCache(rdb *redis.Client, ttl time.Duration) *Cache {
	// L1 (Local) Cache: Cleanup interval set to 10 minutes.
	local := gocache.New(ttl, 10*time.Minute)

	c := &Cache{
		rdb:      rdb,
		local:    local,
		ttl:      ttl,
		localTTL: ttl,
	}

	if c.enabled() {
		go c.startInvalidationListener()
	}

	return c
}

func (c *Cache) enabled() bool {
	return c != nil && c.rdb != nil && c.ttl > 0
}

func (c *Cache) startInvalidationListener() {
	// Background context for long-running subscription
	ctx := context.Background()
	pubsub := c.rdb.Subscribe(ctx, invalidationChannel)
	defer pubsub.Close()

	// Wait for confirmation that subscription is created before returning could be better,
	// but strictly not required for this optimization.
	ch := pubsub.Channel()
	for msg := range ch {
		// Message payload is the AppID to invalidate
		appID, err := strconv.ParseInt(msg.Payload, 10, 64)
		if err != nil {
			log.Printf("Received invalid invalidation message: %s", msg.Payload)
			continue
		}
		c.local.Delete(c.keyActivePolicies(appID))
		c.local.Delete(c.keyEntities(appID))
	}
}

func (c *Cache) keyActivePolicies(appID int64) string {
	return fmt.Sprintf("cedar:app:%d:active_policies", appID)
}

func (c *Cache) keyEntities(appID int64) string {
	return fmt.Sprintf("cedar:app:%d:entities", appID)
}

// InvalidateApp clears cached authz inputs for a given app.
// It clears local cache, Redis cache, and publishes an invalidation event.
func (c *Cache) InvalidateApp(ctx context.Context, appID int64) error {
	if !c.enabled() {
		return nil
	}

	// 1. Clear Local Cache (L1) immediately
	c.local.Delete(c.keyActivePolicies(appID))
	c.local.Delete(c.keyEntities(appID))

	// 2. Clear Redis Cache (L2) & Publish Invalidation Event
	pipe := c.rdb.Pipeline()
	pipe.Del(ctx, c.keyActivePolicies(appID), c.keyEntities(appID))
	pipe.Publish(ctx, invalidationChannel, appID)

	_, err := pipe.Exec(ctx)
	return err
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

	// 1. Check L1 (Local Cache)
	if val, found := p.cache.local.Get(key); found {
		if policies, ok := val.([]authz.PolicyText); ok {
			setCacheSource(ctx, "L1")
			return policies, nil
		}
	}

	// 2. Check L2 (Redis Cache)
	var policies []authz.PolicyText
	if b, err := p.cache.rdb.Get(ctx, key).Bytes(); err == nil {
		if jsonErr := json.Unmarshal(b, &policies); jsonErr == nil {
			// Populate L1
			p.cache.local.Set(key, policies, p.cache.localTTL)
			setCacheSource(ctx, "L2")
			return policies, nil
		}
	} else if err != redis.Nil {
		// Log Redis error but continue
		log.Printf("Redis get error: %v", err)
	}

	// 3. Fetch from DB
	policies, err := p.base.ActivePolicies(ctx, applicationID)
	if err != nil {
		return nil, err
	}
	setCacheSource(ctx, "DB")

	// 4. Update L2 (Redis) - async to not block
	if b, err := json.Marshal(policies); err == nil {
		go func() {
			_ = p.cache.rdb.Set(context.Background(), key, b, p.cache.ttl).Err()
		}()
	}

	// 5. Update L1 (Local)
	p.cache.local.Set(key, policies, p.cache.localTTL)

	return policies, nil
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

	// 1. Check L1 (Local Cache)
	if val, found := e.cache.local.Get(key); found {
		if entities, ok := val.(cedar.EntityMap); ok {
			// Note: Entities also sets cache source, but Policies is usually checked first/primary
			// If both are hit, it stays L1. If mixed, last write wins.
			// Usually we care if *policies* were L1.
			return entities, nil
		}
	}

	// 2. Check L2 (Redis Cache)
	var entities cedar.EntityMap
	if b, err := e.cache.rdb.Get(ctx, key).Bytes(); err == nil {
		if jsonErr := json.Unmarshal(b, &entities); jsonErr == nil {
			// Populate L1
			e.cache.local.Set(key, entities, e.cache.localTTL)
			return entities, nil
		}
	} else if err != redis.Nil {
		log.Printf("Redis get error: %v", err)
	}

	// 3. Fetch from DB
	entities, err := e.base.Entities(ctx, applicationID)
	if err != nil {
		return nil, err
	}

	// 4. Update L2 (Redis) - async
	if b, err := json.Marshal(entities); err == nil {
		go func() {
			_ = e.cache.rdb.Set(context.Background(), key, b, e.cache.ttl).Err()
		}()
	}

	// 5. Update L1 (Local)
	e.cache.local.Set(key, entities, e.cache.localTTL)

	return entities, nil
}

func (e *CachedEntityProvider) SearchEntities(ctx context.Context, applicationID int64, entityType string) ([]string, error) {
	// For now, pass through to base provider (DB) without caching specific searches
	return e.base.SearchEntities(ctx, applicationID, entityType)
}

func setCacheSource(ctx context.Context, source string) {
	if ptr, ok := ctx.Value(CtxKeyCacheSource).(*string); ok && ptr != nil {
		*ptr = source
	}
}
