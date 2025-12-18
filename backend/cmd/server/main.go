package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/joho/godotenv"

	"cedar/internal/authz"
	"cedar/internal/config"
	internalgrpc "cedar/internal/grpc"
	"cedar/internal/httpserver"
	"cedar/internal/storage"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()
	ctx := context.Background()

	db, err := storage.NewDB(ctx, cfg.DBURL, cfg.DBReadURL, cfg.DBMaxConns, cfg.DBMinConns)
	if err != nil {
		log.Fatalf("failed to connect to postgres: %v", err)
	}
	defer db.Close()

	appRepo := storage.NewApplicationRepo(db)
	policyRepo := storage.NewPolicyRepo(db)
	entityRepo := storage.NewEntityRepo(db)
	schemaRepo := storage.NewSchemaRepo(db)
	auditRepo := storage.NewAuditRepo(db)
	namespaceRepo := storage.NewNamespaceRepo(db)
	settingsRepo := storage.NewSettingsRepo(db)

	var cache *storage.Cache
	redisClient := storage.NewRedis(cfg.RedisAddr, cfg.RedisPass)
	defer func() {
		_ = redisClient.Close()
	}()
	if cfg.AuthzCacheTTL > 0 {
		pingCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
		defer cancel()
		if err := redisClient.Ping(pingCtx).Err(); err != nil {
			log.Printf("redis unavailable (%v); authz cache disabled", err)
		} else {
			cache = storage.NewCache(redisClient, cfg.AuthzCacheTTL)
		}
	}

	policyProvider := authz.PolicyProvider(policyRepo)
	entityProvider := authz.EntityProvider(entityRepo)
	if cache != nil {
		policyProvider = storage.NewCachedPolicyProvider(cache, policyRepo)
		entityProvider = storage.NewCachedEntityProvider(cache, entityRepo)
	}

	authzSvc := authz.NewService(policyProvider, entityProvider)

	// Start gRPC server
	grpcServer := internalgrpc.NewServer(cfg, authzSvc)
	go func() {
		if err := grpcServer.Start(); err != nil {
			log.Printf("gRPC server failed: %v", err)
		}
	}()

	r := httpserver.NewRouter(cfg, authzSvc, appRepo, policyRepo, entityRepo, schemaRepo, auditRepo, namespaceRepo, settingsRepo, cache)

	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("server starting on %s", cfg.Addr())
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}
