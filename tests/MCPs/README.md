# FastMCP MCP Servers (Tests)

This folder contains test MCP servers used to validate authorization flows.

## Hello World Server with Provider Switch

Server file: `tests/MCPs/hello_world_fastmcp_server.py`

This server:
- supports provider switch by environment variable:
  - `azure` -> FastMCP `AzureProvider`
  - `oidc`  -> FastMCP `OIDCProxy`
- exposes one tool: `hello_world`,
- returns `"Hello World"` only when authorized and scope `hello:read` is present.

## Common Environment Variables

```bash
export HELLO_MCP_BASE_URL="http://127.0.0.1:8780"
export HELLO_MCP_UPSTREAM_CLIENT_ID="your-client-id"
export HELLO_MCP_UPSTREAM_CLIENT_SECRET="your-client-secret"
export HELLO_MCP_PROVIDER_TYPE="oidc"   # or "azure"
```

## Provider Type: `oidc` (Generic OIDC Discovery)

```bash
export HELLO_MCP_PROVIDER_TYPE="oidc"
export HELLO_MCP_OIDC_CONFIG_URL="https://provider.example.com/.well-known/openid-configuration"
export HELLO_MCP_AUDIENCE="hello-mcp-api"
export HELLO_MCP_REQUIRED_SCOPES="hello:read"
python3 tests/MCPs/hello_world_fastmcp_server.py
```

## Provider Type: `azure` (Microsoft Entra ID)

```bash
export HELLO_MCP_PROVIDER_TYPE="azure"
export HELLO_MCP_AZURE_TENANT_ID="your-tenant-id"
export HELLO_MCP_AZURE_IDENTIFIER_URI="api://<your-api-app-id>"   # optional; defaults to api://<client-id>
export HELLO_MCP_REQUIRED_SCOPES="hello.read"                      # unprefixed custom API scopes
python3 tests/MCPs/hello_world_fastmcp_server.py
```

## Optional Environment Variables (Both Modes)

- `HELLO_MCP_ALGORITHM` (example: `RS256`)
- `HELLO_MCP_ALLOWED_CLIENT_REDIRECT_URIS` (CSV wildcard patterns)
- `HELLO_MCP_REDIRECT_PATH` (default FastMCP callback path)
- `HELLO_MCP_TOKEN_ENDPOINT_AUTH_METHOD` (`client_secret_basic`, `client_secret_post`, `none`)
- `HELLO_MCP_EXTRA_AUTHORIZE_PARAMS` (JSON object of string key/values)
- `HELLO_MCP_EXTRA_TOKEN_PARAMS` (JSON object of string key/values)
- `HELLO_MCP_OIDC_STRICT` (`true`/`false`, default `false`)
- `HELLO_MCP_OIDC_TIMEOUT_SECONDS` (integer)
- `HELLO_MCP_REQUIRE_AUTHORIZATION_CONSENT` (`true`/`false`, default `true`)
- `HELLO_MCP_ENABLE_CIMD` (`true`/`false`, default `true`)
- `HELLO_MCP_TOOL_REQUIRED_SCOPE` (default `hello:read`; accepts `hello.read` tokens automatically)
- `HELLO_MCP_AZURE_ADDITIONAL_AUTHORIZE_SCOPES` (CSV, Azure mode only)
- `HELLO_MCP_AZURE_BASE_AUTHORITY` (default `login.microsoftonline.com`, Azure mode only)

## Runtime Validation Checklist

1. Register the server in Cursor as `streamableHttp` URL `http://127.0.0.1:8780/mcp`.
2. Cursor initiates OAuth via proxy endpoints.
3. After successful provider login/consent, `hello_world` is visible.
4. Calling `hello_world` with `hello:read` scope returns `"Hello World"`.
5. Missing `hello:read` scope denies access.

## Notes

- Use HTTP transports (`streamable-http` or `sse`) for OAuth/OIDC auth flows.
- In STDIO transport, OAuth token auth is not available in FastMCP.
- `OIDCProxy` and `AzureProvider` each represent one upstream provider per running server instance.
