package storage

import "testing"

func TestHashTokenDeterministic(t *testing.T) {
	t.Parallel()

	a := hashToken("token-123")
	b := hashToken("token-123")
	c := hashToken("token-456")

	if a == "" || len(a) != 64 {
		t.Fatalf("expected 64-char sha256 hash, got %q", a)
	}
	if a != b {
		t.Fatalf("expected same input to produce same hash")
	}
	if a == c {
		t.Fatalf("expected different inputs to produce different hashes")
	}
}
