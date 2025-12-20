package observability

import (
	"context"
	"fmt"
	"strings"

	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
)

var (
	currentProvider *sdktrace.TracerProvider
	mu              sync.Mutex
)

// Config holds observability settings.
type Config struct {
	Enabled  bool   `json:"enabled"`
	Endpoint string `json:"endpoint"`
}

// InitTracer initializes an OpenTelemetry tracer.
func InitTracer(ctx context.Context, serviceName string, cfg Config) (func(context.Context) error, error) {
	mu.Lock()
	defer mu.Unlock()

	// If already initialized, shutdown the old one
	if currentProvider != nil {
		_ = currentProvider.Shutdown(ctx)
	}

	if !cfg.Enabled {
		// Set NoOp provider
		otel.SetTracerProvider(otel.GetTracerProvider()) // Resets to default (NoOp if not set)
		// Actually, otel.GetTracerProvider() returns the global one.
		// To disable, we can just not set a new one, or set a NoOp one explicitly if needed.
		// But for simplicity, let's just return a no-op shutdown.
		return func(context.Context) error { return nil }, nil
	}

	var exporter sdktrace.SpanExporter
	var err error

	if cfg.Endpoint != "" {
		opts := []otlptracegrpc.Option{otlptracegrpc.WithInsecure()}
		if strings.Contains(cfg.Endpoint, "://") {
			opts = append(opts, otlptracegrpc.WithEndpointURL(cfg.Endpoint))
		} else {
			opts = append(opts, otlptracegrpc.WithEndpoint(cfg.Endpoint))
		}
		exporter, err = otlptracegrpc.New(ctx, opts...)
		if err != nil {
			return nil, fmt.Errorf("failed to create OTLP exporter: %w", err)
		}
	} else {
		// Fallback to stdout for local development if no OTLP endpoint is provided
		exporter, err = stdouttrace.New(stdouttrace.WithPrettyPrint())
		if err != nil {
			return nil, fmt.Errorf("failed to create stdout exporter: %w", err)
		}
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceNameKey.String(serviceName),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	currentProvider = tp
	return tp.Shutdown, nil
}
