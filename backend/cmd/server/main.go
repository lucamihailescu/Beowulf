package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"cedar/internal/authz"
	"cedar/internal/config"
	internalgrpc "cedar/internal/grpc"
	"cedar/internal/httpserver"
	"cedar/internal/observability"
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

	// Initialize tracing
	obsEnabled := settingsRepo.GetValue(ctx, "observability.enabled") == "true"
	obsEndpoint := settingsRepo.GetValue(ctx, "observability.endpoint")
	// If not set in DB, check env var for backward compatibility
	if obsEndpoint == "" {
		obsEndpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	}
	// If env var is set but enabled is not set (default false), we might want to default to true if env var is present?
	// Or just stick to explicit enablement. Let's stick to explicit enablement via DB, but maybe default to true if env var is present and DB is empty?
	// For now, let's just use what's in DB. If DB is empty, it's disabled.
	// Exception: If OTEL_EXPORTER_OTLP_ENDPOINT is set, we assume it should be enabled initially if no DB setting exists.
	if obsEndpoint != "" && settingsRepo.GetValue(ctx, "observability.enabled") == "" {
		obsEnabled = true
	}

	shutdown, err := observability.InitTracer(ctx, "cedar-backend", observability.Config{
		Enabled:  obsEnabled,
		Endpoint: obsEndpoint,
	})
	if err != nil {
		log.Printf("failed to initialize tracer: %v", err)
	} else {
		defer func() {
			if err := shutdown(ctx); err != nil {
				log.Printf("failed to shutdown tracer: %v", err)
			}
		}()
	}

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

	r := httpserver.NewRouter(cfg, authzSvc, appRepo, policyRepo, entityRepo, schemaRepo, auditRepo, namespaceRepo, settingsRepo, backendAuthRepo, backendInstanceRepo, cache, cache, db, instanceRegistry, simSvc, redisClient)

	// Start instance registry heartbeat (after router sets the status function)
	if instanceRegistry != nil {
		instanceRegistry.Start(ctx)
	}

	// Start periodic stale backend cleanup (suspends backends with no heartbeat for 5 minutes)
	staleCleanupCtx, staleCleanupCancel := context.WithCancel(ctx)
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-staleCleanupCtx.Done():
				return
			case <-ticker.C:
				suspended, err := backendInstanceRepo.SuspendStale(staleCleanupCtx, 5*time.Minute)
				if err != nil {
					log.Printf("stale backend cleanup error: %v", err)
				} else if suspended > 0 {
					log.Printf("suspended %d stale backend(s) with no heartbeat for 5+ minutes", suspended)
				}
			}
		}
	}()

	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Set up graceful shutdown handler
	shutdownChan := make(chan os.Signal, 1)
	signal.Notify(shutdownChan, syscall.SIGTERM, syscall.SIGINT)

	// Start server in goroutine
	go func() {
		log.Printf("server starting on %s", cfg.Addr())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	// Wait for shutdown signal
	sig := <-shutdownChan
	log.Printf("received signal %v, initiating graceful shutdown...", sig)

	// Stop the stale backend cleanup goroutine
	staleCleanupCancel()

	// Create shutdown context with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Step 1: Mark this instance as offline/suspended so load balancer stops routing to it
	if instanceRegistry != nil {
		instanceID := instanceRegistry.GetInstanceID()
		log.Printf("marking instance %s as offline...", instanceID)

		// Suspend the backend in the database so it's removed from live-backends immediately
		if backendInstanceRepo != nil {
			_, err := backendInstanceRepo.Suspend(shutdownCtx, instanceID, "graceful_shutdown")
			if err != nil {
				log.Printf("warning: failed to suspend instance: %v", err)
			} else {
				log.Printf("instance marked as suspended")
			}
		}

		// Stop the heartbeat to prevent re-registration
		instanceRegistry.Stop(shutdownCtx)
	}

	// Step 2: Wait briefly for load balancer to pick up the change
	// This gives Nginx time to detect the backend is offline (check interval is typically 5-10s)
	drainDuration := 5 * time.Second
	log.Printf("waiting %v for load balancer to drain connections...", drainDuration)
	time.Sleep(drainDuration)

	// Step 3: Gracefully shutdown HTTP server (waits for active requests to complete)
	log.Printf("shutting down HTTP server...")
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	// Step 4: Stop gRPC server
	log.Printf("shutting down gRPC server...")
	grpcServer.GracefulStop()

	log.Printf("graceful shutdown complete")
}
