# Cedar Authorization Portal

A full-stack implementation for managing [Cedar](https://github.com/cedar-policy/cedar) authorization policies. This platform provides a backend API and web UI for managing applications, policies, entities, schemas, and authorization decisions with complete audit trail support.

## Features

### Core Authorization
- **Multi-tenant Applications** — Manage multiple applications with isolated policies and entities
- **Cedar Policy Evaluation** — Real-time authorization using [cedar-go](https://github.com/cedar-policy/cedar-go)
- **Policy Versioning** — Create and manage multiple policy versions with activation control
- **Entity Management** — Store and manage Cedar entities with hierarchical parent relationships
- **Authorization API** — RESTful and gRPC endpoints for policy decision requests

### Namespace Management
- **Shared Namespaces** — Group related applications under common namespaces
- **Team Isolation** — Different teams can have separate namespaces with no cross-contamination
- **Cedar Namespace Mapping** — Namespaces map directly to Cedar's namespace format (e.g., `Ecommerce::User`)
- **Flexible Grouping** — Single namespace for tightly-coupled microservices, separate namespaces for independent apps

### Schema Management
- **Cedar Schemas** — Upload and manage Cedar schemas per application
- **Schema Versioning** — Maintain multiple schema versions with activation control
- **JSON Schema Format** — Support for Cedar's JSON schema format
- **Schema Metadata API** — Namespace-aware metadata for entity/action/context discovery
- **Namespace-Aware Policy UX** — Policy editor/simulator/template flows support multi-namespace types and actions

### Audit Trail
- **Decision Logging** — Every authorization decision is logged with full context
- **Administrative Actions** — Track policy, entity, and schema changes
- **Filterable Logs** — Query audit logs by application, action type, or decision
- **Compliance Ready** — Comprehensive audit trails
### Performance & Scalability
- **Redis Caching** — Cache policies and entities for fast authorization decisions
- **L1/L2 Cache** — In-memory L1 cache with Redis L2 for sub-millisecond authorization
- **Cache Invalidation** — Automatic invalidation via Redis Pub/Sub when policies or entities change
- **Connection Pooling** — Optimized PostgreSQL connection pooling with support for **Read Replicas**
- **gRPC API** — High-performance Protobuf API for internal service-to-service communication
- **Rate Limiting** — Per-caller rate limiting to prevent abuse and ensure fair usage

### Security
- **JWT Authentication** — Azure Entra ID (Azure AD) JWT token validation
- **Kerberos Authentication** — SPNEGO/Negotiate authentication for enterprise environments
- **Per-Application Runtime API Keys** — One-time key issuance on app creation, with rotation/revocation
- **Legacy Global API Key** — Optional read-only key for exception-based external access
- **Audit Trail** — Tracks both the authenticated caller and the subject of authorization checks
- **Agent Guardrails Pack** — Concrete Cedar schema + least-privilege policies for agent tool enforcement

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Web Portal    │────▶│   Backend API   │────▶│   PostgreSQL    │
│   (React/Vite)  │     │   (Go/Chi/gRPC) │     │  (Primary/Read) │
│                 │     │                 │     └─────────────────┘
└─────────────────┘     │                 │
                        │                 │     ┌─────────────────┐
                        │                 │────▶│     Redis       │
                        │                 │     │   (Cache)       │
                        └─────────────────┘     └─────────────────┘
```

### Tech Stack
- **Backend**: Go 1.23+, Chi router, pgx (PostgreSQL driver), cedar-go, gRPC/Protobuf
- **Frontend**: React 18, TypeScript, Vite 7, Ant Design (Dependencies pinned for stability)
- **Database**: PostgreSQL 16 (with Read Replica support)
- **Cache**: Redis 7
- **Containerization**: Docker, Docker Compose

## Quick Start

### Prerequisites
- Docker and Docker Compose
- (Optional) Go 1.23+ for local development
- (Optional) Node.js 18+ for local frontend development

### Running with Docker Compose

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd cedar
   ```

2. **Start all services**
   ```bash
   docker compose up -d
   ```

3. **Run database migrations**
   ```bash
   docker compose run --rm migrate
   ```

4. **(Optional) Seed sample data**
   ```bash
   docker compose run --rm seed
   ```

5. **Access the application**
   - Web Portal: http://localhost:5173
   - Backend REST API: http://localhost:8080
   - Backend gRPC API: localhost:50051
   - Health Check: http://localhost:8080/health

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `8080` | Backend API port |
| `DATABASE_URL` | `postgres://cedar:cedar@db:5432/cedar?sslmode=disable` | PostgreSQL connection string |
| `DATABASE_READ_URL` | `` | Optional PostgreSQL read replica connection string |
| `DB_MAX_CONNS` | `25` | Maximum database connections per pool |
| `DB_MIN_CONNS` | `5` | Minimum idle database connections |
| `REDIS_ADDR` | `localhost:6379` | Redis address |
| `REDIS_PASSWORD` | `` | Redis password (optional) |
| `AUTHZ_CACHE_TTL` | `5s` | Cache TTL for policies/entities |
| `CORS_ALLOW_ORIGINS` | `*` | Allowed CORS origins |
| `AUTH_MODE` | `none` | Authentication mode: `jwt`, `kerberos`, or `none` |
| `API_KEY` | `` | Optional API key for read-only external access |
| `AZURE_TENANT_ID` | `` | Azure Entra ID tenant ID (for JWT auth) |
| `AZURE_CLIENT_ID` | `` | Azure app registration client ID (for JWT auth) |
| `AZURE_AUDIENCE` | `` | Expected JWT token audience |
| `KERBEROS_KEYTAB` | `` | Path to Kerberos keytab file |
| `KERBEROS_SERVICE` | `` | Kerberos service principal (e.g., `HTTP/cedar.example.com`) |
| `RATE_LIMIT_REQUESTS` | `100` | Max requests per window per caller (0 = disabled) |
| `RATE_LIMIT_WINDOW` | `1m` | Time window for rate limiting (e.g., `1m`, `30s`) |
| `VITE_API_BASE_URL` | `http://localhost:8080` | Backend API URL for frontend |

MCP gateway service environment variables (Docker Compose):

- `MCP_GATEWAY_PORT` (default `8090`)
- `MCP_GATEWAY_ENABLED` (default `true`)
- `MCP_GATEWAY_BACKEND_URL` (default `http://backend:8080`)
- `MCP_GATEWAY_APP_ID` (default `1`)
- `MCP_GATEWAY_APPROVAL_ACTIONS` (comma-separated action IDs requiring HITL)
- `MCP_SERVER_ALLOWLIST` (comma-separated downstream URL prefixes)

## API Reference

### gRPC API
The backend exposes a gRPC service on port `50051` defined in `backend/api/proto/v1/authz.proto`.

**Service:** `cedar.v1.AuthorizationService`
- `Check`: Perform a single authorization check
- `BatchCheck`: Perform multiple checks in parallel
- `LookupResources`: Find all resources of a specific type that a principal can access (Entitlements)

#### Integration Examples

**Python**  
Requires `grpcio` and `grpcio-tools`.

```python
import grpc
import authz_pb2
import authz_pb2_grpc

def check_permission(principal_id, action_id, resource_id):
    with grpc.insecure_channel('localhost:50051') as channel:
        stub = authz_pb2_grpc.AuthorizationServiceStub(channel)
        
        request = authz_pb2.CheckRequest(
            application_id="1",
            principal=authz_pb2.Entity(type="User", id=principal_id),
            action=authz_pb2.Entity(type="Action", id=action_id),
            resource=authz_pb2.Entity(type="Document", id=resource_id),
            context={}
        )
        
        response = stub.Check(request)
        return response.allowed
```

**Node.js**  
Requires `@grpc/grpc-js` and `@grpc/proto-loader`.

```javascript
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const packageDefinition = protoLoader.loadSync('authz.proto', {});
const authzProto = grpc.loadPackageDefinition(packageDefinition).cedar.v1;

const client = new authzProto.AuthorizationService(
  'localhost:50051',
  grpc.credentials.createInsecure()
);

client.Check({
  application_id: "1",
  principal: { type: "User", id: "alice" },
  action: { type: "Action", id: "view" },
  resource: { type: "Document", id: "doc-123" }
}, (err, response) => {
  if (err) console.error(err);
  else console.log('Allowed:', response.allowed);
});
```

**.NET (C#)**  
Requires `Grpc.Net.Client`.

```csharp
using Grpc.Net.Client;
using Cedar.V1;

var channel = GrpcChannel.ForAddress("http://localhost:50051");
var client = new AuthorizationService.AuthorizationServiceClient(channel);

var reply = await client.CheckAsync(new CheckRequest
{
    ApplicationId = "1",
    Principal = new Entity { Type = "User", Id = "alice" },
    Action = new Entity { Type = "Action", Id = "view" },
    Resource = new Entity { Type = "Document", Id = "doc-123" }
});

Console.WriteLine($"Allowed: {reply.Allowed}");
```

### REST Authorization

#### Evaluate Authorization Request
```http
POST /v1/authorize
Content-Type: application/json

{
  "application_id": 1,
  "principal": { "type": "User", "id": "alice" },
  "action": { "type": "Action", "id": "view" },
  "resource": { "type": "Document", "id": "doc-123" },
  "context": {}
}
```

**Response:**
```json
{
  "decision": "allow",
  "reasons": ["policy-1"],
  "errors": []
}
```

### Namespaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/namespaces/` | List all namespaces |
| `POST` | `/v1/namespaces/` | Create a new namespace |

**Create Namespace Example:**
```http
POST /v1/namespaces/
Content-Type: application/json

{
  "name": "Ecommerce",
  "description": "E-commerce platform services"
}
```

### Applications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/apps/` | List all applications |
| `POST` | `/v1/apps/` | Create a new application |
| `GET` | `/v1/apps/{id}/api-keys` | List runtime API key metadata (no plaintext) |
| `POST` | `/v1/apps/{id}/api-keys` | Create/rotate runtime API key (returns plaintext once) |
| `POST` | `/v1/apps/{id}/api-keys/{keyId}/revoke` | Revoke a runtime API key |

**Create Application Example:**
```http
POST /v1/apps/
Content-Type: application/json

{
  "name": "payment-service",
  "namespace_id": 1,
  "description": "Handles payment processing"
}
```

**Create Application Response (with initial runtime key):**
```json
{
  "id": 7,
  "api_key": "cedar_app_7_xxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "api_key_id": 14,
  "api_key_prefix": "cedar_app_7_xxxxxxxx"
}
```

The plaintext `api_key` is returned only once. Persist it in your runtime secret manager.

### Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/apps/{id}/policies` | List policies for an application |
| `GET` | `/v1/apps/{id}/policies/{policyId}` | Get policy details |
| `POST` | `/v1/apps/{id}/policies` | Create/update a policy version |

**Create Policy Example:**
```http
POST /v1/apps/1/policies
Content-Type: application/json

{
  "name": "allow-view",
  "description": "Allow users to view documents",
  "policy_text": "permit(principal == User::\"alice\", action == Action::\"view\", resource);",
  "activate": true
}
```

Policy create/update responses now include additive schema-validation feedback:

```json
{
  "policy_id": 42,
  "version": 3,
  "status": "draft",
  "validation": {
    "valid": true,
    "warnings": ["action \"unknown.action\" is not defined in the active schema"]
  }
}
```

### Entities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/apps/{id}/entities` | List entities for an application |
| `POST` | `/v1/apps/{id}/entities` | Create/update an entity |

**Upsert Entity Example:**
```http
POST /v1/apps/1/entities
Content-Type: application/json

{
  "type": "Document",
  "id": "doc-123",
  "attributes": { "owner": "alice", "confidential": false },
  "parents": [{ "type": "Folder", "id": "folder-1" }]
}
```

### Schemas

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/apps/{id}/schemas/` | List schema versions |
| `GET` | `/v1/apps/{id}/schemas/active` | Get active schema |
| `GET` | `/v1/apps/{id}/schemas/active/metadata` | Get normalized active schema metadata (namespaces, types, actions, context attrs) |
| `POST` | `/v1/apps/{id}/schemas/` | Create a new schema version |
| `POST` | `/v1/apps/{id}/schemas/activate` | Activate a schema version |

**Create Schema Example:**
```http
POST /v1/apps/1/schemas/
Content-Type: application/json

{
  "schema_text": "{\"\":{\"entityTypes\":{\"User\":{},\"Document\":{}},\"actions\":{\"view\":{\"appliesTo\":{\"principalTypes\":[\"User\"],\"resourceTypes\":[\"Document\"]}}}}}",
  "activate": true
}
```

### Audit Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/audit/` | List audit logs (with optional filters) |

**Query Parameters:**
- `application_id` — Filter by application ID
- `action` — Filter by action type (e.g., `authorize`, `policy.create`)
- `decision` — Filter by decision (`allow`, `deny`)
- `limit` — Results per page (default: 50, max: 200)
- `offset` — Pagination offset

## Local Development

### Backend

```bash
cd backend

# Install dependencies
go mod download

# Set up environment
cp .env.example .env  # Create and configure .env file

# Run migrations
go run ./cmd/migrate

# Start the server (REST on 8080, gRPC on 50051)
go run ./cmd/server
```

### Frontend

```bash
cd web

# Install dependencies
npm install

# Start development server
npm run dev
```

## Database Schema

The platform uses PostgreSQL with the following main tables:

- **applications** — Registered applications with namespaces
- **policies** — Policy metadata per application
- **policy_versions** — Versioned policy text with activation status
- **entities** — Cedar entities with JSON attributes
- **entity_parents** — Entity hierarchy relationships
- **schemas** — Versioned Cedar schemas per application
- **audit_logs** — Comprehensive audit trail

## Cedar Policy Examples

### Basic Allow Policy
```cedar
permit (
  principal == User::"alice",
  action == Action::"view",
  resource == Document::"doc-123"
);
```

### Role-Based Access
```cedar
permit (
  principal in Group::"admins",
  action in [Action::"view", Action::"edit", Action::"delete"],
  resource
);
```

### Attribute-Based Access
```cedar
permit (
  principal,
  action == Action::"view",
  resource
) when {
  resource.confidential == false ||
  principal == resource.owner
};
```

### Deny Policy
```cedar
forbid (
  principal,
  action == Action::"delete",
  resource
) when {
  resource.protected == true
};
```

## Production Considerations

1. **Authentication** — Configure `AUTH_MODE=jwt` or `AUTH_MODE=kerberos` for user/admin access. Use per-application runtime API keys for machine-to-machine decision calls (`/v1/authorize`, `/v1/entitlements`).

2. **HTTPS** — Use a reverse proxy (nginx, Caddy) or load balancer for TLS termination.

3. **Database** — Use managed PostgreSQL (RDS, Cloud SQL) with connection pooling.

4. **Caching** — Use managed Redis (ElastiCache, Memorystore) for high availability.

5. **Rate Limiting** — Configure `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW` to protect against abuse.

6. **Monitoring** — Add OpenTelemetry instrumentation for tracing and metrics.

7. **Backups** — Configure automated database backups and audit log retention.

## MCP Server Integration

This solution can be used as an authorization backend for **Model Context Protocol (MCP)** servers. MCP servers can authenticate using per-application runtime API keys.

### MCP Gateway Service (New)

A standalone `mcp-gateway` service is now included and can be started with Docker Compose. The gateway:

- intercepts MCP tool invocation requests,
- evaluates authorization via `POST /v1/authorize`,
- supports pending-approval workflows for sensitive actions,
- supports delegation/OBO token introspection,
- records structured MCP audit events via backend API.

Default gateway endpoint: `http://localhost:8090`

Core API surface:

- `POST /v1/mcp/gateways/register`
- `GET /v1/mcp/gateways/`
- `POST /v1/mcp/approvals/`
- `GET /v1/mcp/approvals/{requestId}`
- `POST /v1/mcp/delegations/`
- `POST /v1/mcp/delegations/introspect`

### MCP Cedar Model Conventions

Use these canonical entities/actions when writing MCP authorization policies:

- Principal: end-user or delegated user/agent subject
- Action type: `MCP::Action`
- Resource type: `MCP::Tool`
- Common action id: `tool.invoke`
- Common resource id format: `<server>:<tool>`

Example schema fragment:

```json
{
  "MCP": {
    "entityTypes": {
      "Gateway": { "shape": { "type": "Record", "attributes": {} } },
      "Server": { "shape": { "type": "Record", "attributes": {} } },
      "Tool": { "shape": { "type": "Record", "attributes": {} } },
      "Action": { "shape": { "type": "Record", "attributes": {} } }
    },
    "actions": {
      "tool.invoke": {
        "appliesTo": {
          "principalTypes": ["User", "Agent"],
          "resourceTypes": ["MCP::Tool"]
        }
      }
    }
  }
}
```

### MCP Cedar Policy Examples

Standard invoke allow:

```cedar
permit (
  principal == User::"alice",
  action == MCP::Action::"tool.invoke",
  resource == MCP::Tool::"filesystem:read"
);
```

Sensitive action requires approval context:

```cedar
permit (
  principal,
  action == MCP::Action::"tool.delete",
  resource
) when {
  context.approval_status == "approved"
};
```

Delegated/OBO constrained invocation:

```cedar
permit (
  principal == User::"alice",
  action == MCP::Action::"tool.invoke",
  resource == MCP::Tool::"email:send"
) when {
  context.delegation_grant_id != "" &&
  context.delegated_actor == "Agent::assistant-1"
};
```

### Architecture

```
┌──────────────┐                      ┌─────────────────┐
│   End User   │──(User Token)───────▶│   MCP Server    │
└──────────────┘                      │  (Service Acct) │
                                      │                 │
                                      │  Authenticates  │
                                      │  to Cedar with  │
                                      │  APP API KEY    │
                                      └────────┬────────┘
                                               │
                              POST /v1/authorize
                              X-API-Key: <APP_API_KEY>
                              {
                                "application_id": 7,
                                "principal": {"type": "User", "id": "alice"},
                                ...
                              }
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │   Cedar API     │
                                      └─────────────────┘
```

### Audit Trail

Authorization requests are logged with both:
- **Caller**: The authenticated service making the request (e.g., `mcp-service@example.com`)
- **Principal**: The subject of the authorization check (e.g., `User::alice`)

This allows you to track which services are checking permissions for which users.

### Rate Limiting

Rate limiting is applied per authenticated caller to prevent runaway services from overloading Cedar. Configure limits using `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW`.

### Runtime SDK/Middleware Pattern

Use the same runtime configuration pattern common in MCP middleware examples:

```python
mcp.add_middleware(PermitMcpMiddleware(
    permit_pdp_url="http://localhost:8080",
    permit_api_key=os.environ["CEDAR_APP_API_KEY"],
))
```

Where the runtime API key is generated by `POST /v1/apps/` or rotated via `POST /v1/apps/{id}/api-keys`.

### Runtime Authorization Simulator Script

Use `tests/python/simulate_runtime_authorize.py` to simulate runtime authorization calls with the new per-application API key auth (`X-API-Key`).

REST calls are JSON-native (`POST /v1/authorize` returns JSON), and the simulator can now print either human-readable text or machine-readable JSON.

#### Output Modes

- `--output text` (default): human-readable terminal logs.
- `--output json`: structured JSON suitable for automation/CI pipelines.

#### Single Decision Example

```bash
export CEDAR_BASE_URL="http://localhost:8080"
export CEDAR_APP_API_KEY="cedar_app_..."   # Runtime app key
export CEDAR_APP_ID="1"

python3 tests/python/simulate_runtime_authorize.py \
  --principal-type User \
  --principal-id alice \
  --action-type Action \
  --action-id email.send \
  --resource-type EmailAddress \
  --resource-id foo@bar.com \
  --context '{"agent_id":"assistant-1","delegation_mode":"service"}'
```

Optional expectation assertion:

```bash
python3 tests/python/simulate_runtime_authorize.py --expect allow
```

Single decision with JSON output:

```bash
python3 tests/python/simulate_runtime_authorize.py \
  --output json \
  --expect allow
```

Example JSON output:

```json
{
  "decision": "allow",
  "errors": [],
  "expected": "allow",
  "mode": "single",
  "ok": true,
  "reasons": ["policy-1"],
  "response": {
    "decision": "allow",
    "errors": [],
    "reasons": ["policy-1"]
  },
  "status_code": 200
}
```

#### Batch Decisions Example

```bash
python3 tests/python/simulate_runtime_authorize.py --cases-file /path/to/cases.json
```

Batch decisions with JSON output:

```bash
python3 tests/python/simulate_runtime_authorize.py \
  --output json \
  --cases-file /path/to/cases.json
```

`cases.json` format:

```json
[
  {
    "name": "allow-email-to-foo",
    "payload": {
      "application_id": 1,
      "principal": { "type": "User", "id": "alice" },
      "action": { "type": "Action", "id": "email.send" },
      "resource": { "type": "EmailAddress", "id": "foo@bar.com" },
      "context": { "agent_id": "assistant-1", "delegation_mode": "service" }
    },
    "expected": "allow"
  }
]
```

Example batch JSON output:

```json
{
  "failures": [],
  "mode": "batch",
  "ok": true,
  "results": [
    {
      "decision": "allow",
      "expected": "allow",
      "index": 1,
      "name": "allow-email-to-foo",
      "ok": true,
      "response": {
        "decision": "allow",
        "errors": [],
        "reasons": ["policy-1"]
      },
      "status_code": 200
    }
  ],
  "summary": {
    "failed": 0,
    "passed": 1,
    "total": 1
  }
}
```

## Agent Guardrails (New)

This repository now includes a concrete Cedar guardrails example for AI agent tool enforcement under `examples/agent-guardrails/`.

### Included Artifacts

- `examples/agent-guardrails/schema/agent-tools.schema.json`
- `examples/agent-guardrails/policies/10_email_send_allowlist.cedar`
- `examples/agent-guardrails/policies/20_calendar_create_allowlist.cedar`
- `examples/agent-guardrails/policies/30_slack_post_allowlist.cedar`
- `examples/agent-guardrails/policies/40_http_request_allowlist.cedar`
- `examples/agent-guardrails/policies/50_jira_tool_allowlist.cedar`
- `examples/agent-guardrails/policies/60_wiki_tool_allowlist.cedar`
- `examples/agent-guardrails/policies/70_sharepoint_tool_allowlist.cedar`
- `examples/agent-guardrails/policies/80_delegated_user_constraints.cedar`
- `examples/agent-guardrails/policies/90_breakglass.cedar`
- `examples/agent-guardrails/entities/agent-guardrails.entities.json`
- `docs/agent-guardrails.md`
- `tests/python/test_agent_guardrails.py`

### Scope and Enforcement Model

The guardrails pack is deny-by-default and supports two identity flows:

1. **Service-agent flow**: `principal = AgentGuardrails::Agent::<id>`
2. **Delegated-user flow**: `principal = AgentGuardrails::User::<id>` with required context (`agent_id`, `delegated_user=true`)

It includes narrow allowlists for:

- `email.send`
- `calendar.create`
- `slack.post`
- `http.request.get`, `http.request.post`
- `jira.read`, `jira.write`
- `wiki.read`, `wiki.write`
- `sharepoint.read`, `sharepoint.write`

It also includes a constrained break-glass path with required fields (`ticket_id`, `reason`, `approved_by`, `request_epoch`, `expires_at`) and a short max TTL window.

### Runtime Mapping (Agent Call -> Cedar Request)

Map each tool call to:

- `principal` (Agent or User)
- `action` (typed action entity)
- `resource` (typed target entity)
- `context` (agent/delegation metadata, request id, optional break-glass data)

For concrete payloads and deny/allow examples, see `docs/agent-guardrails.md`.

### Running the Integration Test

The integration test script installs the schema, policies, and entities into an existing app, then executes allow/deny checks across tool domains, delegated flow, and break-glass behavior.

```bash
python3 tests/python/test_agent_guardrails.py
```

Requirements:

- Backend API available at `http://localhost:8080` (or set `CEDAR_BASE_URL`)
- At least one application exists (seeded or manually created)
- For authenticated deployments, provide auth headers via env:
  - `CEDAR_BEARER_TOKEN=<access-token>` (recommended)
  - `CEDAR_API_KEY=<api-key>` (read-only key, insufficient for bootstrap writes)

## Atomic Agents + FastMCP Demo Tests

This repository includes a Python integration suite to demonstrate agent-style authorization decisions using:

- Atomic Agents as the agent orchestration layer.
- FastMCP as the MCP server/tool runtime.
- The existing Cedar Python SDK (`clients/python/mcp`) as the decision client for `/v1/authorize`.

### Test Artifacts

- `tests/python/demo_fastmcp_server.py`
- `tests/python/demo_atomic_agent_client.py`
- `tests/python/test_atomic_agents_fastmcp_demo.py`

### Authorization Model Used in the Demo

The demo uses two authorization layers:

1. **FastMCP async auth checks** gate MCP tool access before tool execution.
2. **Tool-level Cedar decisioning** returns explicit `approve`/`deny` based on SDK-backed authorization checks.

This allows tests to validate both:

- **auth-layer deny** (blocked by FastMCP auth check), and
- **decision-layer deny** (tool runs but Cedar decision is deny).

### Transport Note for FastMCP Auth Checks

FastMCP token-based authorization checks are transport-dependent. For auth-check coverage, run the MCP demo server over HTTP transport. In STDIO mode, token-based checks are typically skipped.

### Running the Suite

```bash
# Run only the Atomic Agents + FastMCP demo integration script
python3 tests/python/test_atomic_agents_fastmcp_demo.py

# Or run all Python integration scripts (including this suite)
cd tests/python
./run.sh
```

### Expected Environment Inputs

- `CEDAR_BASE_URL` (default: `http://localhost:8080`)
- app binding (`CEDAR_APP_ID` or test-configured app id)
- Cedar runtime auth header strategy (for example per-app runtime `X-API-Key`)
- `FASTMCP_DEMO_URL` (default: `http://127.0.0.1:8765/mcp`)
- `FASTMCP_DEMO_AUTO_START` (default: `true`) to auto-launch the demo FastMCP server from the test script
- optional LLM provider credentials (`OPENAI_API_KEY`) for live-agent execution; when not present, live-LLM cases are skipped and deterministic MCP/SDK checks still run.

## License

This project is licensed under the Apache-2.0 License.

## Related Resources

- [Cedar Language Documentation](https://docs.cedarpolicy.com/)
- [Cedar Policy GitHub](https://github.com/cedar-policy/cedar)
- [cedar-go Library](https://github.com/cedar-policy/cedar-go)
