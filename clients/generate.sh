#!/bin/bash
# Client SDK Generator for Enterprise Policy Management
# Generates gRPC and REST client bindings for Python, JavaScript/TypeScript, and C#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROTO_DIR="$ROOT_DIR/backend/api/proto/v1"
PROTO_FILE="$PROTO_DIR/authz.proto"
OPENAPI_URL="${OPENAPI_URL:-http://localhost:8080/swagger/doc.json}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
GENERATE_GRPC=false
GENERATE_REST=false
LANGUAGES=""

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --grpc              Generate gRPC bindings"
    echo "  --rest              Generate REST bindings (requires running server)"
    echo "  --all               Generate both gRPC and REST bindings"
    echo "  --python            Generate Python bindings"
    echo "  --javascript        Generate JavaScript/TypeScript bindings"
    echo "  --csharp            Generate C# bindings"
    echo "  --all-languages     Generate bindings for all languages"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --grpc --python              Generate Python gRPC bindings"
    echo "  $0 --all --all-languages        Generate all bindings for all languages"
    echo "  $0 --rest --javascript          Generate JS REST client (server must be running)"
    exit 1
}

if [ $# -eq 0 ]; then
    usage
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --grpc)
            GENERATE_GRPC=true
            shift
            ;;
        --rest)
            GENERATE_REST=true
            shift
            ;;
        --all)
            GENERATE_GRPC=true
            GENERATE_REST=true
            shift
            ;;
        --python)
            LANGUAGES="$LANGUAGES python"
            shift
            ;;
        --javascript)
            LANGUAGES="$LANGUAGES javascript"
            shift
            ;;
        --csharp)
            LANGUAGES="$LANGUAGES csharp"
            shift
            ;;
        --all-languages)
            LANGUAGES="python javascript csharp"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

if [ -z "$LANGUAGES" ]; then
    log_error "No language specified. Use --python, --javascript, --csharp, or --all-languages"
    exit 1
fi

if [ "$GENERATE_GRPC" = false ] && [ "$GENERATE_REST" = false ]; then
    log_error "No API type specified. Use --grpc, --rest, or --all"
    exit 1
fi

# Check proto file exists
if [ ! -f "$PROTO_FILE" ]; then
    log_error "Proto file not found: $PROTO_FILE"
    exit 1
fi

# =============================================================================
# gRPC Generation Functions
# =============================================================================

