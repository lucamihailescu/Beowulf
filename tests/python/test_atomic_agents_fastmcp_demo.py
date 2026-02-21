#!/usr/bin/env python3
"""
Integration test suite for Atomic Agents + FastMCP + Cedar Python SDK.

Coverage:
1) SDK baseline checks
2) FastMCP async auth-layer deny behavior
3) FastMCP decision parity with SDK
4) Optional live Atomic Agents path
5) Fail-closed SDK behavior
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
from beowulf import Beowulf

from demo_atomic_agent_client import AtomicDecisionHarness  # noqa: E402

BASE_URL = os.getenv("CEDAR_BASE_URL", "http://localhost:8080").rstrip("/")
FASTMCP_DEMO_HOST = os.getenv("FASTMCP_DEMO_HOST", "127.0.0.1")
FASTMCP_DEMO_PORT = int(os.getenv("FASTMCP_DEMO_PORT", "8765"))
FASTMCP_DEMO_URL = os.getenv("FASTMCP_DEMO_URL", f"http://{FASTMCP_DEMO_HOST}:{FASTMCP_DEMO_PORT}/mcp")
AUTO_START_SERVER = os.getenv("FASTMCP_DEMO_AUTO_START", "true").lower() in {"1", "true", "yes"}

SESSION = requests.Session()
if os.getenv("CEDAR_BEARER_TOKEN"):
    SESSION.headers["Authorization"] = f"Bearer {os.getenv('CEDAR_BEARER_TOKEN')}"
if os.getenv("CEDAR_API_KEY"):
    SESSION.headers["X-API-Key"] = os.getenv("CEDAR_API_KEY")


def runtime_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if os.getenv("CEDAR_APP_API_KEY"):
        headers["X-API-Key"] = os.getenv("CEDAR_APP_API_KEY", "")
    if os.getenv("CEDAR_BEARER_TOKEN"):
        headers["Authorization"] = f"Bearer {os.getenv('CEDAR_BEARER_TOKEN')}"
    if os.getenv("CEDAR_API_KEY") and "X-API-Key" not in headers:
        headers["X-API-Key"] = os.getenv("CEDAR_API_KEY", "")
    return headers


def get_app_id() -> int:
    explicit = os.getenv("CEDAR_APP_ID", "").strip()
    if explicit:
        return int(explicit)
    try:
        resp = SESSION.get(f"{BASE_URL}/v1/apps/", timeout=10)
        resp.raise_for_status()
        apps = resp.json() or []
        if apps:
            return int(apps[0]["id"])
    except Exception:
        pass
    return 1


def build_sdk_client(app_id: int) -> Beowulf:
    headers = runtime_headers()
    token = headers.get("X-API-Key")
    extra_headers: dict[str, str] = {}
    if "Authorization" in headers:
        extra_headers["Authorization"] = headers["Authorization"]
    return Beowulf(
        token=token,
        pdp=BASE_URL,
        application_id=app_id,
        timeout=5.0,
        headers=extra_headers,
    )


def sdk_check_decision(client: Beowulf, case: dict[str, Any]) -> bool:
    try:
        return client.check_sync(
            user={"type": case.get("principal_type", "User"), "id": case["user_id"]},
            action=case["action"],
            resource={"type": case["resource_type"], "id": case["resource_id"]},
            context=case.get("context", {}),
    )
    except Exception as exc:
        print(f"Authorization check failed: {exc}")
        # Preserve previous fail-closed behavior for this integration suite.
        return False


def preflight_checks() -> None:
    print("\n=== Preflight checks ===")
    errors: list[str] = []
    warnings: list[str] = []

    headers = runtime_headers()
    if not headers:
        errors.append(
            "Missing Cedar auth headers. Set one of: "
            "CEDAR_APP_API_KEY, CEDAR_API_KEY, or CEDAR_BEARER_TOKEN."
        )

    app_id_raw = os.getenv("CEDAR_APP_ID", "").strip()
    if app_id_raw:
        try:
            app_id = int(app_id_raw)
            if app_id <= 0:
                errors.append("CEDAR_APP_ID must be a positive integer.")
        except ValueError:
            errors.append("CEDAR_APP_ID must be an integer.")

    if "CEDAR_APP_API_KEY" in os.environ and "CEDAR_BEARER_TOKEN" not in os.environ:
        warnings.append(
            "Using CEDAR_APP_API_KEY only; policy bootstrap will be skipped. "
            "Per-app runtime keys are valid for /v1/authorize and /v1/entitlements, "
            "not policy-management write endpoints."
        )

    try:
        health = requests.get(f"{BASE_URL}/health", timeout=5)
        if not health.ok:
            errors.append(f"Backend health check failed: {health.status_code} {health.text[:200]}")
    except Exception as exc:
        errors.append(f"Backend not reachable at {BASE_URL}: {exc}")

    if AUTO_START_SERVER:
        script = Path(__file__).resolve().parent / "demo_fastmcp_server.py"
        if not script.exists():
            errors.append(f"Demo FastMCP server script not found: {script}")
    else:
        try:
            probe = AtomicDecisionHarness(server_url=FASTMCP_DEMO_URL).healthcheck()
            if probe.get("status") != "ok":
                errors.append(
                    "External FastMCP server healthcheck did not return status=ok. "
                    f"URL={FASTMCP_DEMO_URL}"
                )
        except Exception as exc:
            errors.append(
                "FastMCP demo server not reachable and auto-start disabled. "
                f"Set FASTMCP_DEMO_AUTO_START=true or start one at {FASTMCP_DEMO_URL}. "
                f"Error: {exc}"
            )

    if warnings:
        for w in warnings:
            print(f"  ! {w}")
    if errors:
        for e in errors:
            print(f"  ✗ {e}")
        raise RuntimeError("Preflight checks failed.")

    print("  ✓ Preflight checks passed")


def install_demo_policy(app_id: int) -> bool:
    """
    Best effort bootstrap for deterministic allow/deny scenarios.
    """

    policy_text = """
