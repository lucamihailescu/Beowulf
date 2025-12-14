package storage

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPostgres creates a connection pool.
func NewPostgres(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}