generate_grpc_python() {
    log_info "Generating Python gRPC bindings..."
    
    OUTPUT_DIR="$SCRIPT_DIR/python/grpc"
    mkdir -p "$OUTPUT_DIR"
    
    # Check for grpcio-tools
    if ! python3 -c "import grpc_tools.protoc" 2>/dev/null; then
        log_warn "Installing grpcio-tools..."
        pip3 install grpcio grpcio-tools
    fi
    
    python3 -m grpc_tools.protoc \
        -I "$PROTO_DIR" \
        --python_out="$OUTPUT_DIR" \
        --pyi_out="$OUTPUT_DIR" \
        --grpc_python_out="$OUTPUT_DIR" \
        "$PROTO_FILE"
    
    # Create __init__.py
    cat > "$OUTPUT_DIR/__init__.py" << 'EOF'
"""Enterprise Policy Management - Python gRPC Client"""
from .authz_pb2 import *
from .authz_pb2_grpc import *
EOF

    # Create a helper client wrapper
    cat > "$OUTPUT_DIR/client.py" << 'EOF'
"""
Enterprise Policy Management - gRPC Client Wrapper

Example usage:
    from client import EPMClient
    
    client = EPMClient("localhost:50051")
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
"""
import grpc
from . import authz_pb2
from . import authz_pb2_grpc


class EPMClient:
    """Enterprise Policy Management gRPC Client"""
    
    def __init__(self, target: str, secure: bool = False, credentials=None):
        """
        Initialize the client.
        
        Args:
            target: gRPC server address (e.g., "localhost:50051")
            secure: Use TLS connection
            credentials: Optional gRPC credentials for secure connections
        """
        if secure:
            if credentials is None:
                credentials = grpc.ssl_channel_credentials()
            self.channel = grpc.secure_channel(target, credentials)
        else:
            self.channel = grpc.insecure_channel(target)
        
        self.stub = authz_pb2_grpc.AuthorizationServiceStub(self.channel)
    
    def check(
        self,
        app_id: str,
        principal_type: str,
        principal_id: str,
        action_type: str,
        action_id: str,
        resource_type: str,
        resource_id: str,
        context: dict = None
    ) -> authz_pb2.CheckResponse:
        """
        Perform an authorization check.
        
        Returns:
            CheckResponse with allowed, reasons, and errors fields
        """
        request = authz_pb2.CheckRequest(
            application_id=app_id,
            principal=authz_pb2.Entity(type=principal_type, id=principal_id),
            action=authz_pb2.Entity(type=action_type, id=action_id),
            resource=authz_pb2.Entity(type=resource_type, id=resource_id),
        )
        
        if context:
            for key, value in context.items():
                if isinstance(value, str):
                    request.context[key].string_value = value
                elif isinstance(value, int):
                    request.context[key].int_value = value
                elif isinstance(value, bool):
                    request.context[key].bool_value = value
        
        return self.stub.Check(request)
    
    def batch_check(self, checks: list) -> authz_pb2.BatchCheckResponse:
        """
        Perform multiple authorization checks in parallel.
        
        Args:
            checks: List of dicts with keys: app_id, principal_type, principal_id,
                   action_type, action_id, resource_type, resource_id, context
        
        Returns:
            BatchCheckResponse with results list
        """
        requests = []
        for check in checks:
            req = authz_pb2.CheckRequest(
                application_id=check["app_id"],
                principal=authz_pb2.Entity(
                    type=check["principal_type"],
                    id=check["principal_id"]
                ),
                action=authz_pb2.Entity(
                    type=check["action_type"],
                    id=check["action_id"]
                ),
                resource=authz_pb2.Entity(
                    type=check["resource_type"],
                    id=check["resource_id"]
                ),
            )
            requests.append(req)
        
        batch_request = authz_pb2.BatchCheckRequest(checks=requests)
        return self.stub.BatchCheck(batch_request)
    
    def lookup_resources(
        self,
        app_id: str,
        principal_type: str,
        principal_id: str,
        action_type: str,
        action_id: str,
        resource_type: str,
        context: dict = None
    ) -> list:
        """
        Look up resources the principal can access.
        
        Returns:
            List of resource IDs
        """
        request = authz_pb2.LookupResourcesRequest(
            application_id=app_id,
            principal=authz_pb2.Entity(type=principal_type, id=principal_id),
            action=authz_pb2.Entity(type=action_type, id=action_id),
            resource_type=resource_type,
        )
        
        if context:
            for key, value in context.items():
                if isinstance(value, str):
                    request.context[key].string_value = value
                elif isinstance(value, int):
                    request.context[key].int_value = value
                elif isinstance(value, bool):
                    request.context[key].bool_value = value
        
        response = self.stub.LookupResources(request)
        return list(response.resource_ids)
    
    def close(self):
        """Close the gRPC channel."""
        self.channel.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
EOF

    log_info "Python gRPC bindings generated in $OUTPUT_DIR"
}

