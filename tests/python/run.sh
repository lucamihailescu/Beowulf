#!/bin/bash
set -e

# Change to the directory of this script
cd "$(dirname "$0")"

echo "Setting up Python environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt

echo "Generating gRPC code..."
PROTO_DIR="../../backend/api/proto/v1"
python -m grpc_tools.protoc -I"$PROTO_DIR" --python_out=. --grpc_python_out=. authz.proto

echo "Running gRPC tests..."
python test_entitlements.py

echo "Running REST tests..."
python test_rest_entitlements.py

