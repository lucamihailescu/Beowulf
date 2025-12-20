package storage

import (
	"context"
	"fmt"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB holds connection pools for write and read operations.
type DB struct {
	writePool *pgxpool.Pool
	readPool  *pgxpool.Pool
}

// NewDB creates a new DB instance with write and optional read pools.
func NewDB(ctx context.Context, writeURL string, readURL string, maxConns, minConns int32) (*DB, error) {
	writePool, err := newPool(ctx, writeURL, maxConns, minConns)
	if err != nil {
		return nil, fmt.Errorf("connect to write db: %w", err)
	}

	readPool := writePool
	if readURL != "" && readURL != writeURL {
		readPool, err = newPool(ctx, readURL, maxConns, minConns)
		if err != nil {
			writePool.Close()
			return nil, fmt.Errorf("connect to read db: %w", err)
		}
	}

	return &DB{
		writePool: writePool,
		readPool:  readPool,
	}, nil
}

func newPool(ctx context.Context, url string, maxConns, minConns int32) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}

	if maxConns > 0 {
		cfg.MaxConns = maxConns
	}
	if minConns > 0 {
		cfg.MinConns = minConns
	}

	cfg.ConnConfig.Tracer = otelpgx.NewTracer()

	return pgxpool.NewWithConfig(ctx, cfg)
}

// Close closes all database connections.
func (db *DB) Close() {
	db.writePool.Close()
	if db.readPool != db.writePool {
		db.readPool.Close()
	}
}

// Writer returns the write pool.
func (db *DB) Writer() *pgxpool.Pool {
	return db.writePool
}

// Reader returns the read pool.
func (db *DB) Reader() *pgxpool.Pool {
	return db.readPool
}

// PingContext checks if the database connection is alive.
func (db *DB) PingContext(ctx context.Context) error {
	if err := db.writePool.Ping(ctx); err != nil {
		return fmt.Errorf("write pool: %w", err)
	}
	if db.readPool != db.writePool {
		if err := db.readPool.Ping(ctx); err != nil {
			return fmt.Errorf("read pool: %w", err)
		}
	}
	return nil
}
