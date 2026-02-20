# Agent Guardrails with Cedar

This guide provides a concrete schema, policy pack, and runtime contract for enforcing least-privilege tool use by AI agents.

## Security Posture

- Deny-by-default (implicit Cedar deny).
- Explicit allows for each tool domain.
- Supports both:
  - Service-agent flow (`principal = AgentGuardrails::Agent::<id>`)
  - Delegated-user flow (`principal = AgentGuardrails::User::<id>`, with `context.agent_id` and `context.delegated_user=true`)
- Constrained break-glass path with required justification and short TTL.

## Files

- Schema: `examples/agent-guardrails/schema/agent-tools.schema.json`
- Policies: `examples/agent-guardrails/policies/*.cedar`
- Example entities: `examples/agent-guardrails/entities/agent-guardrails.entities.json`
- Integration test script: `tests/python/test_agent_guardrails.py`

## Runtime Mapping Contract

Map each runtime tool invocation to Cedar request fields:

- `principal`: the acting identity (`Agent` for service-agent mode, `User` for delegated mode)
- `action`: one of:
  - `email.send`
  - `calendar.create`
  - `slack.post`
  - `http.request.get`, `http.request.post`
  - `jira.read`, `jira.write`
  - `wiki.read`, `wiki.write`
  - `sharepoint.read`, `sharepoint.write`
- `resource`: typed target entity (`EmailRecipient`, `HttpEndpoint`, etc.)
- `context`:
  - Required for delegated mode: `agent_id`, `delegated_user`
  - Operational metadata: `tenant`, `environment`, `request_id`
  - Break-glass: `break_glass`, `ticket_id`, `reason`, `approved_by`, `request_epoch`, `expires_at`

## Example Authorize Payloads

### Allow: service-agent email to allowlisted recipient

```json
{
  "application_id": 1,
  "principal": { "type": "AgentGuardrails::Agent", "id": "agent-mailer" },
  "action": { "type": "AgentGuardrails::Action", "id": "email.send" },
  "resource": { "type": "AgentGuardrails::EmailRecipient", "id": "foo_at_bar" },
  "context": {
    "agent_id": "agent-mailer",
    "environment": "prod",
    "tenant": "corp",
    "request_id": "req-001"
  }
}
```

### Deny: same agent to non-allowlisted recipient

```json
{
  "application_id": 1,
  "principal": { "type": "AgentGuardrails::Agent", "id": "agent-mailer" },
  "action": { "type": "AgentGuardrails::Action", "id": "email.send" },
  "resource": { "type": "AgentGuardrails::EmailRecipient", "id": "bar_at_foo" },
  "context": {
    "agent_id": "agent-mailer",
    "environment": "prod",
    "tenant": "corp",
    "request_id": "req-002"
  }
}
```

### Allow: delegated user via approved HTTP agent

```json
{
  "application_id": 1,
  "principal": { "type": "AgentGuardrails::User", "id": "alice" },
  "action": { "type": "AgentGuardrails::Action", "id": "http.request.get" },
  "resource": { "type": "AgentGuardrails::HttpEndpoint", "id": "jira-api-get" },
  "context": {
    "agent_id": "agent-http",
    "delegated_user": true,
    "environment": "prod",
    "tenant": "corp",
    "request_id": "req-003"
  }
}
```

### Deny: delegated user missing approved agent context

```json
{
  "application_id": 1,
  "principal": { "type": "AgentGuardrails::User", "id": "alice" },
  "action": { "type": "AgentGuardrails::Action", "id": "http.request.get" },
  "resource": { "type": "AgentGuardrails::HttpEndpoint", "id": "jira-api-get" },
  "context": {
    "delegated_user": true,
    "environment": "prod",
    "tenant": "corp",
    "request_id": "req-004"
  }
}
```

### Allow: break-glass override by emergency operator

```json
{
  "application_id": 1,
  "principal": { "type": "AgentGuardrails::User", "id": "oncall-admin" },
  "action": { "type": "AgentGuardrails::Action", "id": "sharepoint.write" },
  "resource": { "type": "AgentGuardrails::SharePointPath", "id": "finance-site/reports" },
  "context": {
    "break_glass": true,
    "ticket_id": "INC-9001",
    "reason": "active incident response",
    "approved_by": "sec-lead",
    "request_epoch": 1739980000,
    "expires_at": 1739980600,
    "request_id": "req-005"
  }
}
```

## Enforcement Integration

Use existing entry points:

- `POST /v1/authorize`: enforce guardrails before tool execution.
- `POST /v1/entitlements`: inspect effective delegated-user capabilities for preflight UX and audit tooling.
- `GET /v1/apps/{id}/schemas/active/metadata`: drive namespace-aware policy UI selectors for `AgentGuardrails::*` types/actions.
- `POST /v1/apps/{id}/policies`: returns additive `validation.warnings` when policy text references unknown action/types/context for the active schema.

## Staged Rollout and Audit Validation

1. Stage 1 (read-only tools): enforce for `jira.read`, `wiki.read`, `sharepoint.read`, `http.request.get`; watch deny reasons and false positives.
2. Stage 2 (write tools): enforce `email.send`, `calendar.create`, `slack.post`, writes (`jira.write`, `wiki.write`, `sharepoint.write`, `http.request.post`).
3. Stage 3 (break-glass): enable `90_breakglass.cedar` with incident workflow and daily review of emergency use.

Audit-focused checks:

- Every deny includes action/resource/principal and request_id in logs.
- Every break-glass allow includes `ticket_id`, `approved_by`, and TTL evidence.
- Track off-allowlist attempts by domain to refine resource modeling.
