package grpc

import (
	"context"
	"fmt"
	"log"
	"net"
	"strconv"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	authzv1 "cedar/api/gen/v1"
	"cedar/internal/authz"
	"cedar/internal/config"
)

type Server struct {
	authzv1.UnimplementedAuthorizationServiceServer
	authzService *authz.Service
	port         string
}

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

	grpcServer := grpc.NewServer()
	authzv1.RegisterAuthorizationServiceServer(grpcServer, s)
	
	// Enable reflection for tools like grpcurl
	reflection.Register(grpcServer)

	log.Printf("gRPC server listening on :%s", s.port)
	// Run in a goroutine if blocking, but Start() is usually called blocking.
	// The caller (main) should handle concurrency if needed.
	return grpcServer.Serve(lis)
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
	results := make([]*authzv1.CheckResponse, len(req.Checks))
	for i, check := range req.Checks {
		res, err := s.Check(ctx, check)
		if err != nil {
			results[i] = &authzv1.CheckResponse{
				Allowed: false,
				Errors:  []string{err.Error()},
			}
		} else {
			results[i] = res
		}
	}
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
