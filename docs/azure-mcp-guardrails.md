# Azure.Mcp.Server Guardrails (First 3 Actions)

This guide defines a concrete mapping table and copy/paste Cedar policy snippets for testing authorization guardrails with `Azure.Mcp.Server`:

- `azure.storage.account.listKeys`
- `azure.resources.resourceGroup.delete`
- `azure.authorization.roleAssignments.write`

## Runtime Mapping Contract

Use the same runtime contract already used by the MCP gateway:

- `principal`: caller identity, using UPN/email (`User::<upn-email>`)
- `action`: `MCP::Action::<action-id>`
- `resource`: `MCP::Tool::<tool_server:tool_name>`
- `context`: operational and approval metadata (for example `subscription_id`, `resource_group`, `ticket_id`, `approval_status`)

Gateway reference behavior:

- Default action fallback to `tool.invoke` when empty
- Resource id assembled as `tool_server + ":" + tool_name`
- Authorization call uses `MCP::Action` and `MCP::Tool`

## First 3 Guarded Actions Mapping

| Guarded action id | tool_server | tool_name | Cedar resource id (`MCP::Tool`) | Risk tier | Default posture |
| --- | --- | --- | --- | --- | --- |
| `azure.storage.account.listKeys` | `azure.storage` | `account.listKeys` | `azure.storage:account.listKeys` | High | deny unless explicit allow |
| `azure.resources.resourceGroup.delete` | `azure.resources` | `resourceGroup.delete` | `azure.resources:resourceGroup.delete` | Critical | deny unless explicit allow + approval context |
| `azure.authorization.roleAssignments.write` | `azure.authorization` | `roleAssignments.write` | `azure.authorization:roleAssignments.write` | Critical | deny unless explicit allow + approval context |

## Example Authorize Payloads

### 1) Storage account list keys

```json
{
  "application_id": 7,
  "principal": { "type": "User", "id": "engineer@contoso.com" },
  "action": { "type": "MCP::Action", "id": "azure.storage.account.listKeys" },
  "resource": { "type": "MCP::Tool", "id": "azure.storage:account.listKeys" },
  "context": {
    "subscription_id": "sub-123",
    "resource_group": "rg-finance",
    "request_id": "az-mcp-listkeys-001"
  }
}
```

### 2) Resource group delete

```json
{
  "application_id": 7,
  "principal": { "type": "User", "id": "ops-oncall@contoso.com" },
  "action": { "type": "MCP::Action", "id": "azure.resources.resourceGroup.delete" },
  "resource": { "type": "MCP::Tool", "id": "azure.resources:resourceGroup.delete" },
  "context": {
    "subscription_id": "sub-123",
    "resource_group": "rg-prod",
    "ticket_id": "CHG-9231",
    "approval_status": "approved",
    "request_id": "az-mcp-rgdel-001"
  }
}
```

### 3) Role assignment write

```json
{
  "application_id": 7,
  "principal": { "type": "User", "id": "sec-admin@contoso.com" },
  "action": { "type": "MCP::Action", "id": "azure.authorization.roleAssignments.write" },
  "resource": { "type": "MCP::Tool", "id": "azure.authorization:roleAssignments.write" },
  "context": {
    "subscription_id": "sub-123",
    "scope": "/subscriptions/sub-123/resourceGroups/rg-prod",
    "ticket_id": "CHG-9240",
    "approval_status": "approved",
    "request_id": "az-mcp-rbac-001"
  }
}
```

## Cedar Policy Snippets

These snippets are intentionally strict for first rollout.

### Allow `listKeys` for approved engineering users

```cedar
permit (
  principal == User::"engineer@contoso.com",
  action == MCP::Action::"azure.storage.account.listKeys",
  resource == MCP::Tool::"azure.storage:account.listKeys"
);
```

### Allow resource-group delete only with explicit approval metadata

```cedar
permit (
  principal == User::"ops-oncall@contoso.com",
  action == MCP::Action::"azure.resources.resourceGroup.delete",
  resource == MCP::Tool::"azure.resources:resourceGroup.delete"
) when {
  context.approval_status == "approved" &&
  context.ticket_id != ""
};
```

### Allow role-assignment write only for security admin + approved change

```cedar
permit (
  principal == User::"sec-admin@contoso.com",
  action == MCP::Action::"azure.authorization.roleAssignments.write",
  resource == MCP::Tool::"azure.authorization:roleAssignments.write"
) when {
  context.approval_status == "approved" &&
  context.ticket_id != ""
};
```

### Optional hard-forbid guard for dangerous write/delete actions

```cedar
forbid (
  principal,
  action in [
    MCP::Action::"azure.resources.resourceGroup.delete",
    MCP::Action::"azure.authorization.roleAssignments.write"
  ],
  resource
) unless {
  context.approval_status == "approved" &&
  context.ticket_id != ""
};
```

## Validation and Rollout Notes

1. Start with dry-run checks in a lower environment by invoking the three mapped actions and confirming decision logs for:
   - principal UPN
   - action id
   - resource id (`tool_server:tool_name`)
2. Promote to production with scoped principals first (single UPN per action), then widen only after log review.
3. Watch deny reasons and context fields (`approval_status`, `ticket_id`) in audit logs to catch mismatches.
4. Keep implicit deny as baseline; only add explicit allows you can justify.

### UPN caveat

UPN/email is human-readable and easy to operate, but it can change over time (rename, domain migration). For long-term stability, plan a migration path to immutable Entra object IDs as principal IDs.
