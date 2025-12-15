# Python Entitlement Tests

This directory contains Python tests for the Cedar Authorization Service gRPC API, specifically focusing on the `LookupResources` (entitlements) functionality.

## Prerequisites

- Python 3.8+
- The Cedar backend server running on `localhost:50051`

## Running the Tests

You can run the tests using the provided shell script, which handles virtual environment creation, dependency installation, and protobuf code generation:

```bash
./run.sh
```

## Manual Setup

If you prefer to run manually:

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

4. Run the test script:
   ```bash
   python test_entitlements.py
   ```