generate_grpc_javascript() {
    log_info "Generating JavaScript/TypeScript gRPC bindings..."
    
    OUTPUT_DIR="$SCRIPT_DIR/javascript/grpc"
    mkdir -p "$OUTPUT_DIR"
    
    # Check for required tools
    if ! command -v npx &> /dev/null; then
        log_error "npx not found. Please install Node.js"
        return 1
    fi
    
    # Initialize package.json if not exists
    if [ ! -f "$OUTPUT_DIR/package.json" ]; then
        cat > "$OUTPUT_DIR/package.json" << 'EOF'
{
  "name": "@epm/grpc-client",
  "version": "1.0.0",
  "description": "Enterprise Policy Management gRPC Client",
  "main": "index.js",
  "types": "index.d.ts",
  "dependencies": {
    "@grpc/grpc-js": "^1.9.0",
    "@grpc/proto-loader": "^0.7.0",
    "google-protobuf": "^3.21.0"
  },
  "devDependencies": {
    "grpc-tools": "^1.12.0",
    "grpc_tools_node_protoc_ts": "^5.3.0",
    "typescript": "^5.0.0"
  }
}
EOF
        log_info "Installing JavaScript dependencies..."
        (cd "$OUTPUT_DIR" && npm install)
    fi
    
    # Generate using grpc-tools
    PROTOC_GEN_TS="$OUTPUT_DIR/node_modules/.bin/protoc-gen-ts"
    PROTOC_GEN_GRPC="$OUTPUT_DIR/node_modules/.bin/grpc_tools_node_protoc_plugin"
    
    # Use grpc_tools_node_protoc for generation
    "$OUTPUT_DIR/node_modules/.bin/grpc_tools_node_protoc" \
        --js_out=import_style=commonjs,binary:"$OUTPUT_DIR" \
        --grpc_out=grpc_js:"$OUTPUT_DIR" \
        --plugin=protoc-gen-grpc="$PROTOC_GEN_GRPC" \
        -I "$PROTO_DIR" \
        "$PROTO_FILE" || {
            log_warn "grpc_tools_node_protoc failed, trying alternative method..."
            # Alternative: Use proto-loader for dynamic loading
            cat > "$OUTPUT_DIR/index.js" << 'EOFJS'
/**
 * Enterprise Policy Management - gRPC Client (Dynamic Loading)
 */
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, '../../..', 'backend/api/proto/v1/authz.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const cedar = protoDescriptor.cedar.v1;

class EPMClient {
  /**
   * Create a new EPM gRPC client
   * @param {string} target - Server address (e.g., "localhost:50051")
   * @param {boolean} secure - Use TLS connection
   */
  constructor(target, secure = false) {
    const credentials = secure 
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();
    
    this.client = new cedar.AuthorizationService(target, credentials);
  }

  /**
   * Perform an authorization check
   */
  check(appId, principalType, principalId, actionType, actionId, resourceType, resourceId, context = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        application_id: appId,
        principal: { type: principalType, id: principalId },
        action: { type: actionType, id: actionId },
        resource: { type: resourceType, id: resourceId },
        context: this._buildContext(context)
      };

      this.client.Check(request, (err, response) => {
        if (err) reject(err);
        else resolve(response);
      });
    });
  }

  /**
   * Perform batch authorization checks
   */
  batchCheck(checks) {
    return new Promise((resolve, reject) => {
      const request = {
        checks: checks.map(c => ({
          application_id: c.appId,
          principal: { type: c.principalType, id: c.principalId },
          action: { type: c.actionType, id: c.actionId },
          resource: { type: c.resourceType, id: c.resourceId },
          context: this._buildContext(c.context || {})
        }))
      };

      this.client.BatchCheck(request, (err, response) => {
        if (err) reject(err);
        else resolve(response);
      });
    });
  }

  /**
   * Look up resources the principal can access
   */
  lookupResources(appId, principalType, principalId, actionType, actionId, resourceType, context = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        application_id: appId,
        principal: { type: principalType, id: principalId },
        action: { type: actionType, id: actionId },
        resource_type: resourceType,
        context: this._buildContext(context)
      };

      this.client.LookupResources(request, (err, response) => {
        if (err) reject(err);
        else resolve(response.resource_ids);
      });
    });
  }

  _buildContext(context) {
    const result = {};
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        result[key] = { string_value: value };
      } else if (typeof value === 'number') {
        result[key] = { int_value: value };
      } else if (typeof value === 'boolean') {
        result[key] = { bool_value: value };
      }
    }
    return result;
  }

  close() {
    grpc.closeClient(this.client);
  }
}

module.exports = { EPMClient };
EOFJS
        }
    
    # Create TypeScript definitions
    cat > "$OUTPUT_DIR/index.d.ts" << 'EOFTS'
/**
 * Enterprise Policy Management - gRPC Client TypeScript Definitions
 */

export interface CheckResult {
  allowed: boolean;
  reasons: string[];
  errors: string[];
}

export interface BatchCheckResult {
  results: CheckResult[];
}

export class EPMClient {
  constructor(target: string, secure?: boolean);
  
  check(
    appId: string,
    principalType: string,
    principalId: string,
    actionType: string,
    actionId: string,
    resourceType: string,
    resourceId: string,
    context?: Record<string, string | number | boolean>
  ): Promise<CheckResult>;
  
  batchCheck(checks: Array<{
    appId: string;
    principalType: string;
    principalId: string;
    actionType: string;
    actionId: string;
    resourceType: string;
    resourceId: string;
    context?: Record<string, string | number | boolean>;
  }>): Promise<BatchCheckResult>;
  
