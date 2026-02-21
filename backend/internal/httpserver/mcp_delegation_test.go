package httpserver

import (
	"context"
	"net/http/httptest"
	"testing"
)

func TestParseTime(t *testing.T) {
	t.Parallel()

	if _, err := parseTime(""); err == nil {
		t.Fatalf("expected error for empty value")
	}
	if _, err := parseTime("2026-02-20T10:00:00Z"); err != nil {
		t.Fatalf("expected valid RFC3339, got error: %v", err)
	}
	if _, err := parseTime("2026-02-20T10:00:00.123456Z"); err != nil {
		t.Fatalf("expected valid RFC3339Nano, got error: %v", err)
	}
}

func TestActorFromContext(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "/", nil)
	if got := actorFromContext(req); got != "system" {
		t.Fatalf("expected system actor, got %q", got)
	}

	ctx := context.WithValue(req.Context(), UserContextKey, &UserContext{ID: "alice"})
	req = req.WithContext(ctx)
	if got := actorFromContext(req); got != "alice" {
		t.Fatalf("expected alice actor, got %q", got)
	}
}
