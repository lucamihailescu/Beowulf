# Enterprise Policy Management - Client SDKs

This directory contains client SDKs for integrating with the Enterprise Policy Management (EPM) system.

## Supported Languages

| Language | gRPC | REST | MCP SDK |
|----------|------|------|---------|
| Python | ✅ | ✅ | ✅ |
| JavaScript/TypeScript | ✅ | ✅ | - |
| C# (.NET) | ✅ | ✅ | - |

## MCP (Model Context Protocol) Integration

The Python MCP SDK provides authorization helpers for AI/LLM tool servers:

```python
from clients.python.mcp import CedarMCPAuthorizer, CedarMCPConfig

# Configure the authorizer
config = CedarMCPConfig(
    cedar_url="http://localhost:8080",
    app_id=1,
    cache_ttl_seconds=60,
    enable_sse=True  # Real-time cache invalidation
)

authorizer = CedarMCPAuthorizer(config)

# Filter available tools for a user
available_tools = authorizer.filter_tools(all_tools, user_id="alice")

# Check tool authorization
if authorizer.authorize_tool("read_document", user_id="alice"):
    result = execute_tool(...)

# Get all entitlements (for IdP integration)
entitlements = authorizer.get_user_entitlements(
    username="alice",
    groups=["analysts", "team-alpha"]
)

# Use decorator for automatic authorization
@authorizer.require_authorization(action="read_document")
async def read_document(user_id: str, doc_id: str):
    ...
```

### IdP Integration

The `/v1/entitlements` endpoint allows Identity Providers to query user permissions:

```python
import requests

response = requests.post(
    "http://localhost:8080/v1/entitlements",
    json={
        "application_id": 1,
        "username": "alice",
        "groups": ["analysts", "team-alpha"],
        "include_inherited": True
    },
    headers={"Authorization": "Bearer <token>"}
)

# Response:
# {
#   "username": "alice",
#   "application_id": 1,
#   "application_name": "demo-app",
#   "entitlements": [
#     {"effect": "permit", "actions": ["view", "edit"], "resource_types": ["Document"]}
#   ],
#   "group_entitlements": {
#     "analysts": [{"effect": "permit", "actions": ["read"], ...}]
#   }
# }
```

### Real-Time Policy Updates (SSE)

Subscribe to policy changes for cache invalidation:

```python
from clients.python.mcp import SSESubscriber

def on_policy_update(event):
    print(f"Policy updated: {event.event_type} for app {event.app_id}")
    cache.invalidate(event.app_id)

subscriber = SSESubscriber(
    url="http://localhost:8080/v1/events",
    on_event=on_policy_update,
    app_id=1  # Optional filter
)
subscriber.start()
```

## Quick Start

### Generate All Clients

```bash
# Generate gRPC clients for all languages (works offline)
make clients-grpc

# Generate REST clients for all languages (requires running server)
make clients-rest

# Generate everything
make clients-all
```

### Generate Specific Clients

```bash
# Python gRPC only
./generate.sh --grpc --python

# JavaScript REST only (server must be running)
./generate.sh --rest --javascript

# C# both gRPC and REST
./generate.sh --all --csharp
```

## Usage Examples

### Python (gRPC)

```python
from clients.python.grpc.client import EPMClient

# Connect to the gRPC server
with EPMClient("localhost:50051") as client:
    # Single authorization check
    result = client.check(
        app_id="1",
        principal_type="User",
        principal_id="alice",
        action_type="Action",
        action_id="view",
        resource_type="Document",
        resource_id="doc1"
    )
    print(f"Allowed: {result.allowed}")
    
    # Lookup accessible resources
    resources = client.lookup_resources(
        app_id="1",
        principal_type="User",
        principal_id="alice",
        action_type="Action",
        action_id="view",
        resource_type="Document"
    )
    print(f"Accessible documents: {resources}")
```

### JavaScript/TypeScript (gRPC)

