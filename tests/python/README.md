# Python Entitlement Tests

This directory contains Python tests for:
1. The gRPC API (`LookupResources` / entitlements)
2. The REST API (`GET /v1/apps/{id}/permissions`)

## Prerequisites

- Python 3.8+
- The Cedar backend server running on:
  - `localhost:50051` (gRPC)
  - `localhost:8080` (REST)

## Running the Tests

You can run both sets of tests using the provided shell script:

```bash
./run.sh
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

3. Generate gRPC code:
   ```bash
   python -m grpc_tools.protoc -I../../backend/api/proto/v1 --python_out=. --grpc_python_out=. authz.proto
   ```

4. Run the test scripts:
   ```bash
   python test_entitlements.py      # gRPC test
   python test_rest_entitlements.py # REST test
   ```

