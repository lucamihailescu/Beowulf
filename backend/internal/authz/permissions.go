package authz

import (
	"context"
	"fmt"
)

// PermissionEntry represents a single permission derived from a policy.
type PermissionEntry struct {
	PolicyID      string   `json:"policy_id,omitempty"`
	Effect        string   `json:"effect"`
	Actions       []string `json:"actions"`
	ResourceTypes []string `json:"resource_types"`
	ResourceIDs   []string `json:"resource_ids,omitempty"`
	Conditions    string   `json:"conditions,omitempty"`
}

// PermissionsResponse is the response for the permissions endpoint.
type PermissionsResponse struct {
	Principal        Reference         `json:"principal"`
	Permissions      []PermissionEntry `json:"permissions"`
	EffectiveActions []string          `json:"effective_actions"`
	GroupMemberships []string          `json:"group_memberships"`
}

// GroupMembershipProvider provides group membership information for entities.
type GroupMembershipProvider interface {
	GetGroupMemberships(ctx context.Context, applicationID int64, entityType, entityID string) ([]GroupRef, error)
}

// GroupRef represents a group reference.
type GroupRef struct {
	Type string
	ID   string
}

// PermissionsService handles permission listing operations.
type PermissionsService struct {
	policies PolicyProvider
	groups   GroupMembershipProvider
}

// NewPermissionsService creates a new permissions service.
func NewPermissionsService(policies PolicyProvider, groups GroupMembershipProvider) *PermissionsService {
	return &PermissionsService{
		policies: policies,
		groups:   groups,
	}
}

// ListPermissions returns all permissions applicable to a given principal.
func (s *PermissionsService) ListPermissions(ctx context.Context, applicationID int64, principalType, principalID string) (*PermissionsResponse, error) {
	// Get active policies
	policies, err := s.policies.ActivePolicies(ctx, applicationID)
	if err != nil {
		return nil, fmt.Errorf("load policies: %w", err)
	}

	// Get group memberships for the principal
	groupRefs, err := s.groups.GetGroupMemberships(ctx, applicationID, principalType, principalID)
	if err != nil {
		return nil, fmt.Errorf("load group memberships: %w", err)
	}

	// Convert group refs to string slice for matching
	groupMemberships := make([]string, 0, len(groupRefs))
	for _, g := range groupRefs {
		if g.Type == "Group" {
			groupMemberships = append(groupMemberships, g.ID)
		}
	}

	// Parse all policies
	parsedPolicies := ParsePolicies(policies)

	// Filter policies that apply to this principal
	var permissions []PermissionEntry
	effectiveActionsMap := make(map[string]bool)
	forbiddenActionsMap := make(map[string]bool)

	for _, p := range parsedPolicies {
		if !p.MatchesPrincipal(principalType, principalID, groupMemberships) {
			continue
		}

		// Build resource types list
		resourceTypes := []string{}
		if p.ResourceType != "*" {
			resourceTypes = append(resourceTypes, p.ResourceType)
		}

		entry := PermissionEntry{
			PolicyID:      p.PolicyID,
			Effect:        p.Effect,
			Actions:       p.Actions,
			ResourceTypes: resourceTypes,
			ResourceIDs:   p.ResourceIDs,
			Conditions:    p.Conditions,
		}
		permissions = append(permissions, entry)

		// Track effective actions (permit - forbid)
		for _, action := range p.Actions {
			switch p.Effect {
			case "permit":
				effectiveActionsMap[action] = true
			case "forbid":
				forbiddenActionsMap[action] = true
			}
		}
	}

	// Calculate effective actions (permitted but not forbidden)
	effectiveActions := make([]string, 0)
	for action := range effectiveActionsMap {
		if !forbiddenActionsMap[action] {
			effectiveActions = append(effectiveActions, action)
		}
	}

	return &PermissionsResponse{
		Principal: Reference{
			Type: principalType,
			ID:   principalID,
		},
		Permissions:      permissions,
		EffectiveActions: effectiveActions,
		GroupMemberships: groupMemberships,
	}, nil
}

