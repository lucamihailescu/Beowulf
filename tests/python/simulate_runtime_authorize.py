#!/usr/bin/env python3
"""
Runtime authorization simulator using per-application API keys.

This script calls POST /v1/authorize using:
  - X-API-Key: <application runtime API key>

Use it for quick runtime checks from an agent/tool process without admin credentials.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests


def _require(value: str | None, flag: str) -> str:
    if value and value.strip():
        return value.strip()
    raise ValueError(f"missing required value for {flag}")


def _load_context(context_json: str) -> dict:
    try:
        obj = json.loads(context_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid --context JSON: {exc}") from exc
    if not isinstance(obj, dict):
        raise ValueError("--context must decode to a JSON object")
    return obj


def _load_cases(path: str) -> list[dict]:
    p = Path(path)
    if not p.exists():
        raise ValueError(f"cases file not found: {path}")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in cases file: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError("cases file must contain a JSON array")
    return data


def _authorize(base_url: str, app_api_key: str, payload: dict, timeout: float) -> tuple[int, dict]:
    resp = requests.post(
        f"{base_url.rstrip('/')}/v1/authorize",
        json=payload,
        headers={"X-API-Key": app_api_key},
        timeout=timeout,
    )
    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text}
    return resp.status_code, body


def _run_single(args: argparse.Namespace) -> int:
    app_id = int(_require(args.app_id, "--app-id / CEDAR_APP_ID"))
    app_api_key = _require(args.api_key, "--api-key / CEDAR_APP_API_KEY")
    principal_type = _require(args.principal_type, "--principal-type")
    principal_id = _require(args.principal_id, "--principal-id")
    action_type = _require(args.action_type, "--action-type")
    action_id = _require(args.action_id, "--action-id")
    resource_type = _require(args.resource_type, "--resource-type")
    resource_id = _require(args.resource_id, "--resource-id")
    context = _load_context(args.context)

    payload = {
        "application_id": app_id,
        "principal": {"type": principal_type, "id": principal_id},
        "action": {"type": action_type, "id": action_id},
        "resource": {"type": resource_type, "id": resource_id},
        "context": context,
    }

    status_code, body = _authorize(args.base_url, app_api_key, payload, args.timeout)
    if status_code != 200:
        print(f"[ERROR] HTTP {status_code}: {body}")
        return 1

    decision = str(body.get("decision", "")).lower()
    reasons = body.get("reasons", [])
    errors = body.get("errors", [])
    print(f"[RESULT] decision={decision}")
    if reasons:
        print(f"[REASONS] {reasons}")
    if errors:
        print(f"[EVAL_ERRORS] {errors}")
    if args.show_payload:
        print("[PAYLOAD]", json.dumps(payload, indent=2))

    if args.expect and decision != args.expect:
        print(f"[FAIL] expected decision={args.expect}, got {decision}")
        return 2
    return 0


def _run_cases(args: argparse.Namespace) -> int:
    app_api_key = _require(args.api_key, "--api-key / CEDAR_APP_API_KEY")
    cases = _load_cases(args.cases_file)
    failures: list[str] = []

    for idx, case in enumerate(cases, 1):
        if not isinstance(case, dict):
            failures.append(f"case[{idx}] is not an object")
            continue

        name = str(case.get("name", f"case-{idx}"))
        payload = case.get("payload")
        expected = case.get("expected")
        if not isinstance(payload, dict):
            failures.append(f"{name}: payload missing/invalid")
            continue

        status_code, body = _authorize(args.base_url, app_api_key, payload, args.timeout)
        if status_code != 200:
            print(f"[FAIL] {name}: HTTP {status_code} -> {body}")
            failures.append(f"{name}: HTTP {status_code}")
            continue

        decision = str(body.get("decision", "")).lower()
        if expected is not None and decision != str(expected).lower():
            print(f"[FAIL] {name}: expected={expected} got={decision}")
            failures.append(f"{name}: expected={expected} got={decision}")
            continue

        print(f"[PASS] {name}: decision={decision}")

    if failures:
        print("\nBatch failures:")
        for f in failures:
            print(f"- {f}")
        return 2
    print("\nAll batch cases passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Simulate runtime authorization decisions with application API key auth."
    )
    parser.add_argument("--base-url", default=os.getenv("CEDAR_BASE_URL", "http://localhost:8080"))
    parser.add_argument("--api-key", default=os.getenv("CEDAR_APP_API_KEY"))
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--show-payload", action="store_true")

    # Single-call mode args
    parser.add_argument("--app-id", default=os.getenv("CEDAR_APP_ID"))
    parser.add_argument("--principal-type", default="User")
    parser.add_argument("--principal-id", default="alice")
    parser.add_argument("--action-type", default="Action")
    parser.add_argument("--action-id", default="view")
    parser.add_argument("--resource-type", default="Document")
    parser.add_argument("--resource-id", default="doc-1")
    parser.add_argument("--context", default="{}")
    parser.add_argument("--expect", choices=["allow", "deny"])

    # Batch mode
    parser.add_argument(
        "--cases-file",
        help="Path to JSON array of cases with fields: name, payload, expected(optional)",
    )

    args = parser.parse_args()

    try:
        if args.cases_file:
            return _run_cases(args)
        return _run_single(args)
    except ValueError as exc:
        print(f"[ERROR] {exc}")
        return 1
    except requests.RequestException as exc:
        print(f"[ERROR] request failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

