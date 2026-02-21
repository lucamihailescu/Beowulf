#!/usr/bin/env python3
"""
Integration test for per-application API keys on runtime endpoints.

Covers:
1) Key is issued when creating an application
2) Runtime endpoints accept bound key for matching app
3) Runtime endpoints deny key when app binding mismatches
4) Revoked key no longer authenticates
"""

import os
import time
import requests

from beowulf_sdk_loader import Beowulf, BeowulfAPIError

BASE_URL = os.getenv("CEDAR_BASE_URL", "http://localhost:8080")

SESSION = requests.Session()
if os.getenv("CEDAR_BEARER_TOKEN"):
    SESSION.headers["Authorization"] = f"Bearer {os.getenv('CEDAR_BEARER_TOKEN')}"
if os.getenv("CEDAR_API_KEY"):
    SESSION.headers["X-API-Key"] = os.getenv("CEDAR_API_KEY")


def get_namespace_id() -> int:
    ns = SESSION.get(f"{BASE_URL}/v1/namespaces/", timeout=10)
    if ns.ok and ns.json():
        return int(ns.json()[0]["id"])

    apps = SESSION.get(f"{BASE_URL}/v1/apps/", timeout=10)
    apps.raise_for_status()
    data = apps.json()
    if not data:
        raise RuntimeError("No namespaces or apps found; create namespace first.")
    return int(data[0]["namespace_id"])


def create_app_with_key(namespace_id: int) -> dict:
    payload = {
        "name": f"runtime-app-key-{int(time.time())}",
        "namespace_id": namespace_id,
        "description": "runtime api key integration test",
        "approval_required": False,
    }
    resp = SESSION.post(f"{BASE_URL}/v1/apps/", json=payload, timeout=15)
    resp.raise_for_status()
    return resp.json()


def _build_runtime_client(raw_key: str, application_id: int) -> Beowulf:
    return Beowulf(
        token=raw_key,
        pdp=BASE_URL,
        application_id=application_id,
        timeout=10.0,
    )


def authorize_with_key(raw_key: str, application_id: int) -> int:
    client = _build_runtime_client(raw_key, application_id)
    try:
        _ = client.check_sync(
            user="alice",
            action="view",
            resource={"type": "Document", "id": "doc-1"},
        )
        return 200
    except BeowulfAPIError as exc:
        return int(exc.status_code or 0)
    finally:
        client.close()


def entitlements_with_key(raw_key: str, application_id: int) -> int:
    client = _build_runtime_client(raw_key, application_id)
    try:
        _ = client.get_entitlements_sync("alice")
        return 200
    except BeowulfAPIError as exc:
        return int(exc.status_code or 0)
    finally:
        client.close()


def run_cases() -> None:
    namespace_id = get_namespace_id()
    app = create_app_with_key(namespace_id)
    app_id = int(app["id"])
    app_key = app.get("api_key", "")
    app_key_id = int(app.get("api_key_id", 0))

    cases = []

    # Case 1: create app response includes initial runtime key.
    cases.append(("initial key issued on create", bool(app_key and app_key_id > 0), True))

    # Case 2: authorize for matching app should authenticate (200) even if decision is deny.
    status = authorize_with_key(app_key, app_id)
    cases.append(("authorize allows key auth on matching app", status == 200, True))

    # Case 3: authorize mismatched app must be denied by binding.
    status = authorize_with_key(app_key, app_id + 99999)
    cases.append(("authorize denies key on app mismatch", status == 403, True))

    # Case 4: entitlements mismatched app must be denied by binding.
    status = entitlements_with_key(app_key, app_id + 99999)
    cases.append(("entitlements denies key on app mismatch", status == 403, True))

    # Case 5: revoke key then ensure runtime auth fails.
    revoke = SESSION.post(f"{BASE_URL}/v1/apps/{app_id}/api-keys/{app_key_id}/revoke", timeout=10)
    cases.append(("revoke endpoint succeeds", revoke.status_code == 204, True))
    status = authorize_with_key(app_key, app_id)
    cases.append(("revoked key is rejected", status == 401, True))

    failures = []
    for name, passed, expected in cases:
        status = "PASS" if passed == expected else "FAIL"
        print(f"[{status}] {name}")
        if passed != expected:
            failures.append(name)

    if failures:
        raise AssertionError("Application API key integration failures:\n- " + "\n- ".join(failures))


def main() -> None:
    print("=== Application API Keys Integration Test ===")
    try:
        run_cases()
    except requests.exceptions.HTTPError as exc:
        resp = exc.response
        if resp is not None and resp.status_code in (401, 403):
            raise RuntimeError(
                "Authentication failed for admin API calls. "
                "Set CEDAR_BEARER_TOKEN (or run AUTH_MODE=none) to create/revoke application keys."
            ) from exc
        raise
    print("All application API key cases passed.")


if __name__ == "__main__":
    main()

