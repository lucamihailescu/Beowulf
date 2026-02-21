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

from beowulf_sdk_loader import Beowulf, BeowulfAPIError


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


def _build_client(base_url: str, app_api_key: str, app_id: int, timeout: float) -> Beowulf:
    headers: dict[str, str] = {}
    if os.getenv("CEDAR_BEARER_TOKEN"):
        headers["Authorization"] = f"Bearer {os.getenv('CEDAR_BEARER_TOKEN')}"
    return Beowulf(
        token=app_api_key,
        pdp=base_url,
        application_id=app_id,
        timeout=timeout,
        headers=headers,
    )


def _authorize(client: Beowulf, payload: dict) -> tuple[int, dict]:
    try:
        decision = client.authorize_sync(
            user=payload["principal"],
            action=payload["action"],
            resource=payload["resource"],
            context=payload.get("context", {}),
            application_id=int(payload["application_id"]),
        )
        body = {
            "decision": decision.decision,
            "reasons": decision.reasons,
            "errors": decision.errors,
        }
        return 200, body
    except BeowulfAPIError as exc:
        status = int(exc.status_code or 0)
        parsed: dict
        if exc.response_body:
            try:
                raw = json.loads(exc.response_body)
                parsed = raw if isinstance(raw, dict) else {"raw": exc.response_body}
            except Exception:
                parsed = {"raw": exc.response_body}
        else:
            parsed = {"error": str(exc)}
        return status, parsed


def _print_json(data: dict) -> None:
    print(json.dumps(data, indent=2, sort_keys=True))


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

    client = _build_client(args.base_url, app_api_key, app_id, args.timeout)
    status_code, body = _authorize(client, payload)
    client.close()
    decision = str(body.get("decision", "")).lower()
    reasons = body.get("reasons", [])
    errors = body.get("errors", [])
    expected = args.expect
    http_ok = status_code == 200
    expectation_ok = expected is None or decision == expected
    ok = http_ok and expectation_ok
    exit_code = 0 if ok else (2 if http_ok else 1)

    result = {
        "mode": "single",
        "ok": ok,
        "status_code": status_code,
        "decision": decision,
        "expected": expected,
        "reasons": reasons,
        "errors": errors,
        "response": body,
    }
    if args.show_payload:
        result["payload"] = payload

    if args.output == "json":
        _print_json(result)
        return exit_code

    if not http_ok:
        print(f"[ERROR] HTTP {status_code}: {body}")
        return 1

    print(f"[RESULT] decision={decision}")
    if reasons:
        print(f"[REASONS] {reasons}")
    if errors:
        print(f"[EVAL_ERRORS] {errors}")
    if args.show_payload:
        print("[PAYLOAD]", json.dumps(payload, indent=2))

    if not expectation_ok:
        print(f"[FAIL] expected decision={expected}, got {decision}")
        return 2
    return 0


def _run_cases(args: argparse.Namespace) -> int:
    app_api_key = _require(args.api_key, "--api-key / CEDAR_APP_API_KEY")
    cases = _load_cases(args.cases_file)
    failures: list[str] = []
    results: list[dict] = []
    default_app_id = int(args.app_id) if args.app_id else None
    client = _build_client(args.base_url, app_api_key, default_app_id or 1, args.timeout)

    for idx, case in enumerate(cases, 1):
        if not isinstance(case, dict):
            failures.append(f"case[{idx}] is not an object")
            results.append(
                {
                    "index": idx,
                    "name": f"case-{idx}",
                    "ok": False,
                    "error": "case is not an object",
                }
            )
            continue

        name = str(case.get("name", f"case-{idx}"))
        payload = case.get("payload")
        expected = case.get("expected")
        if not isinstance(payload, dict):
            failures.append(f"{name}: payload missing/invalid")
            results.append(
                {
                    "index": idx,
                    "name": name,
                    "ok": False,
                    "error": "payload missing/invalid",
                    "expected": expected,
                }
            )
            continue
        if "application_id" not in payload:
            if default_app_id is None:
                failures.append(f"{name}: missing application_id and no --app-id provided")
                results.append(
                    {
                        "index": idx,
                        "name": name,
                        "ok": False,
                        "error": "missing application_id and no --app-id provided",
                        "expected": expected,
                    }
                )
                continue
            payload["application_id"] = default_app_id

        status_code, body = _authorize(client, payload)
        decision = str(body.get("decision", "")).lower()
        expected_norm = str(expected).lower() if expected is not None else None
        http_ok = status_code == 200
        expectation_ok = expected_norm is None or decision == expected_norm
        case_ok = http_ok and expectation_ok

        results.append(
            {
                "index": idx,
                "name": name,
                "ok": case_ok,
                "status_code": status_code,
                "decision": decision,
                "expected": expected_norm,
                "response": body,
            }
        )

        if status_code != 200:
            failures.append(f"{name}: HTTP {status_code}")
            if args.output == "text":
                print(f"[FAIL] {name}: HTTP {status_code} -> {body}")
            continue

        if not expectation_ok:
            failures.append(f"{name}: expected={expected} got={decision}")
            if args.output == "text":
                print(f"[FAIL] {name}: expected={expected} got={decision}")
            continue

        if args.output == "text":
            print(f"[PASS] {name}: decision={decision}")

    summary = {
        "total": len(cases),
        "passed": len(cases) - len(failures),
        "failed": len(failures),
    }

    if args.output == "json":
        _print_json(
            {
                "mode": "batch",
                "ok": len(failures) == 0,
                "summary": summary,
                "results": results,
                "failures": failures,
            }
        )
        client.close()
        return 0 if not failures else 2

    if failures:
        print("\nBatch failures:")
        for f in failures:
            print(f"- {f}")
        client.close()
        return 2
    client.close()
    print("\nAll batch cases passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Simulate runtime authorization decisions with application API key auth."
    )
    parser.add_argument("--base-url", default=os.getenv("CEDAR_BASE_URL", "http://localhost:8080"))
    parser.add_argument("--api-key", default=os.getenv("CEDAR_APP_API_KEY"))
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--output", choices=["text", "json"], default="text")
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
        if args.output == "json":
            _print_json({"ok": False, "error": str(exc), "status_code": 1})
        else:
            print(f"[ERROR] {exc}")
        return 1
    except requests.RequestException as exc:
        if args.output == "json":
            _print_json({"ok": False, "error": f"request failed: {exc}", "status_code": 1})
        else:
            print(f"[ERROR] request failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

