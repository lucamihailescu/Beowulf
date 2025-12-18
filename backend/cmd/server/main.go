package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/joho/godotenv"

	"cedar/internal/authz"
	"cedar/internal/config"
	internalgrpc "cedar/internal/grpc"
	"cedar/internal/httpserver"
	"cedar/internal/simulation"
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
	backendAuthRepo := storage.NewBackendAuthRepo(db.Writer())
	backendInstanceRepo := storage.NewBackendInstanceRepo(db.Writer())
	backendInstanceRepo.SetAuthRepo(backendAuthRepo) // For auto-approval when approval_required is false

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

	// Create simulation service
	simRepo := storage.NewSimulationRepo(db)
	simSvc := simulation.NewService(simRepo, policyRepo, entityRepo, nil) // nil for audit log reader (falls back to sample data)

	// Create instance registry for cluster discovery (requires Redis)
	var instanceRegistry *storage.InstanceRegistry
	if redisClient != nil {
		hostname, _ := os.Hostname()
		instanceID := fmt.Sprintf("%s-%d", hostname, time.Now().UnixNano()%10000)
		instanceRegistry = storage.NewInstanceRegistry(redisClient, instanceID)
		// Connect to database for persistent registration and approval workflow
		instanceRegistry.SetBackendInstanceRepo(backendInstanceRepo)
	}

	// Start gRPC server
	grpcServer := internalgrpc.NewServer(cfg, authzSvc)
	go func() {
		if err := grpcServer.Start(); err != nil {
			log.Printf("gRPC server failed: %v", err)
		}
	}()

	r := httpserver.NewRouter(cfg, authzSvc, appRepo, policyRepo, entityRepo, schemaRepo, auditRepo, namespaceRepo, settingsRepo, backendAuthRepo, backendInstanceRepo, cache, cache, db, instanceRegistry, simSvc)

	// Start instance registry heartbeat (after router sets the status function)
	if instanceRegistry != nil {
		instanceRegistry.Start(ctx)
		defer instanceRegistry.Stop(context.Background())
	}

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
