package ldap

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// Cache key prefixes
	groupCachePrefix = "cedar:ldap:groups:"
	userCachePrefix  = "cedar:ldap:user:"
)

// GroupCache provides Redis-backed caching for LDAP group memberships.
type GroupCache struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewGroupCache creates a new group cache backed by Redis.
func NewGroupCache(rdb *redis.Client, ttl time.Duration) *GroupCache {
	if ttl == 0 {
		ttl = 5 * time.Minute
	}
	return &GroupCache{
		rdb: rdb,
		ttl: ttl,
	}
}

// GetUserGroups retrieves cached group memberships for a user.
// Returns nil if not found in cache.
func (c *GroupCache) GetUserGroups(ctx context.Context, userDN string) ([]string, error) {
	if c.rdb == nil {
		return nil, nil
	}

	key := groupCachePrefix + userDN
	data, err := c.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil // Cache miss
	}
	if err != nil {
		return nil, fmt.Errorf("redis get: %w", err)
	}

	var groups []string
	if err := json.Unmarshal([]byte(data), &groups); err != nil {
		return nil, fmt.Errorf("unmarshal groups: %w", err)
	}

	return groups, nil
}

// SetUserGroups caches group memberships for a user.
func (c *GroupCache) SetUserGroups(ctx context.Context, userDN string, groups []string) error {
	if c.rdb == nil {
		return nil
	}

	data, err := json.Marshal(groups)
	if err != nil {
		return fmt.Errorf("marshal groups: %w", err)
	}

	key := groupCachePrefix + userDN
	if err := c.rdb.Set(ctx, key, data, c.ttl).Err(); err != nil {
		return fmt.Errorf("redis set: %w", err)
	}

	return nil
}

// InvalidateUserGroups removes cached group memberships for a user.
func (c *GroupCache) InvalidateUserGroups(ctx context.Context, userDN string) error {
	if c.rdb == nil {
		return nil
	}

	key := groupCachePrefix + userDN
	return c.rdb.Del(ctx, key).Err()
}

// GetUser retrieves a cached user by username.
func (c *GroupCache) GetUser(ctx context.Context, username string) (*User, error) {
	if c.rdb == nil {
		return nil, nil
	}

	key := userCachePrefix + username
	data, err := c.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil // Cache miss
	}
	if err != nil {
		return nil, fmt.Errorf("redis get: %w", err)
	}

	var user User
	if err := json.Unmarshal([]byte(data), &user); err != nil {
		return nil, fmt.Errorf("unmarshal user: %w", err)
	}

	return &user, nil
}

// SetUser caches a user.
func (c *GroupCache) SetUser(ctx context.Context, username string, user *User) error {
	if c.rdb == nil {
		return nil
	}

	data, err := json.Marshal(user)
	if err != nil {
		return fmt.Errorf("marshal user: %w", err)
	}

	key := userCachePrefix + username
	if err := c.rdb.Set(ctx, key, data, c.ttl).Err(); err != nil {
		return fmt.Errorf("redis set: %w", err)
	}

	return nil
}

// InvalidateUser removes a cached user.
func (c *GroupCache) InvalidateUser(ctx context.Context, username string) error {
	if c.rdb == nil {
		return nil
	}

	key := userCachePrefix + username
	return c.rdb.Del(ctx, key).Err()
}

// SetTTL updates the cache TTL for new entries.
func (c *GroupCache) SetTTL(ttl time.Duration) {
	c.ttl = ttl
}





