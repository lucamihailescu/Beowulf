package grpc

import (
	"context"
	"fmt"
	"log"
	"net"
	"runtime"
	"strconv"
	"sync"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"

	authzv1 "cedar/api/gen/v1"
	"cedar/internal/authz"
	"cedar/internal/config"
)

type Server struct {
	authzv1.UnimplementedAuthorizationServiceServer
	authzService *authz.Service
	port         string
	grpcServer   *grpc.Server
}

const (
	maxBatchChecks      = 1000
	defaultBatchWorkers = 16
	minBatchWorkerCount = 1
)

func NewServer(cfg config.Config, service *authz.Service) *Server {
	// Use a separate port for gRPC, e.g., 50051, or derive from config
	return &Server{
		authzService: service,
		port:         "50051",
	}
}

func (s *Server) Start() error {
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", s.port))
	if err != nil {
		return fmt.Errorf("failed to listen: %v", err)
	}

	s.grpcServer = grpc.NewServer(
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
	)
	authzv1.RegisterAuthorizationServiceServer(s.grpcServer, s)

	// Enable reflection for tools like grpcurl
	reflection.Register(s.grpcServer)

	log.Printf("gRPC server listening on :%s", s.port)
	// Run in a goroutine if blocking, but Start() is usually called blocking.
	// The caller (main) should handle concurrency if needed.
	return s.grpcServer.Serve(lis)
}

// GracefulStop gracefully stops the gRPC server
func (s *Server) GracefulStop() {
	if s.grpcServer != nil {
		s.grpcServer.GracefulStop()
	}
}

func (s *Server) Check(ctx context.Context, req *authzv1.CheckRequest) (*authzv1.CheckResponse, error) {
	appID, err := strconv.ParseInt(req.ApplicationId, 10, 64)
	if err != nil {
		return &authzv1.CheckResponse{
			Allowed: false,
			Errors:  []string{fmt.Sprintf("invalid application_id: %v", err)},
		}, nil
	}

	// Construct the context map
	evalContext := make(map[string]interface{})
	for k, v := range req.Context {
		switch kind := v.Kind.(type) {
		case *authzv1.Value_StringValue:
			evalContext[k] = kind.StringValue
		case *authzv1.Value_IntValue:
			evalContext[k] = kind.IntValue
		case *authzv1.Value_BoolValue:
			evalContext[k] = kind.BoolValue
		}
	}

	result, err := s.authzService.Evaluate(ctx, authz.EvaluateInput{
		ApplicationID: appID,
		Principal:     authz.Reference{Type: req.Principal.Type, ID: req.Principal.Id},
		Action:        authz.Reference{Type: req.Action.Type, ID: req.Action.Id},
		Resource:      authz.Reference{Type: req.Resource.Type, ID: req.Resource.Id},
		Context:       evalContext,
	})

	if err != nil {
		// If evaluation failed (e.g. app not found), return error in gRPC error or in response?
		// For now, let's return it as an implementation error.
		return nil, err
	}

	return &authzv1.CheckResponse{
		Allowed: result.Decision == "allow",
		Reasons: result.Reasons,
		Errors:  result.Errors,
	}, nil
}

func (s *Server) BatchCheck(ctx context.Context, req *authzv1.BatchCheckRequest) (*authzv1.BatchCheckResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request is required")
	}
	if len(req.Checks) > maxBatchChecks {
		return nil, status.Errorf(codes.InvalidArgument, "batch size %d exceeds maximum %d", len(req.Checks), maxBatchChecks)
	}
	if len(req.Checks) == 0 {
		return &authzv1.BatchCheckResponse{Results: []*authzv1.CheckResponse{}}, nil
	}

	results := make([]*authzv1.CheckResponse, len(req.Checks))

	type batchJob struct {
		idx   int
		check *authzv1.CheckRequest
	}

	workerCount := runtime.GOMAXPROCS(0)
	if workerCount < minBatchWorkerCount {
		workerCount = minBatchWorkerCount
	}
	if workerCount > defaultBatchWorkers {
		workerCount = defaultBatchWorkers
	}
	if workerCount > len(req.Checks) {
		workerCount = len(req.Checks)
	}

	jobs := make(chan batchJob)
	var wg sync.WaitGroup
	wg.Add(workerCount)

	for i := 0; i < workerCount; i++ {
		go func() {
			defer wg.Done()
			for job := range jobs {
				// Respect cancellation to avoid unnecessary work.
				if err := ctx.Err(); err != nil {
					results[job.idx] = &authzv1.CheckResponse{
						Allowed: false,
						Errors:  []string{err.Error()},
					}
					continue
				}

				res, err := s.Check(ctx, job.check)
				if err != nil {
					results[job.idx] = &authzv1.CheckResponse{
						Allowed: false,
						Errors:  []string{err.Error()},
					}
					continue
				}
				results[job.idx] = res
			}
		}()
	}

	for idx, check := range req.Checks {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return nil, status.Error(codes.Canceled, ctx.Err().Error())
		case jobs <- batchJob{idx: idx, check: check}:
		}
	}
	close(jobs)
	wg.Wait()

	return &authzv1.BatchCheckResponse{Results: results}, nil
}

func (s *Server) LookupResources(ctx context.Context, req *authzv1.LookupResourcesRequest) (*authzv1.LookupResourcesResponse, error) {
	appID, err := strconv.ParseInt(req.ApplicationId, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid application_id: %v", err)
	}

	// Construct the context map
	evalContext := make(map[string]interface{})
	for k, v := range req.Context {
		switch kind := v.Kind.(type) {
		case *authzv1.Value_StringValue:
			evalContext[k] = kind.StringValue
		case *authzv1.Value_IntValue:
			evalContext[k] = kind.IntValue
		case *authzv1.Value_BoolValue:
			evalContext[k] = kind.BoolValue
		}
	}

	ids, err := s.authzService.LookupResources(ctx, authz.LookupInput{
		ApplicationID: appID,
		Principal:     authz.Reference{Type: req.Principal.Type, ID: req.Principal.Id},
		Action:        authz.Reference{Type: req.Action.Type, ID: req.Action.Id},
		ResourceType:  req.ResourceType,
		Context:       evalContext,
	})

	if err != nil {
		return nil, err
	}

	return &authzv1.LookupResourcesResponse{ResourceIds: ids}, nil
}
