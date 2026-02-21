#!/usr/bin/env python3
"""
FastMCP demo server for Atomic Agents + Cedar integration tests.

The server exposes a decision tool that maps Cedar authorization decisions to
"approve"/"deny" outputs and uses a FastMCP async auth check as a pre-tool gate.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import AuthorizationError
from fastmcp.server.auth import AuthContext

from beowulf_sdk_loader import Beowulf


def build_auth_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    runtime_key = os.getenv("CEDAR_APP_API_KEY", "").strip()
    bearer = os.getenv("CEDAR_BEARER_TOKEN", "").strip()
    if runtime_key:
        headers["X-API-Key"] = runtime_key
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers


def build_authorizer() -> Beowulf:
    app_id = int(os.getenv("CEDAR_APP_ID", "1"))
    headers = build_auth_headers()
    token = headers.get("X-API-Key")
    extra_headers: dict[str, str] = {}
    if "Authorization" in headers:
        extra_headers["Authorization"] = headers["Authorization"]
    return Beowulf(
        token=token,
        pdp=os.getenv("CEDAR_BASE_URL", "http://localhost:8080"),
        application_id=app_id,
        timeout=5.0,
        headers=extra_headers,
    )


mcp = FastMCP("Cedar FastMCP Demo Server")
authorizer = build_authorizer()
AUTH_GATE_MODE = os.getenv("FASTMCP_DEMO_AUTH_MODE", "allow").strip().lower() or "allow"


async def async_demo_auth_gate(ctx: AuthContext) -> bool:
    """
    Async auth check used by FastMCP before tool execution.

    This intentionally keeps policy simple for deterministic integration tests.
    """

    del ctx
    await asyncio.sleep(0)
    if AUTH_GATE_MODE == "deny":
        raise AuthorizationError("demo async auth gate denied access")
    return True


@mcp.tool
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "service": "demo-fastmcp-server"}


@mcp.tool
def set_demo_auth_mode(mode: str) -> dict[str, str]:
    global AUTH_GATE_MODE
    normalized = (mode or "").strip().lower()
    if normalized not in {"allow", "deny"}:
        raise ValueError("mode must be 'allow' or 'deny'")
    AUTH_GATE_MODE = normalized
    return {"auth_mode": AUTH_GATE_MODE}


@mcp.tool(auth=async_demo_auth_gate)
def decide_action(
    user_id: str,
    action: str,
    resource_type: str,
    resource_id: str,
    principal_type: str = "User",
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        decision = authorizer.authorize_sync(
            user={"type": principal_type, "id": user_id},
            action=action,
            resource={"type": resource_type, "id": resource_id},
            context=context or {},
        )
    except Exception as exc:
        return {
            "decision": "deny",
            "status": "error",
            "reasons": [],
            "errors": [f"authorizer error: {exc}"],
        }

    return {
        "decision": "approve" if decision.allowed else "deny",
        "status": "ok",
        "reasons": decision.reasons,
        "errors": decision.errors,
    }


@mcp.tool
def normalize_tool_target(tool_server: str, tool_name: str) -> dict[str, str]:
    return {
        "action": f"{tool_server}.{tool_name}",
        "resource_type": "Tool",
        "resource_id": f"{tool_server}:{tool_name}",
    }


def run_server() -> None:
    parser = argparse.ArgumentParser(description="Run demo FastMCP server.")
    parser.add_argument(
        "--transport",
        default=os.getenv("FASTMCP_DEMO_TRANSPORT", "streamable-http"),
        help="FastMCP transport (default: streamable-http)",
    )
    parser.add_argument(
        "--host",
        default=os.getenv("FASTMCP_DEMO_HOST", "127.0.0.1"),
        help="Host to bind",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("FASTMCP_DEMO_PORT", "8765")),
        help="Port to bind",
    )
    args = parser.parse_args()

    # FastMCP API changed across versions; keep compatibility fallbacks.
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
