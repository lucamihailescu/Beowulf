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
	"golang.org/x/sync/singleflight"

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
	sf       singleflight.Group
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
		c.local.Delete(c.keyActivePolicySet(appID))
		c.local.Delete(c.keyEntities(appID))
	}
}

func (c *Cache) keyActivePolicies(appID int64) string {
	return fmt.Sprintf("cedar:app:%d:active_policies", appID)
}

func (c *Cache) keyActivePolicySet(appID int64) string {
	return fmt.Sprintf("cedar:app:%d:active_policy_set", appID)
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
	c.local.Delete(c.keyActivePolicySet(appID))
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

	// 3. Coalesce cache misses to avoid thundering herd.
	val, err, _ := p.cache.sf.Do(key, func() (interface{}, error) {
		// Recheck L1 while under singleflight in case another request populated it.
		if l1Val, found := p.cache.local.Get(key); found {
			if l1Policies, ok := l1Val.([]authz.PolicyText); ok {
				setCacheSource(ctx, "L1")
				return l1Policies, nil
			}
		}

		// Recheck L2 as well.
		var l2Policies []authz.PolicyText
		if b, redisErr := p.cache.rdb.Get(ctx, key).Bytes(); redisErr == nil {
			if jsonErr := json.Unmarshal(b, &l2Policies); jsonErr == nil {
				p.cache.local.Set(key, l2Policies, p.cache.localTTL)
				setCacheSource(ctx, "L2")
				return l2Policies, nil
			}
		} else if redisErr != redis.Nil {
			log.Printf("Redis get error: %v", redisErr)
		}

		policies, dbErr := p.base.ActivePolicies(ctx, applicationID)
		if dbErr != nil {
			return nil, dbErr
		}
		setCacheSource(ctx, "DB")

		// Write-through cache update; keep synchronous to avoid unbounded goroutines.
		if b, marshalErr := json.Marshal(policies); marshalErr == nil {
			if setErr := p.cache.rdb.Set(ctx, key, b, p.cache.ttl).Err(); setErr != nil {
				log.Printf("Redis set error: %v", setErr)
			}
		}
		p.cache.local.Set(key, policies, p.cache.localTTL)
		return policies, nil
	})
	if err != nil {
		return nil, err
	}
	policies, ok := val.([]authz.PolicyText)
	if !ok {
		return nil, fmt.Errorf("unexpected policy cache value type %T", val)
	}
	return policies, nil
}

