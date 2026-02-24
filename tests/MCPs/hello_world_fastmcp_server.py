#!/usr/bin/env python3
"""
FastMCP server exposing a single authorized Hello World tool.

This server supports multiple auth provider types selected by environment:
- azure: FastMCP AzureProvider (Microsoft Entra ID specific behavior)
- oidc:  FastMCP OIDCProxy (generic OIDC discovery)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os

from fastmcp import FastMCP
from fastmcp.exceptions import AuthorizationError
from fastmcp.server.auth import AuthContext
from fastmcp.server.auth.oidc_proxy import OIDCProxy
from fastmcp.server.auth.providers.azure import AzureProvider


def _split_csv(value: str | None) -> list[str] | None:
    if value is None:
        return None
    items = [item.strip() for item in value.split(",") if item.strip()]
    return items or None


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be one of true/false/1/0/yes/no/on/off")


def _env_int(name: str) -> int | None:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return None
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _json_object_env(name: str) -> dict[str, str] | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{name} must be valid JSON") from exc
    if not isinstance(parsed, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()):
        raise ValueError(f"{name} must be a JSON object of string keys/values")
    return parsed


def _normalize_provider_type(value: str | None) -> str:
    normalized = (value or "oidc").strip().lower()
    aliases = {
        "azure": "azure",
        "aad": "azure",
        "entra": "azure",
        "oidc": "oidc",
        "generic": "oidc",
        "non-azure": "oidc",
    }
    if normalized not in aliases:
        raise ValueError("HELLO_MCP_PROVIDER_TYPE must be one of: azure, oidc")
    return aliases[normalized]


def build_oidc_auth_provider(default_host: str, default_port: int) -> OIDCProxy:
    base_url = os.getenv("HELLO_MCP_BASE_URL", "").strip() or f"http://{default_host}:{default_port}"

    required_scopes = _split_csv(os.getenv("HELLO_MCP_REQUIRED_SCOPES")) or ["hello:read"]
    allowed_redirect_uris = _split_csv(os.getenv("HELLO_MCP_ALLOWED_CLIENT_REDIRECT_URIS"))
    token_endpoint_auth_method = os.getenv("HELLO_MCP_TOKEN_ENDPOINT_AUTH_METHOD", "").strip() or None
    redirect_path = os.getenv("HELLO_MCP_REDIRECT_PATH", "").strip() or None
    audience = os.getenv("HELLO_MCP_AUDIENCE", "").strip() or None
    algorithm = os.getenv("HELLO_MCP_ALGORITHM", "").strip() or None
    strict = _env_bool("HELLO_MCP_OIDC_STRICT", False)
    timeout_seconds = _env_int("HELLO_MCP_OIDC_TIMEOUT_SECONDS")

    return OIDCProxy(
        config_url=_required_env("HELLO_MCP_OIDC_CONFIG_URL"),
        client_id=_required_env("HELLO_MCP_UPSTREAM_CLIENT_ID"),
        client_secret=_required_env("HELLO_MCP_UPSTREAM_CLIENT_SECRET"),
        base_url=base_url,
        strict=strict,
        timeout_seconds=timeout_seconds,
        audience=audience,
        algorithm=algorithm,
        required_scopes=required_scopes,
        redirect_path=redirect_path,
        allowed_client_redirect_uris=allowed_redirect_uris,
        token_endpoint_auth_method=token_endpoint_auth_method,
        extra_authorize_params=_json_object_env("HELLO_MCP_EXTRA_AUTHORIZE_PARAMS"),
        extra_token_params=_json_object_env("HELLO_MCP_EXTRA_TOKEN_PARAMS"),
        require_authorization_consent=_env_bool("HELLO_MCP_REQUIRE_AUTHORIZATION_CONSENT", True),
        enable_cimd=_env_bool("HELLO_MCP_ENABLE_CIMD", True),
    )


def build_azure_auth_provider(default_host: str, default_port: int) -> AzureProvider:
    base_url = os.getenv("HELLO_MCP_BASE_URL", "").strip() or f"http://{default_host}:{default_port}"
    tenant_id = _required_env("HELLO_MCP_AZURE_TENANT_ID")
    client_id = _required_env("HELLO_MCP_UPSTREAM_CLIENT_ID")
    client_secret = _required_env("HELLO_MCP_UPSTREAM_CLIENT_SECRET")

    required_scopes = _split_csv(os.getenv("HELLO_MCP_REQUIRED_SCOPES")) or ["hello.read"]
    identifier_uri = os.getenv("HELLO_MCP_AZURE_IDENTIFIER_URI", "").strip() or None
    additional_authorize_scopes = _split_csv(os.getenv("HELLO_MCP_AZURE_ADDITIONAL_AUTHORIZE_SCOPES"))
    allowed_redirect_uris = _split_csv(os.getenv("HELLO_MCP_ALLOWED_CLIENT_REDIRECT_URIS"))
    redirect_path = os.getenv("HELLO_MCP_REDIRECT_PATH", "").strip() or None
    base_authority = os.getenv("HELLO_MCP_AZURE_BASE_AUTHORITY", "").strip() or "login.microsoftonline.com"

    return AzureProvider(
        client_id=client_id,
        client_secret=client_secret,
        tenant_id=tenant_id,
        required_scopes=required_scopes,
        base_url=base_url,
        identifier_uri=identifier_uri,
        redirect_path=redirect_path,
        additional_authorize_scopes=additional_authorize_scopes,
        allowed_client_redirect_uris=allowed_redirect_uris,
        require_authorization_consent=_env_bool("HELLO_MCP_REQUIRE_AUTHORIZATION_CONSENT", True),
        base_authority=base_authority,
    )


def build_auth_provider(default_host: str, default_port: int):
    provider_type = _normalize_provider_type(os.getenv("HELLO_MCP_PROVIDER_TYPE"))
    if provider_type == "azure":
        return build_azure_auth_provider(default_host, default_port)
    return build_oidc_auth_provider(default_host, default_port)


DEFAULT_HOST = os.getenv("HELLO_MCP_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.getenv("HELLO_MCP_PORT", "8780"))


async def async_hello_auth_check(ctx: AuthContext) -> bool:
    """Require a token containing `hello:read` scope."""
    await asyncio.sleep(0)

    token = ctx.token
    if token is None:
        raise AuthorizationError("Authentication required")

    required_scope = (os.getenv("HELLO_MCP_TOOL_REQUIRED_SCOPE", "hello:read") or "hello:read").strip()
    accepted_scopes = {required_scope}
    # Azure custom scopes frequently use dot separators (hello.read)
    if ":" in required_scope:
        accepted_scopes.add(required_scope.replace(":", "."))
    if "." in required_scope:
        accepted_scopes.add(required_scope.replace(".", ":"))

    if not any(scope in set(token.scopes) for scope in accepted_scopes):
        raise AuthorizationError(f"Missing required scope: {required_scope}")

    return True


def hello_world() -> str:
    """Returns Hello World when authorization succeeds."""
    return "Hello World"


def build_mcp(host: str, port: int) -> FastMCP:
    mcp_instance = FastMCP("Hello World Authorized MCP", auth=build_auth_provider(host, port))
    mcp_instance.tool(auth=async_hello_auth_check)(hello_world)
    return mcp_instance


def run_server() -> None:
    parser = argparse.ArgumentParser(description="Run the authorized Hello World FastMCP server.")
    parser.add_argument(
        "--transport",
        default=os.getenv("HELLO_MCP_TRANSPORT", "streamable-http"),
        help="FastMCP transport (default: streamable-http)",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help="Host to bind",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="Port to bind",
    )
    args = parser.parse_args()
    try:
        mcp = build_mcp(args.host, args.port)
    except ValueError as exc:
        raise SystemExit(f"Configuration error: {exc}") from exc

    # Keep compatibility across FastMCP versions with different run() signatures.
    try:
        mcp.run(transport=args.transport, host=args.host, port=args.port)
        return
    except TypeError:
        pass
    try:
        mcp.run(host=args.host, port=args.port)
        return
    except TypeError:
        pass
    mcp.run()


if __name__ == "__main__":
    run_server()
