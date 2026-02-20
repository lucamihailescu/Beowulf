package httpserver

import "testing"

func TestExtractSchemaMetadataMultiNamespace(t *testing.T) {
	schemaText := `{
  "AgentGuardrails": {
    "entityTypes": {
      "User": {},
      "EmailRecipient": {}
    },
    "actions": {
      "email.send": {
        "appliesTo": {
          "principalTypes": ["User"],
          "resourceTypes": ["EmailRecipient"],
          "context": {
            "type": "Record",
            "attributes": {
              "agent_id": { "type": "String", "required": false }
            }
          }
        }
      }
    }
  },
  "": {
    "entityTypes": {
      "Group": {}
    },
    "actions": {
      "view": {}
    }
  }
}`

	meta, err := extractSchemaMetadata(schemaText)
	if err != nil {
		t.Fatalf("unexpected metadata extraction error: %v", err)
	}
	if len(meta.Namespaces) != 2 {
		t.Fatalf("expected 2 namespaces, got %d", len(meta.Namespaces))
	}
	if len(meta.Actions) < 2 {
		t.Fatalf("expected at least 2 actions, got %d", len(meta.Actions))
	}
	if !contains(meta.EntityTypes, "AgentGuardrails::User") {
		t.Fatalf("expected namespaced entity type in metadata, got %+v", meta.EntityTypes)
	}
	if !contains(meta.ActionIDs, "email.send") {
		t.Fatalf("expected action id email.send in metadata, got %+v", meta.ActionIDs)
	}
	if !contains(meta.ContextAttributes, "agent_id") {
		t.Fatalf("expected context attribute agent_id in metadata, got %+v", meta.ContextAttributes)
	}
}

func TestValidatePolicyAgainstSchemaWarnings(t *testing.T) {
	schemaText := `{
  "AgentGuardrails": {
    "entityTypes": {
      "User": {},
      "EmailRecipient": {}
    },
    "actions": {
      "email.send": {
        "appliesTo": {
          "principalTypes": ["User"],
          "resourceTypes": ["EmailRecipient"]
        }
      }
    }
  }
}`
	meta, err := extractSchemaMetadata(schemaText)
	if err != nil {
		t.Fatalf("unexpected metadata extraction error: %v", err)
	}

	invalidPolicy := `permit (
  principal == AgentGuardrails::User::"alice",
  action == AgentGuardrails::Action::"unknown.action",
  resource == AgentGuardrails::HttpEndpoint::"jira-api"
);`

	validation := validatePolicyAgainstSchema(invalidPolicy, meta)
	if !validation.Valid {
		t.Fatalf("validation should stay valid with warnings-only mode: %+v", validation)
	}
	if len(validation.Warnings) == 0 {
		t.Fatalf("expected warnings for unknown action/resource type")
	}
}

func contains(values []string, needle string) bool {
	for _, v := range values {
		if v == needle {
			return true
		}
	}
	return false
}
