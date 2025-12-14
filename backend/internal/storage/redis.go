package storage

import (
	"github.com/redis/go-redis/v9"
)

// NewRedis constructs a Redis client.
func NewRedis(addr, password string) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       0,
	})
}
