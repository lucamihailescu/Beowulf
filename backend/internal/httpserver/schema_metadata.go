package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"cedar/internal/authz"
)

type schemaNamespaceMetadata struct {
	Name        string   `json:"name"`
	EntityTypes []string `json:"entity_types"`
	Actions     []string `json:"actions"`
}

type schemaActionMetadata struct {
	Namespace         string   `json:"namespace"`
	Name              string   `json:"name"`
	ActionType        string   `json:"action_type"`
	PrincipalTypes    []string `json:"principal_types,omitempty"`
	ResourceTypes     []string `json:"resource_types,omitempty"`
	ContextAttributes []string `json:"context_attributes,omitempty"`
}

type schemaMetadataResponse struct {
	Namespaces        []schemaNamespaceMetadata `json:"namespaces"`
	EntityTypes       []string                  `json:"entity_types"`
	Actions           []schemaActionMetadata    `json:"actions"`
	ActionIDs         []string                  `json:"action_ids"`
	ContextAttributes []string                  `json:"context_attributes"`
}

type policyValidationResult struct {
	Valid    bool     `json:"valid"`
	Warnings []string `json:"warnings,omitempty"`
	Errors   []string `json:"errors,omitempty"`
}

var contextAttributeRegex = regexp.MustCompile(`\bcontext\.([A-Za-z_][A-Za-z0-9_]*)`)

func (a *API) handleGetActiveSchemaMetadata(w http.ResponseWriter, r *http.Request) {
	appID, err := parseIDParam(r, "id")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid app id"})
		return
	}
	schema, err := a.schemas.GetActiveSchema(r.Context(), appID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	if schema == nil {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "no active schema"})
		return
	}

	metadata, err := extractSchemaMetadata(schema.SchemaText)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid active schema: " + err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(metadata)
}

type namespaceSchemaEntry struct {
	name string
	data map[string]any
}

func extractSchemaMetadata(schemaText string) (*schemaMetadataResponse, error) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(schemaText), &raw); err != nil {
		return nil, fmt.Errorf("parse schema json: %w", err)
	}

	entries := collectSchemaEntries(raw)
	if len(entries) == 0 {
		return nil, fmt.Errorf("no namespace schema entries found")
	}

	resp := &schemaMetadataResponse{
		Namespaces:        make([]schemaNamespaceMetadata, 0, len(entries)),
		Actions:           make([]schemaActionMetadata, 0),
		EntityTypes:       []string{},
		ActionIDs:         []string{},
		ContextAttributes: []string{},
	}

	entityTypesSet := make(map[string]struct{})
	actionIDsSet := make(map[string]struct{})
	contextAttrSet := make(map[string]struct{})

	for _, entry := range entries {
		namespaceMeta := schemaNamespaceMetadata{
			Name:        entry.name,
			EntityTypes: []string{},
			Actions:     []string{},
		}

		entityTypes := mapKeys(asMap(entry.data["entityTypes"]))
		for _, t := range entityTypes {
			qualified := qualifyTypeName(entry.name, t)
			namespaceMeta.EntityTypes = append(namespaceMeta.EntityTypes, qualified)
			entityTypesSet[qualified] = struct{}{}
		}

		actionMap := asMap(entry.data["actions"])
		actionNames := mapKeys(actionMap)
		for _, actionName := range actionNames {
			actionDef := asMap(actionMap[actionName])
			appliesTo := asMap(actionDef["appliesTo"])

			principalTypes := qualifyTypeList(entry.name, toStringSlice(appliesTo["principalTypes"]))
			resourceTypes := qualifyTypeList(entry.name, toStringSlice(appliesTo["resourceTypes"]))
			contextAttrs := extractContextAttributes(appliesTo)

			actionMeta := schemaActionMetadata{
				Namespace:         entry.name,
				Name:              actionName,
				ActionType:        qualifyTypeName(entry.name, "Action"),
				PrincipalTypes:    principalTypes,
				ResourceTypes:     resourceTypes,
				ContextAttributes: contextAttrs,
			}
			resp.Actions = append(resp.Actions, actionMeta)

			namespaceMeta.Actions = append(namespaceMeta.Actions, actionName)
			actionIDsSet[actionName] = struct{}{}
			for _, attr := range contextAttrs {
				contextAttrSet[attr] = struct{}{}
			}
		}

		sort.Strings(namespaceMeta.EntityTypes)
		sort.Strings(namespaceMeta.Actions)
		resp.Namespaces = append(resp.Namespaces, namespaceMeta)
	}

	resp.EntityTypes = sortedSetKeys(entityTypesSet)
	resp.ActionIDs = sortedSetKeys(actionIDsSet)
	resp.ContextAttributes = sortedSetKeys(contextAttrSet)
	sort.Slice(resp.Actions, func(i, j int) bool {
		if resp.Actions[i].Namespace == resp.Actions[j].Namespace {
			return resp.Actions[i].Name < resp.Actions[j].Name
		}
		return resp.Actions[i].Namespace < resp.Actions[j].Namespace
	})

	return resp, nil
}