  lookupResources(
    appId: string,
    principalType: string,
    principalId: string,
    actionType: string,
    actionId: string,
    resourceType: string,
    context?: Record<string, string | number | boolean>
  ): Promise<string[]>;
  
  close(): void;
}
EOFTS

    log_info "JavaScript/TypeScript gRPC bindings generated in $OUTPUT_DIR"
}

generate_grpc_csharp() {
    log_info "Generating C# gRPC bindings..."
    
    OUTPUT_DIR="$SCRIPT_DIR/csharp/grpc"
    mkdir -p "$OUTPUT_DIR"
    
    # Check for dotnet
    if ! command -v dotnet &> /dev/null; then
        log_error "dotnet CLI not found. Please install .NET SDK"
        return 1
    fi
    
    # Create project if not exists
    if [ ! -f "$OUTPUT_DIR/EPM.Grpc.Client.csproj" ]; then
        cat > "$OUTPUT_DIR/EPM.Grpc.Client.csproj" << 'EOF'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>EPM.Grpc.Client</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Google.Protobuf" Version="3.25.1" />
    <PackageReference Include="Grpc.Net.Client" Version="2.59.0" />
    <PackageReference Include="Grpc.Tools" Version="2.59.0" PrivateAssets="All" />
  </ItemGroup>

  <ItemGroup>
    <Protobuf Include="authz.proto" GrpcServices="Client" />
  </ItemGroup>
</Project>
EOF
        # Copy proto file
        cp "$PROTO_FILE" "$OUTPUT_DIR/"
        
        # Create client wrapper
        cat > "$OUTPUT_DIR/EPMClient.cs" << 'EOFCS'
using Grpc.Net.Client;
using Cedar.V1;

namespace EPM.Grpc.Client;

/// <summary>
/// Enterprise Policy Management gRPC Client
/// </summary>
public class EPMClient : IDisposable
{
    private readonly GrpcChannel _channel;
    private readonly AuthorizationService.AuthorizationServiceClient _client;

    /// <summary>
    /// Create a new EPM client
    /// </summary>
    /// <param name="address">Server address (e.g., "http://localhost:50051")</param>
    public EPMClient(string address)
    {
        _channel = GrpcChannel.ForAddress(address);
        _client = new AuthorizationService.AuthorizationServiceClient(_channel);
    }

    /// <summary>
    /// Perform an authorization check
    /// </summary>
    public async Task<CheckResponse> CheckAsync(
        string appId,
        string principalType,
        string principalId,
        string actionType,
        string actionId,
        string resourceType,
        string resourceId,
        Dictionary<string, object>? context = null,
        CancellationToken cancellationToken = default)
    {
        var request = new CheckRequest
        {
            ApplicationId = appId,
            Principal = new Entity { Type = principalType, Id = principalId },
            Action = new Entity { Type = actionType, Id = actionId },
            Resource = new Entity { Type = resourceType, Id = resourceId }
        };

        if (context != null)
        {
            foreach (var (key, value) in context)
            {
                request.Context[key] = CreateValue(value);
            }
        }

        return await _client.CheckAsync(request, cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Perform batch authorization checks
    /// </summary>
    public async Task<BatchCheckResponse> BatchCheckAsync(
        IEnumerable<CheckRequest> checks,
        CancellationToken cancellationToken = default)
    {
        var request = new BatchCheckRequest();
        request.Checks.AddRange(checks);
        return await _client.BatchCheckAsync(request, cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Look up resources the principal can access
    /// </summary>
    public async Task<IReadOnlyList<string>> LookupResourcesAsync(
        string appId,
        string principalType,
        string principalId,
        string actionType,
        string actionId,
        string resourceType,
        Dictionary<string, object>? context = null,
        CancellationToken cancellationToken = default)
    {
        var request = new LookupResourcesRequest
        {
            ApplicationId = appId,
            Principal = new Entity { Type = principalType, Id = principalId },
            Action = new Entity { Type = actionType, Id = actionId },
            ResourceType = resourceType
        };

        if (context != null)
        {
            foreach (var (key, value) in context)
            {
                request.Context[key] = CreateValue(value);
            }
        }

        var response = await _client.LookupResourcesAsync(request, cancellationToken: cancellationToken);
        return response.ResourceIds.ToList();
    }

    private static Value CreateValue(object value)
    {
        return value switch
        {
            string s => new Value { StringValue = s },
            int i => new Value { IntValue = i },
            long l => new Value { IntValue = l },
            bool b => new Value { BoolValue = b },
            _ => throw new ArgumentException($"Unsupported context value type: {value.GetType()}")
        };
    }

    public void Dispose()
    {
        _channel.Dispose();
    }
}
EOFCS
        
        log_info "Building C# project..."
        (cd "$OUTPUT_DIR" && dotnet build -c Release) || log_warn "C# build failed - you may need to run 'dotnet build' manually"
    fi
    
    log_info "C# gRPC bindings generated in $OUTPUT_DIR"
}

# =============================================================================
# REST Generation Functions (using OpenAPI Generator)
# =============================================================================

check_openapi_generator() {
    if ! command -v openapi-generator-cli &> /dev/null; then
        if command -v npx &> /dev/null; then
            log_info "Using npx for openapi-generator-cli"
            OPENAPI_GEN="npx @openapitools/openapi-generator-cli"
        else
            log_error "openapi-generator-cli not found. Install with: npm install -g @openapitools/openapi-generator-cli"
            return 1
        fi
    else
        OPENAPI_GEN="openapi-generator-cli"
    fi
}

check_openapi_available() {
    log_info "Checking if OpenAPI spec is available at $OPENAPI_URL..."
    if ! curl -s --fail "$OPENAPI_URL" > /dev/null 2>&1; then
        log_error "Cannot fetch OpenAPI spec from $OPENAPI_URL"
        log_error "Make sure the backend server is running and Swagger docs are generated."
        log_error "Run: make compose-up && make backend-docs"
        return 1
    fi
}

generate_rest_python() {
    log_info "Generating Python REST client..."
    
    OUTPUT_DIR="$SCRIPT_DIR/python/rest"
    
    check_openapi_generator || return 1
    check_openapi_available || return 1
    
    $OPENAPI_GEN generate \
        -i "$OPENAPI_URL" \
        -g python \
        -o "$OUTPUT_DIR" \
        --additional-properties=packageName=epm_rest_client,projectName=epm-rest-client \
        --skip-validate-spec
    
    log_info "Python REST client generated in $OUTPUT_DIR"
}

generate_rest_javascript() {
    log_info "Generating JavaScript/TypeScript REST client..."
    
    OUTPUT_DIR="$SCRIPT_DIR/javascript/rest"
    
    check_openapi_generator || return 1
    check_openapi_available || return 1
    
    $OPENAPI_GEN generate \
        -i "$OPENAPI_URL" \
        -g typescript-fetch \
        -o "$OUTPUT_DIR" \
        --additional-properties=npmName=@epm/rest-client,supportsES6=true,typescriptThreePlus=true \
        --skip-validate-spec
    
    log_info "JavaScript/TypeScript REST client generated in $OUTPUT_DIR"
}

generate_rest_csharp() {
    log_info "Generating C# REST client..."
    
    OUTPUT_DIR="$SCRIPT_DIR/csharp/rest"
    
    check_openapi_generator || return 1
    check_openapi_available || return 1
    
    $OPENAPI_GEN generate \
        -i "$OPENAPI_URL" \
        -g csharp-netcore \
        -o "$OUTPUT_DIR" \
        --additional-properties=packageName=EPM.Rest.Client,targetFramework=net8.0 \
        --skip-validate-spec
    
    log_info "C# REST client generated in $OUTPUT_DIR"
}

# =============================================================================
# Main Execution
# =============================================================================

log_info "Enterprise Policy Management - Client SDK Generator"
log_info "=================================================="

for lang in $LANGUAGES; do
    case $lang in
        python)
            if [ "$GENERATE_GRPC" = true ]; then
                generate_grpc_python
            fi
            if [ "$GENERATE_REST" = true ]; then
                generate_rest_python
            fi
            ;;
        javascript)
            if [ "$GENERATE_GRPC" = true ]; then
                generate_grpc_javascript
            fi
            if [ "$GENERATE_REST" = true ]; then
                generate_rest_javascript
            fi
            ;;
        csharp)
            if [ "$GENERATE_GRPC" = true ]; then
                generate_grpc_csharp
            fi
            if [ "$GENERATE_REST" = true ]; then
                generate_rest_csharp
            fi
            ;;
    esac
done

log_info "=================================================="
log_info "Client generation complete!"