func (p *CachedPolicyProvider) ActivePolicySet(ctx context.Context, applicationID int64) (*cedar.PolicySet, error) {
	if p.cache == nil || !p.cache.enabled() {
		return p.base.ActivePolicySet(ctx, applicationID)
	}

	setKey := p.cache.keyActivePolicySet(applicationID)
	textKey := p.cache.keyActivePolicies(applicationID)

	// 1. Check L1 (Local Cache) for pre-parsed PolicySet
	if val, found := p.cache.local.Get(setKey); found {
		if ps, ok := val.(*cedar.PolicySet); ok {
			setCacheSource(ctx, "L1")
			return ps, nil
		}
	}

	// 2. Check L2 (Redis Cache) for raw policy text
	var policies []authz.PolicyText
	if b, err := p.cache.rdb.Get(ctx, textKey).Bytes(); err == nil {
		if jsonErr := json.Unmarshal(b, &policies); jsonErr == nil {
			// Parse to PolicySet
			ps := cedar.NewPolicySet()
			for _, pText := range policies {
				var policy cedar.Policy
				if err := policy.UnmarshalCedar([]byte(pText.Text)); err != nil {
					return nil, fmt.Errorf("parse policy %s: %w", pText.ID, err)
				}
				ps.Add(cedar.PolicyID(pText.ID), &policy)
			}
			// Populate L1
			p.cache.local.Set(setKey, ps, p.cache.localTTL)
			setCacheSource(ctx, "L2")
			return ps, nil
		}
	} else if err != redis.Nil {
		log.Printf("Redis get error: %v", err)
	}

	// 3. Coalesce cache misses/parsing work.
	val, err, _ := p.cache.sf.Do(setKey, func() (interface{}, error) {
		// Recheck L1 set cache.
		if l1Val, found := p.cache.local.Get(setKey); found {
			if l1PS, ok := l1Val.(*cedar.PolicySet); ok {
				setCacheSource(ctx, "L1")
				return l1PS, nil
			}
		}

		// Recheck L2 text cache.
		var l2Policies []authz.PolicyText
		if b, redisErr := p.cache.rdb.Get(ctx, textKey).Bytes(); redisErr == nil {
			if jsonErr := json.Unmarshal(b, &l2Policies); jsonErr == nil {
				l2PS := cedar.NewPolicySet()
				for _, pText := range l2Policies {
					var policy cedar.Policy
					if parseErr := policy.UnmarshalCedar([]byte(pText.Text)); parseErr != nil {
						return nil, fmt.Errorf("parse policy %s: %w", pText.ID, parseErr)
					}
					l2PS.Add(cedar.PolicyID(pText.ID), &policy)
				}
				p.cache.local.Set(setKey, l2PS, p.cache.localTTL)
				setCacheSource(ctx, "L2")
				return l2PS, nil
			}
		} else if redisErr != redis.Nil {
			log.Printf("Redis get error: %v", redisErr)
		}

		policies, dbErr := p.base.ActivePolicies(ctx, applicationID)
		if dbErr != nil {
			return nil, dbErr
		}
		setCacheSource(ctx, "DB")

		ps := cedar.NewPolicySet()
		for _, pText := range policies {
			var policy cedar.Policy
			if parseErr := policy.UnmarshalCedar([]byte(pText.Text)); parseErr != nil {
				return nil, fmt.Errorf("parse policy %s: %w", pText.ID, parseErr)
			}
			ps.Add(cedar.PolicyID(pText.ID), &policy)
		}

		// Write-through update; no per-request goroutine.
		if b, marshalErr := json.Marshal(policies); marshalErr == nil {
			if setErr := p.cache.rdb.Set(ctx, textKey, b, p.cache.ttl).Err(); setErr != nil {
				log.Printf("Redis set error: %v", setErr)
			}
		}
		p.cache.local.Set(setKey, ps, p.cache.localTTL)
		return ps, nil
	})
	if err != nil {
		return nil, err
	}
	ps, ok := val.(*cedar.PolicySet)
	if !ok {
		return nil, fmt.Errorf("unexpected policy set cache value type %T", val)
	}
	return ps, nil
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

	// 3. Coalesce misses and expensive DB loads.
	val, err, _ := e.cache.sf.Do(key, func() (interface{}, error) {
		// Recheck L1 inside singleflight.
		if l1Val, found := e.cache.local.Get(key); found {
			if l1Entities, ok := l1Val.(cedar.EntityMap); ok {
				return l1Entities, nil
			}
		}

		// Recheck L2 as another request may have already filled it.
		var l2Entities cedar.EntityMap
		if b, redisErr := e.cache.rdb.Get(ctx, key).Bytes(); redisErr == nil {
			if jsonErr := json.Unmarshal(b, &l2Entities); jsonErr == nil {
				e.cache.local.Set(key, l2Entities, e.cache.localTTL)
				return l2Entities, nil
			}
		} else if redisErr != redis.Nil {
			log.Printf("Redis get error: %v", redisErr)
		}

		entities, dbErr := e.base.Entities(ctx, applicationID)
		if dbErr != nil {
			return nil, dbErr
		}

		// Write-through cache update; keep synchronous for bounded resource usage.
		if b, marshalErr := json.Marshal(entities); marshalErr == nil {
			if setErr := e.cache.rdb.Set(ctx, key, b, e.cache.ttl).Err(); setErr != nil {
				log.Printf("Redis set error: %v", setErr)
			}
		}
		e.cache.local.Set(key, entities, e.cache.localTTL)
		return entities, nil
	})
	if err != nil {
		return nil, err
	}
	entities, ok := val.(cedar.EntityMap)
	if !ok {
		return nil, fmt.Errorf("unexpected entities cache value type %T", val)
	}
	return entities, nil
}

func (e *CachedEntityProvider) SearchEntities(ctx context.Context, applicationID int64, entityType string, limit int) ([]string, error) {
	// For now, pass through to base provider (DB) without caching specific searches
	return e.base.SearchEntities(ctx, applicationID, entityType, limit)
}

func setCacheSource(ctx context.Context, source string) {
	if ptr, ok := ctx.Value(CtxKeyCacheSource).(*string); ok && ptr != nil {
		*ptr = source
	}
}

// CacheStatistics holds cache statistics for health monitoring.
type CacheStatistics struct {
	L1Size    int
	L2Enabled bool
	HitRate   float64
}

// Ping checks if Redis is reachable.
func (c *Cache) Ping(ctx context.Context) error {
	if c == nil || c.rdb == nil {
		return fmt.Errorf("cache not configured")
	}
	return c.rdb.Ping(ctx).Err()
}

// Stats returns cache statistics for health monitoring.
func (c *Cache) Stats() CacheStatistics {
	if c == nil {
		return CacheStatistics{}
	}

	stats := CacheStatistics{
		L2Enabled: c.rdb != nil,
	}

	if c.local != nil {
		stats.L1Size = c.local.ItemCount()
	}

	// Note: go-cache doesn't track hit/miss by default.
	// For a more accurate hit rate, you'd need to wrap Get calls.
	// For now, we return 0 (unknown).
	stats.HitRate = 0

	return stats
}
