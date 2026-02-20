package authz

import "testing"

func TestParsePolicyNamespacedReferences(t *testing.T) {
	policy := `permit (
  principal == AgentGuardrails::User::"alice",
  action == AgentGuardrails::Action::"email.send",
  resource == AgentGuardrails::EmailRecipient::"foo_at_bar"
);`

	parsed := ParsePolicy("p1", policy)
	if parsed.Effect != "permit" {
		t.Fatalf("expected permit effect, got %q", parsed.Effect)
	}
	if parsed.PrincipalType != "AgentGuardrails::User" || parsed.PrincipalID != "alice" {
		t.Fatalf("unexpected principal parse: %+v", parsed)
	}
	if len(parsed.Actions) != 1 || parsed.Actions[0] != "email.send" {
		t.Fatalf("unexpected actions parse: %+v", parsed.Actions)
	}
	if parsed.ResourceType != "AgentGuardrails::EmailRecipient" {
		t.Fatalf("unexpected resource type: %q", parsed.ResourceType)
	}
	if len(parsed.ResourceIDs) != 1 || parsed.ResourceIDs[0] != "foo_at_bar" {
		t.Fatalf("unexpected resource ids: %+v", parsed.ResourceIDs)
	}
}

func TestParsePolicyActionInNamespacedReferences(t *testing.T) {
	policy := `permit (
  principal,
  action in [
    AgentGuardrails::Action::"jira.read",
    AgentGuardrails::Action::"jira.write"
  ],
  resource
);`

	parsed := ParsePolicy("p2", policy)
	if len(parsed.Actions) != 2 {
		t.Fatalf("expected 2 actions, got %d", len(parsed.Actions))
	}
	if parsed.Actions[0] != "jira.read" || parsed.Actions[1] != "jira.write" {
		t.Fatalf("unexpected action values: %+v", parsed.Actions)
	}
}

func TestMatchesPrincipalWithNamespacedGroupMembership(t *testing.T) {
	policy := `permit (
  principal in AgentGuardrails::Team::"delegated-email-users",
  action,
  resource
);`

	parsed := ParsePolicy("p3", policy)
	groups := []GroupRef{
		{Type: "AgentGuardrails::Team", ID: "delegated-email-users"},
	}
	if !parsed.MatchesPrincipal("AgentGuardrails::User", "alice", groups) {
		t.Fatalf("expected principal to match namespaced group membership")
	}
}