permit (
  principal == User::\"atomic_allow_user\",
  action == Action::\"atomic.demo.approve\",
  resource == Tool::\"atomic:target\"
);
""".strip()
    payload = {
        "name": f"atomic-fastmcp-demo-{int(time.time())}",
        "description": "Atomic Agents + FastMCP demo deterministic policy",
        "policy_text": policy_text,
        "activate": True,
    }
    # Policy bootstrap writes to policy-management endpoints, which require
    # admin/user auth context (for example Bearer token). Runtime app keys are
    # intentionally scoped to /v1/authorize and /v1/entitlements.
    if not os.getenv("CEDAR_BEARER_TOKEN", "").strip():
        print("  ! policy bootstrap skipped: requires CEDAR_BEARER_TOKEN for policy write endpoint")
        return False

    try:
        resp = SESSION.post(f"{BASE_URL}/v1/apps/{app_id}/policies", json=payload, timeout=15)
        if not resp.ok:
            print(f"  ! policy bootstrap skipped: {resp.status_code} {resp.text}")
            return False
        return True
    except Exception as exc:
        print(f"  ! policy bootstrap skipped: {exc}")
        return False


def to_approval_word(sdk_allowed: bool) -> str:
    return "approve" if sdk_allowed else "deny"


def start_demo_server() -> subprocess.Popen[str] | None:
    if not AUTO_START_SERVER:
        return None
    script = Path(__file__).resolve().parent / "demo_fastmcp_server.py"
    env = os.environ.copy()
    cmd = [
        sys.executable,
        str(script),
        "--transport",
        env.get("FASTMCP_DEMO_TRANSPORT", "streamable-http"),
        "--host",
        FASTMCP_DEMO_HOST,
        "--port",
        str(FASTMCP_DEMO_PORT),
    ]
    return subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )


def wait_for_server(harness: AtomicDecisionHarness, timeout_seconds: int = 20) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            res = harness.healthcheck()
            if res.get("status") == "ok":
                return True
        except Exception:
            time.sleep(0.5)
    return False


def test_sdk_baseline(client: Beowulf) -> tuple[dict[str, Any], dict[str, Any], bool]:
    print("\n=== [1] SDK baseline checks ===")
    allow_case = {
        "user_id": "atomic_allow_user",
        "action": "atomic.demo.approve",
        "resource_type": "Tool",
        "resource_id": "atomic:target",
        "principal_type": "User",
        "context": {"request_id": "atomic-sdk-allow"},
    }
    deny_case = {
        "user_id": "atomic_deny_user",
        "action": "atomic.demo.approve",
        "resource_type": "Tool",
        "resource_id": "atomic:target",
        "principal_type": "User",
        "context": {"request_id": "atomic-sdk-deny"},
    }

    allow_decision = sdk_check_decision(client, allow_case)
    deny_decision = sdk_check_decision(client, deny_case)

    print(f"  allow_case -> {to_approval_word(allow_decision)}")
    print(f"  deny_case  -> {to_approval_word(deny_decision)}")
    has_both = allow_decision and (not deny_decision)
    if not has_both:
        print("  ! Did not observe explicit allow+deny split; parity checks still run.")
    else:
        print("  ✓ Observed explicit allow+deny split.")
    return allow_case, deny_case, has_both


def test_fastmcp_auth_layer(harness: AtomicDecisionHarness, allow_case: dict[str, Any]) -> bool:
    print("\n=== [2] FastMCP async auth-layer deny ===")
    try:
        harness.set_auth_mode("deny")
        try:
            harness.deterministic_decide(**allow_case)
            print("  ✗ Expected auth-layer deny, but tool call succeeded")
            return False
        except Exception as exc:
            print(f"  ✓ Auth-layer deny triggered: {exc}")
            return True
    finally:
        try:
            harness.set_auth_mode("allow")
        except Exception:
            pass


def test_fastmcp_parity(harness: AtomicDecisionHarness, client: Beowulf, cases: list[dict[str, Any]]) -> bool:
    print("\n=== [3] FastMCP tool parity with SDK ===")
    ok = True
    for idx, case in enumerate(cases, start=1):
        sdk = sdk_check_decision(client, case)
        mcp = harness.deterministic_decide(**case)
        mcp_decision = str(mcp.get("decision", "")).lower()
        expected = to_approval_word(sdk)
        passed = mcp_decision == expected
        print(f"  case {idx}: expected={expected} actual={mcp_decision} -> {'PASS' if passed else 'FAIL'}")
        if not passed:
            ok = False
    return ok


def test_optional_live_agent(harness: AtomicDecisionHarness, allow_case: dict[str, Any]) -> bool:
    print("\n=== [4] Optional Atomic Agents live path ===")
    live = harness.live_llm_decide(
        instruction=(
            "Create a decision request for user atomic_allow_user, "
            "action atomic.demo.approve, resource Tool atomic:target."
        ),
        fallback_request=allow_case,
    )
    if live.get("status") == "skipped":
        print(f"  ! skipped: {live.get('reason')}")
        return True
    decision = str(live.get("decision", "")).lower()
    if decision not in {"approve", "deny"}:
        print(f"  ✗ invalid live decision payload: {json.dumps(live)}")
        return False
    print(f"  ✓ live path produced decision={decision}")
    return True


def test_fail_closed_behavior() -> bool:
    print("\n=== [5] SDK fail-closed behavior ===")
    headers = runtime_headers()
    token = headers.get("X-API-Key")
    extra_headers: dict[str, str] = {}
    if "Authorization" in headers:
        extra_headers["Authorization"] = headers["Authorization"]
    bad = Beowulf(
        token=token,
        pdp="http://127.0.0.1:9",
        application_id=get_app_id(),
        timeout=0.5,
        headers=extra_headers,
    )
    try:
        allowed = bad.check_sync(
            user={"type": "User", "id": "someone"},
            action="atomic.demo.approve",
            resource={"type": "Tool", "id": "atomic:target"},
            context={"request_id": "fail-closed"},
        )
    except Exception as exc:
        print(f"Authorization check failed: {exc}")
        allowed = False
    if allowed:
        print("  ✗ expected deny on backend error (fail-closed), got allow")
        return False
    print("  ✓ backend error produced deny as expected")
    return True


def main() -> None:
    print("=" * 60)
    print("Atomic Agents + FastMCP Demo Test Suite")
    print("=" * 60)

    preflight_checks()

    app_id = get_app_id()
    print(f"Using app_id={app_id}")
    install_demo_policy(app_id)

    client = build_sdk_client(app_id)
    allow_case, deny_case, _ = test_sdk_baseline(client)

    harness = AtomicDecisionHarness(server_url=FASTMCP_DEMO_URL)
    proc = start_demo_server()
    try:
        if not wait_for_server(harness):
            raise RuntimeError(
                f"FastMCP demo server not reachable at {FASTMCP_DEMO_URL}. "
                f"Set FASTMCP_DEMO_URL or FASTMCP_DEMO_AUTO_START=true."
            )

        results = {
            "fastmcp_auth_layer_deny": test_fastmcp_auth_layer(harness, allow_case),
            "fastmcp_parity": test_fastmcp_parity(harness, client, [allow_case, deny_case]),
            "atomic_agents_optional_live": test_optional_live_agent(harness, allow_case),
            "sdk_fail_closed": test_fail_closed_behavior(),
        }
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        client.close()

    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    for name, passed in results.items():
        print(f"  {name}: {'✓ PASS' if passed else '✗ FAIL'}")

    all_passed = all(results.values())
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
