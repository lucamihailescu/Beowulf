# Cedar Authorization Portal

A full-stack implementation for managing [Cedar](https://github.com/cedar-policy/cedar) authorization policies. This platform provides a backend API and web UI for managing applications, policies, entities, schemas, and authorization decisions with complete audit trail support.

## Features

### Core Authorization
- **Multi-tenant Applications** — Manage multiple applications with isolated policies and entities
- **Cedar Policy Evaluation** — Real-time authorization using [cedar-go](https://github.com/cedar-policy/cedar-go)
- **Policy Versioning** — Create and manage multiple policy versions with activation control
- **Entity Management** — Store and manage Cedar entities with hierarchical parent relationships
- **Authorization API** — RESTful endpoint for policy decision requests

### Namespace Management
- **Shared Namespaces** — Group related applications under common namespaces
- **Team Isolation** — Different teams can have separate namespaces with no cross-contamination
- **Cedar Namespace Mapping** — Namespaces map directly to Cedar's namespace format (e.g., `Ecommerce::User`)
- **Flexible Grouping** — Single namespace for tightly-coupled microservices, separate namespaces for independent apps

### Schema Management
- **Cedar Schemas** — Upload and manage Cedar schemas per application
- **Schema Versioning** — Maintain multiple schema versions with activation control
- **JSON Schema Format** — Support for Cedar's JSON schema format

### Audit Trail
- **Decision Logging** — Every authorization decision is logged with full context
- **Administrative Actions** — Track policy, entity, and schema changes
- **Filterable Logs** — Query audit logs by application, action type, or decision
- **Compliance Ready** — Comprehensive audit trail for SOC2, HIPAA, and other compliance requirements

### Performance
- **Redis Caching** — Cache policies and entities for fast authorization decisions
- **Cache Invalidation** — Automatic invalidation when policies or entities change
- **Connection Pooling** — PostgreSQL connection pooling for high throughput

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Web Portal    │────▶│   Backend API   │────▶│   PostgreSQL    │
│   (React/Vite)  │     │   (Go/Chi)      │     │                 │
│                 │     │                 │     └─────────────────┘
└─────────────────┘     │                 │
                        │                 │     ┌─────────────────┐
                        │                 │────▶│     Redis       │
                        │                 │     │   (Cache)       │
                        └─────────────────┘     └─────────────────┘
```

### Tech Stack
- **Backend**: Go 1.23+, Chi router, pgx (PostgreSQL driver), cedar-go
- **Frontend**: React 18, TypeScript, Vite, Ant Design
- **Database**: PostgreSQL 16
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
   - Backend API: http://localhost:8080
   - Health Check: http://localhost:8080/health

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `8080` | Backend API port |
| `DATABASE_URL` | `postgres://cedar:cedar@db:5432/cedar?sslmode=disable` | PostgreSQL connection string |
| `REDIS_ADDR` | `localhost:6379` | Redis address |
| `REDIS_PASSWORD` | `` | Redis password (optional) |
| `AUTHZ_CACHE_TTL` | `5s` | Cache TTL for policies/entities |
| `CORS_ALLOW_ORIGINS` | `*` | Allowed CORS origins |
| `VITE_API_BASE_URL` | `http://localhost:8080` | Backend API URL for frontend |

## API Reference

### Authorization

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

# Start the server
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

1. **Authentication** — The current implementation does not include authentication. Consider adding JWT or session-based auth for production.

2. **HTTPS** — Use a reverse proxy (nginx, Caddy) or load balancer for TLS termination.

3. **Database** — Use managed PostgreSQL (RDS, Cloud SQL) with connection pooling.

4. **Caching** — Use managed Redis (ElastiCache, Memorystore) for high availability.

5. **Monitoring** — Add OpenTelemetry instrumentation for tracing and metrics.

6. **Backups** — Configure automated database backups and audit log retention.

## License

This project is licensed under the Apache-2.0 License.

## Related Resources

- [Cedar Language Documentation](https://docs.cedarpolicy.com/)
- [Cedar Policy GitHub](https://github.com/cedar-policy/cedar)
- [cedar-go Library](https://github.com/cedar-policy/cedar-go)

