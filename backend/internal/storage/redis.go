package storage

import (
	"github.com/redis/go-redis/extra/redisotel/v9"
	"github.com/redis/go-redis/v9"
)

// NewRedis constructs a Redis client.
func NewRedis(addr, password string) *redis.Client {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       0,
	})

	if err := redisotel.InstrumentTracing(rdb); err != nil {
		panic(err)
	}

	return rdb
}
