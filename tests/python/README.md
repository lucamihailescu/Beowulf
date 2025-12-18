# Python Test Suite

This directory contains Python tests for Cedar's APIs and features.

## Test Scripts

| Script | Description |
|--------|-------------|
| `test_entitlements.py` | gRPC API tests (`LookupResources` / entitlements) |
| `test_rest_entitlements.py` | REST API tests (`GET /v1/apps/{id}/permissions`) |
| `test_authorize_cache.py` | Cache validation tests |
| `test_load_balancing.py` | **Load balancing & HA tests** |
| `test_mcp_integration.py` | MCP SDK integration tests |
| `test_permissions_debug.py` | Permission debugging utilities |

## Prerequisites

- Python 3.8+
- The Cedar backend server running on:
  - `localhost:50051` (gRPC)
  - `localhost:8080` (REST/direct API)
  - `localhost:5173` (via load balancer)

## Running All Tests

```bash
./run.sh
```

## Running Individual Tests

### Load Balancing Tests

Tests the HA/load balancing setup with multiple backend instances:

```bash
# First, scale up backends
docker compose up -d --scale backend=3

# Run load balancing tests
python test_load_balancing.py
```

**What it tests:**
- `/v1/cluster/instances` - Verifies all instances are registered in Redis
- Load distribution - Confirms requests are spread across instances
- Concurrent health checks - Tests health endpoint under parallel load
- Authorization consistency - Verifies all instances return the same decisions
- SSE client tracking - Verifies per-instance SSE client counts

### MCP Integration Tests

```bash
python test_mcp_integration.py
```

**What it tests:**
- `/v1/entitlements` endpoint for IdP integration
- `/v1/events` SSE endpoint for real-time updates
- MCP SDK client-side caching

### gRPC Tests

```bash
# Generate gRPC code first
python -m grpc_tools.protoc -I../../backend/api/proto/v1 \
    --python_out=. --grpc_python_out=. authz.proto

python test_entitlements.py
```

### REST Tests

```bash
python test_rest_entitlements.py
```

## Manual Setup

1. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run tests as shown above.

## Expected Output (Load Balancing)

```
======================================================================
Load Balancing & High Availability Test Suite
======================================================================

=== Testing /v1/cluster/instances Endpoint ===
  Total instances registered: 3
  ✓ All 3 instance(s) are healthy

=== Testing Load Balancing Distribution (50 requests) ===
  ✓ Load balanced across 3 instances

=== Testing Concurrent Health Checks (20 parallel) ===
  ✓ 100% healthy responses

=== Testing Authorization Across Instances (30 requests) ===
  ✓ Consistent authorization across instances

=== Testing SSE Client Tracking ===
  ✓ SSE client tracking working

======================================================================
Overall: ✓ ALL TESTS PASSED
======================================================================
```
