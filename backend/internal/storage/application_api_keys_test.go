package storage

import (
	"strings"
	"testing"
)

func TestGenerateAndParseApplicationAPIKey(t *testing.T) {
	fullKey, prefix, err := generateApplicationAPIKey(42)
	if err != nil {
		t.Fatalf("generateApplicationAPIKey failed: %v", err)
	}
	if fullKey == "" || prefix == "" {
		t.Fatalf("expected non-empty key and prefix")
	}
	if !strings.HasPrefix(prefix, "cedar_app_42_") {
		t.Fatalf("unexpected prefix format: %q", prefix)
	}

	parsedPrefix, err := parseApplicationAPIKeyPrefix(fullKey)
	if err != nil {
		t.Fatalf("parseApplicationAPIKeyPrefix failed: %v", err)
	}
	if parsedPrefix != prefix {
		t.Fatalf("expected parsed prefix %q, got %q", prefix, parsedPrefix)
	}
}

func TestParseApplicationAPIKeyPrefixRejectsInvalidValues(t *testing.T) {
	cases := []string{
		"",
		"abc",
		"cedar_app_1_onlyprefix",
		"wrongprefix.secret",
		".secret",
		"cedar_app_1_.",
	}
	for _, tc := range cases {
		if _, err := parseApplicationAPIKeyPrefix(tc); err == nil {
			t.Fatalf("expected parse to fail for %q", tc)
		}
	}
}