```javascript
const { EPMClient } = require('./clients/javascript/grpc');

const client = new EPMClient('localhost:50051');

// Async authorization check
const result = await client.check(
    '1',           // appId
    'User',        // principalType
    'alice',       // principalId
    'Action',      // actionType
    'view',        // actionId
    'Document',    // resourceType
    'doc1'         // resourceId
);

console.log(`Allowed: ${result.allowed}`);

// Batch check
const batchResult = await client.batchCheck([
    { appId: '1', principalType: 'User', principalId: 'alice', actionType: 'Action', actionId: 'view', resourceType: 'Document', resourceId: 'doc1' },
    { appId: '1', principalType: 'User', principalId: 'alice', actionType: 'Action', actionId: 'edit', resourceType: 'Document', resourceId: 'doc1' }
]);

client.close();
```

### C# (.NET)

```csharp
using EPM.Grpc.Client;

using var client = new EPMClient("http://localhost:50051");

// Authorization check
var result = await client.CheckAsync(
    appId: "1",
    principalType: "User",
    principalId: "alice",
    actionType: "Action",
    actionId: "view",
    resourceType: "Document",
    resourceId: "doc1"
);

Console.WriteLine($"Allowed: {result.Allowed}");

// Lookup resources
var resources = await client.LookupResourcesAsync(
    appId: "1",
    principalType: "User",
    principalId: "alice",
    actionType: "Action",
    actionId: "view",
    resourceType: "Document"
);

foreach (var resourceId in resources)
{
    Console.WriteLine($"Accessible: {resourceId}");
}
```

## REST Clients

REST clients are generated from the OpenAPI specification using [OpenAPI Generator](https://openapi-generator.tech/).

### Prerequisites

The backend server must be running with Swagger docs available:

```bash
# Start services
make compose-up

# Generate Swagger docs
make backend-docs

# Rebuild backend to serve docs
docker compose up -d --build backend
```

### Generated REST Client Usage

Each language's REST client includes generated models and API classes. Refer to the generated documentation in each `rest/` subdirectory.

## Directory Structure

```
clients/
├── generate.sh          # Main generation script
├── README.md            # This file
├── .gitignore           # Ignore generated files
├── python/
│   ├── grpc/            # Python gRPC client
│   │   ├── authz_pb2.py
│   │   ├── authz_pb2_grpc.py
│   │   └── client.py    # High-level wrapper
│   └── rest/            # Python REST client (generated)
├── javascript/
│   ├── grpc/            # JavaScript/TypeScript gRPC client
│   │   ├── package.json
│   │   ├── index.js
│   │   └── index.d.ts   # TypeScript definitions
│   └── rest/            # TypeScript REST client (generated)
└── csharp/
    ├── grpc/            # C# gRPC client
    │   ├── EPM.Grpc.Client.csproj
    │   └── EPMClient.cs
    └── rest/            # C# REST client (generated)
```

## Authentication

### API Key (Read-Only Access)

```python
# Python example with API Key
import requests

response = requests.get(
    "http://localhost:8080/v1/apps/1/permissions",
    headers={"X-API-Key": "your-api-key"}
)
```

### JWT Authentication

```python
# Python example with JWT
response = requests.post(
    "http://localhost:8080/v1/authorize",
    headers={"Authorization": "Bearer your-jwt-token"},
    json={...}
)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAPI_URL` | `http://localhost:8080/swagger/doc.json` | OpenAPI spec URL for REST generation |

## Troubleshooting

### gRPC Connection Refused

Ensure the gRPC port is exposed:

```yaml
# docker-compose.yml
backend:
  ports:
    - "8080:8080"
    - "50051:50051"  # gRPC port
```

### REST Generation Fails

1. Ensure the backend is running: `docker compose ps`
2. Verify Swagger docs: `curl http://localhost:8080/swagger/doc.json`
3. Regenerate docs: `make backend-docs && docker compose up -d --build backend`

### C# Build Errors

Ensure .NET 8 SDK is installed:

```bash
dotnet --version  # Should be 8.x
```