func validatePolicyAgainstSchema(policyText string, metadata *schemaMetadataResponse) policyValidationResult {
	result := policyValidationResult{Valid: true}
	if metadata == nil {
		return result
	}

	entityTypeSet := make(map[string]struct{}, len(metadata.EntityTypes))
	for _, t := range metadata.EntityTypes {
		entityTypeSet[t] = struct{}{}
	}
	actionIDSet := make(map[string]struct{}, len(metadata.ActionIDs))
	for _, id := range metadata.ActionIDs {
		actionIDSet[id] = struct{}{}
	}
	contextAttrSet := make(map[string]struct{}, len(metadata.ContextAttributes))
	for _, attr := range metadata.ContextAttributes {
		contextAttrSet[attr] = struct{}{}
	}

	parsed := authz.ParsePolicy("validation", policyText)
	warnings := make([]string, 0, 6)

	if parsed.PrincipalType != "*" && !isKnownEntityType(parsed.PrincipalType, entityTypeSet) {
		warnings = append(warnings, fmt.Sprintf("principal type %q is not defined in the active schema", parsed.PrincipalType))
	}
	if parsed.PrincipalIn != "" {
		principalInType := parseEntityTypeFromUIDLiteral(parsed.PrincipalIn)
		if principalInType != "" && !isKnownEntityType(principalInType, entityTypeSet) {
			warnings = append(warnings, fmt.Sprintf("principal group type %q is not defined in the active schema", principalInType))
		}
	}
	if parsed.ResourceType != "*" && !isKnownEntityType(parsed.ResourceType, entityTypeSet) {
		warnings = append(warnings, fmt.Sprintf("resource type %q is not defined in the active schema", parsed.ResourceType))
	}
	for _, action := range parsed.Actions {
		if action == "*" {
			continue
		}
		if _, ok := actionIDSet[action]; !ok {
			warnings = append(warnings, fmt.Sprintf("action %q is not defined in the active schema", action))
		}
	}

	for _, m := range contextAttributeRegex.FindAllStringSubmatch(policyText, -1) {
		if len(m) < 2 {
			continue
		}
		attr := m[1]
		if len(contextAttrSet) == 0 {
			continue
		}
		if _, ok := contextAttrSet[attr]; !ok {
			warnings = append(warnings, fmt.Sprintf("context attribute %q is not declared in active schema action context", attr))
		}
	}

	warnings = dedupeAndSort(warnings)
	result.Warnings = warnings
	result.Valid = len(result.Errors) == 0
	return result
}

func collectSchemaEntries(root map[string]any) []namespaceSchemaEntry {
	entries := make([]namespaceSchemaEntry, 0)
	if hasSchemaShape(root) {
		entries = append(entries, namespaceSchemaEntry{name: "", data: root})
		return entries
	}

	keys := mapKeys(root)
	for _, k := range keys {
		nsMap := asMap(root[k])
		if !hasSchemaShape(nsMap) {
			continue
		}
		entries = append(entries, namespaceSchemaEntry{name: k, data: nsMap})
	}
	return entries
}

func hasSchemaShape(m map[string]any) bool {
	if len(m) == 0 {
		return false
	}
	_, hasEntityTypes := m["entityTypes"]
	_, hasActions := m["actions"]
	return hasEntityTypes || hasActions
}

func qualifyTypeName(namespace, typeName string) string {
	if namespace == "" || strings.Contains(typeName, "::") {
		return typeName
	}
	return namespace + "::" + typeName
}

func qualifyTypeList(namespace string, values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, v := range values {
		out = append(out, qualifyTypeName(namespace, v))
	}
	return dedupeAndSort(out)
}

func extractContextAttributes(appliesTo map[string]any) []string {
	ctxShape := asMap(appliesTo["context"])
	attributes := asMap(ctxShape["attributes"])
	return mapKeys(attributes)
}

func parseEntityTypeFromUIDLiteral(uidLiteral string) string {
	idx := strings.Index(uidLiteral, "::\"")
	if idx <= 0 {
		return ""
	}
	return uidLiteral[:idx]
}

func isKnownEntityType(entityType string, known map[string]struct{}) bool {
	if entityType == "" {
		return true
	}
	if _, ok := known[entityType]; ok {
		return true
	}
	if strings.Contains(entityType, "::") {
		short := entityType[strings.LastIndex(entityType, "::")+2:]
		_, ok := known[short]
		return ok
	}
	for t := range known {
		if strings.HasSuffix(t, "::"+entityType) {
			return true
		}
	}
	return false
}

func asMap(v any) map[string]any {
	if v == nil {
		return map[string]any{}
	}
	m, ok := v.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return m
}

func toStringSlice(v any) []string {
	if v == nil {
		return nil
	}
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		s, ok := item.(string)
		if !ok {
			continue
		}
		out = append(out, s)
	}
	return out
}

func mapKeys[T any](m map[string]T) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedSetKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func dedupeAndSort(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			continue
		}
		set[item] = struct{}{}
	}
	if len(set) == 0 {
		return nil
	}
	return sortedSetKeys(set)
}
