package authz

import (
	"regexp"
	"strings"
)

// ParsedPolicy represents structured data extracted from a Cedar policy.
type ParsedPolicy struct {
	PolicyID      string   `json:"policy_id"`
	Effect        string   `json:"effect"`         // "permit" or "forbid"
	PrincipalType string   `json:"principal_type"` // "User", "Group", or "*"
	PrincipalID   string   `json:"principal_id"`   // specific ID or ""
	PrincipalIn   string   `json:"principal_in"`   // group membership constraint (e.g., "Group::\"admins\"")
	Actions       []string `json:"actions"`        // specific actions or ["*"]
	ResourceType  string   `json:"resource_type"`  // specific type or "*"
	ResourceIDs   []string `json:"resource_ids"`   // specific IDs or nil
	Conditions    string   `json:"conditions"`     // raw "when { ... }" clause
}

var (
	// Match "permit" or "forbid" at the start
	effectRegex = regexp.MustCompile(`(?i)^\s*(permit|forbid)\s*\(`)

	// Match principal clause patterns (supports namespaces).
	principalEqInRegex = regexp.MustCompile(`principal\s*(==|in)\s*([A-Za-z_][A-Za-z0-9_:]*)::"([^"]+)"`)
	principalIsRegex   = regexp.MustCompile(`principal\s+is\s+([A-Za-z_][A-Za-z0-9_:]*)`)

	// Match action clause patterns (supports namespaced action entity type).
	// Examples:
	//   action == Action::"read"
	//   action == AgentGuardrails::Action::"email.send"
	//   action in [Action::"read", AgentGuardrails::Action::"write"]
	actionSingleRegex = regexp.MustCompile(`action\s*==\s*[A-Za-z_][A-Za-z0-9_:]*::"([^"]+)"`)
	actionInRegex     = regexp.MustCompile(`action\s+in\s*\[([^\]]+)\]`)
	actionItemRegex   = regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_:]*::"([^"]+)"`)

	// Match resource clause patterns (supports namespaces).
	resourceEqInRegex = regexp.MustCompile(`resource\s*(==|in)\s*([A-Za-z_][A-Za-z0-9_:]*)::"([^"]+)"`)
	resourceIsRegex   = regexp.MustCompile(`resource\s+is\s+([A-Za-z_][A-Za-z0-9_:]*)`)

	// Match when clause
	whenRegex = regexp.MustCompile(`(?s)when\s*\{([^}]*)\}`)
)

// ParsePolicy parses a Cedar policy text and extracts structured data.
func ParsePolicy(policyID, policyText string) ParsedPolicy {
	result := ParsedPolicy{
		PolicyID:      policyID,
		Effect:        "permit",
		PrincipalType: "*",
		PrincipalID:   "",
		PrincipalIn:   "",
		Actions:       []string{"*"},
		ResourceType:  "*",
		ResourceIDs:   nil,
		Conditions:    "",
	}

	// Normalize whitespace
	text := strings.TrimSpace(policyText)

	// Extract effect (permit/forbid)
	if matches := effectRegex.FindStringSubmatch(text); len(matches) > 1 {
		result.Effect = strings.ToLower(matches[1])
	}

	// Extract principal constraints
	if matches := principalEqInRegex.FindStringSubmatch(text); len(matches) > 3 {
		op := matches[1]
		entityType := matches[2]
		entityID := matches[3]
		if op == "==" {
			result.PrincipalType = entityType
			result.PrincipalID = entityID
		} else if op == "in" {
			result.PrincipalIn = entityType + "::\"" + entityID + "\""
		}
	} else if matches := principalIsRegex.FindStringSubmatch(text); len(matches) > 1 {
		result.PrincipalType = matches[1]
	}

	// Extract action constraints
	if matches := actionSingleRegex.FindStringSubmatch(text); len(matches) > 1 {
		// action == Action::"read"
		result.Actions = []string{matches[1]}
	} else if matches := actionInRegex.FindStringSubmatch(text); len(matches) > 1 {
		// action in [Action::"read", Action::"write"]
		actionList := matches[1]
		actionMatches := actionItemRegex.FindAllStringSubmatch(actionList, -1)
		actions := make([]string, 0, len(actionMatches))
		for _, m := range actionMatches {
			if len(m) > 1 {
				actions = append(actions, m[1])
			}
		}
		if len(actions) > 0 {
			result.Actions = actions
		}
	}

	// Extract resource constraints
	if matches := resourceEqInRegex.FindStringSubmatch(text); len(matches) > 3 {
		entityType := matches[2]
		entityID := matches[3]
		result.ResourceType = entityType
		result.ResourceIDs = []string{entityID}
	} else if matches := resourceIsRegex.FindStringSubmatch(text); len(matches) > 1 {
		result.ResourceType = matches[1]
	}

	// Extract when clause
	if matches := whenRegex.FindStringSubmatch(text); len(matches) > 1 {
		result.Conditions = strings.TrimSpace(matches[1])
	}

	return result
}

// ParsePolicies parses multiple Cedar policies.
func ParsePolicies(policies []PolicyText) []ParsedPolicy {
	result := make([]ParsedPolicy, 0, len(policies))
	for _, p := range policies {
		result = append(result, ParsePolicy(p.ID, p.Text))
	}
	return result
}

// MatchesPrincipal checks if a parsed policy applies to a given principal.
// It considers direct matches, group memberships, and wildcard principals.
func (p *ParsedPolicy) MatchesPrincipal(principalType, principalID string, groupMemberships []GroupRef) bool {
	// Wildcard principal matches everything
	if p.PrincipalType == "*" && p.PrincipalID == "" && p.PrincipalIn == "" {
		return true
	}

	// Direct principal match
	if p.PrincipalType == principalType && p.PrincipalID == principalID {
		return true
	}

	// Type-only match (e.g., "principal is User" matches any User)
	if p.PrincipalType == principalType && p.PrincipalID == "" && p.PrincipalIn == "" {
		return true
	}

	// Group membership match (e.g., "principal in Group::\"admins\"")
	if p.PrincipalIn != "" {
		for _, group := range groupMemberships {
			expectedIn := group.Type + "::\"" + group.ID + "\""
			if p.PrincipalIn == expectedIn {
				return true
			}
		}
	}

	return false
}
