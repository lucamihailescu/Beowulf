#!/usr/bin/env python3
"""
Integration test for Cedar agent guardrails.

This script:
1) Loads schema, policy files, and entities from examples/agent-guardrails
2) Executes allow/deny checks through /v1/authorize
"""

import json
import os
import time
from pathlib import Path

import requests

from beowulf_sdk_loader import Beowulf, BeowulfAPIError

BASE_URL = os.getenv("CEDAR_BASE_URL", "http://localhost:8080")
ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "examples" / "agent-guardrails" / "schema" / "agent-tools.schema.json"
POLICY_DIR = ROOT / "examples" / "agent-guardrails" / "policies"
ENTITIES_PATH = ROOT / "examples" / "agent-guardrails" / "entities" / "agent-guardrails.entities.json"

SESSION = requests.Session()
if os.getenv("CEDAR_BEARER_TOKEN"):
    SESSION.headers["Authorization"] = f"Bearer {os.getenv('CEDAR_BEARER_TOKEN')}"
if os.getenv("CEDAR_API_KEY"):
    SESSION.headers["X-API-Key"] = os.getenv("CEDAR_API_KEY")


def get_existing_app_id() -> int:
    resp = SESSION.get(f"{BASE_URL}/v1/apps/", timeout=10)
    resp.raise_for_status()
    apps = resp.json()
    if not apps:
        raise RuntimeError("No apps found. Seed or create an app before running this test.")
    return int(apps[0]["id"])


def install_schema(app_id: int) -> None:
    schema_text = SCHEMA_PATH.read_text(encoding="utf-8")
    payload = {"schema_text": schema_text, "activate": True}
    resp = SESSION.post(f"{BASE_URL}/v1/apps/{app_id}/schemas", json=payload, timeout=15)
    resp.raise_for_status()


def assert_schema_metadata(app_id: int) -> None:
    resp = SESSION.get(f"{BASE_URL}/v1/apps/{app_id}/schemas/active/metadata", timeout=10)
    resp.raise_for_status()
    data = resp.json()
    namespaces = {item.get("name") for item in data.get("namespaces", [])}
    if "AgentGuardrails" not in namespaces:
        raise AssertionError(f"active schema metadata missing AgentGuardrails namespace: {namespaces}")
    action_ids = set(data.get("action_ids", []))
    if "email.send" not in action_ids:
        raise AssertionError("active schema metadata missing email.send action")


def assert_policy_validation_warnings(app_id: int) -> None:
    payload = {
        "name": f"validation-check-{int(time.time())}",
        "description": "validation warning probe",
        "policy_text": """
permit (
  principal == AgentGuardrails::Agent::\"agent-mailer\",
  action == AgentGuardrails::Action::\"unknown.action\",
  resource == AgentGuardrails::EmailRecipient::\"foo_at_bar\"
);
""".strip(),
        "activate": False,
    }
    resp = SESSION.post(f"{BASE_URL}/v1/apps/{app_id}/policies", json=payload, timeout=15)
    resp.raise_for_status()
    body = resp.json()
    warnings = body.get("validation", {}).get("warnings", [])
    if not any("unknown.action" in warning for warning in warnings):
        raise AssertionError(f"expected unknown action validation warning, got: {warnings}")


def install_policies(app_id: int) -> None:
    ts = int(time.time())
    for idx, path in enumerate(sorted(POLICY_DIR.glob("*.cedar"))):
        policy_text = path.read_text(encoding="utf-8")
        payload = {
            "name": f"agent-guardrails-{path.stem}-{ts}-{idx}",
            "description": f"Guardrails policy from {path.name}",
            "policy_text": policy_text,
            "activate": True,
        }
        resp = SESSION.post(f"{BASE_URL}/v1/apps/{app_id}/policies", json=payload, timeout=15)
        resp.raise_for_status()


def install_entities(app_id: int) -> None:
    entities = json.loads(ENTITIES_PATH.read_text(encoding="utf-8"))
    for entity in entities:
        payload = {
            "type": entity["uid"]["type"],
            "id": entity["uid"]["id"],
            "attributes": entity.get("attrs", {}),
            "parents": entity.get("parents", []),
        }
        resp = SESSION.post(f"{BASE_URL}/v1/apps/{app_id}/entities", json=payload, timeout=15)
        if resp.status_code != 204:
            raise RuntimeError(f"entity upsert failed for {payload['type']}::{payload['id']}: {resp.text}")


def build_runtime_client(app_id: int) -> Beowulf:
    token = os.getenv("CEDAR_APP_API_KEY") or os.getenv("CEDAR_API_KEY")
    headers: dict[str, str] = {}
    if os.getenv("CEDAR_BEARER_TOKEN"):
        headers["Authorization"] = f"Bearer {os.getenv('CEDAR_BEARER_TOKEN')}"
    return Beowulf(
        token=token,
        pdp=BASE_URL,
        application_id=app_id,
        timeout=10.0,
        headers=headers,
    )


def authorize(client: Beowulf, payload: dict) -> str:
    principal = payload["principal"]
    action = payload["action"]
    resource = payload["resource"]
    context = payload.get("context", {})
    try:
        decision = client.authorize_sync(
            user={"type": principal["type"], "id": principal["id"]},
            action={"type": action["type"], "id": action["id"]},
            resource={"type": resource["type"], "id": resource["id"]},
            context=context,
        )
    except BeowulfAPIError as exc:
        raise RuntimeError(f"authorize failed: HTTP {exc.status_code} {exc.response_body}") from exc
    return decision.decision


def run_cases(client: Beowulf) -> None:
    now = int(time.time())
    cases = [
        {
            "name": "email allow (service agent)",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-mailer"},
                "action": {"type": "AgentGuardrails::Action", "id": "email.send"},
                "resource": {"type": "AgentGuardrails::EmailRecipient", "id": "foo_at_bar"},
                "context": {"agent_id": "agent-mailer", "tenant": "corp", "environment": "prod", "request_id": "req-email-1"},
            },
        },
        {
            "name": "email deny off allowlist recipient",
            "expected": "deny",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-mailer"},
                "action": {"type": "AgentGuardrails::Action", "id": "email.send"},
                "resource": {"type": "AgentGuardrails::EmailRecipient", "id": "bar_at_foo"},
                "context": {"agent_id": "agent-mailer", "tenant": "corp", "environment": "prod", "request_id": "req-email-2"},
            },
        },
        {
            "name": "calendar allow (service agent)",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-calendar"},
                "action": {"type": "AgentGuardrails::Action", "id": "calendar.create"},
                "resource": {"type": "AgentGuardrails::CalendarTarget", "id": "ops-primary"},
                "context": {"agent_id": "agent-calendar", "request_id": "req-cal-1"},
            },
        },
        {
            "name": "slack allow (service agent)",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-slack"},
                "action": {"type": "AgentGuardrails::Action", "id": "slack.post"},
                "resource": {"type": "AgentGuardrails::SlackChannel", "id": "ops-alerts"},
                "context": {"agent_id": "agent-slack", "request_id": "req-slack-1"},
            },
        },
        {
            "name": "http GET allow (service agent)",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-http"},
                "action": {"type": "AgentGuardrails::Action", "id": "http.request.get"},
                "resource": {"type": "AgentGuardrails::HttpEndpoint", "id": "jira-api-get"},
                "context": {"agent_id": "agent-http", "request_id": "req-http-1"},
            },
        },
        {
            "name": "jira read allow",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-jira"},
                "action": {"type": "AgentGuardrails::Action", "id": "jira.read"},
                "resource": {"type": "AgentGuardrails::JiraProject", "id": "CEDAR"},
                "context": {"agent_id": "agent-jira", "request_id": "req-jira-1"},
            },
        },
        {
            "name": "wiki write allow",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-wiki"},
                "action": {"type": "AgentGuardrails::Action", "id": "wiki.write"},
                "resource": {"type": "AgentGuardrails::WikiSpace", "id": "ENG"},
                "context": {"agent_id": "agent-wiki", "request_id": "req-wiki-1"},
            },
        },
        {
            "name": "sharepoint read allow",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::Agent", "id": "agent-sharepoint"},
                "action": {"type": "AgentGuardrails::Action", "id": "sharepoint.read"},
                "resource": {"type": "AgentGuardrails::SharePointSite", "id": "finance-site"},
                "context": {"agent_id": "agent-sharepoint", "request_id": "req-sp-1"},
            },
        },
        {
            "name": "delegated user allow (email)",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::User", "id": "alice"},
                "action": {"type": "AgentGuardrails::Action", "id": "email.send"},
                "resource": {"type": "AgentGuardrails::EmailRecipient", "id": "foo_at_bar"},
                "context": {"agent_id": "agent-mailer", "delegated_user": True, "request_id": "req-del-1"},
            },
        },
        {
            "name": "delegated user deny missing agent_id",
            "expected": "deny",
            "payload": {
                "principal": {"type": "AgentGuardrails::User", "id": "alice"},
                "action": {"type": "AgentGuardrails::Action", "id": "email.send"},
                "resource": {"type": "AgentGuardrails::EmailRecipient", "id": "foo_at_bar"},
                "context": {"delegated_user": True, "request_id": "req-del-2"},
            },
        },
        {
            "name": "break-glass allow with valid fields",
            "expected": "allow",
            "payload": {
                "principal": {"type": "AgentGuardrails::User", "id": "oncall-admin"},
                "action": {"type": "AgentGuardrails::Action", "id": "sharepoint.write"},
                "resource": {"type": "AgentGuardrails::SharePointPath", "id": "finance-site/reports"},
                "context": {
                    "break_glass": True,
                    "ticket_id": "INC-9001",
                    "reason": "incident response",
                    "approved_by": "sec-lead",
                    "request_epoch": now,
                    "expires_at": now + 300,
                    "request_id": "req-bg-1",
                },
            },
        },
        {
            "name": "break-glass deny missing reason",
            "expected": "deny",
            "payload": {
                "principal": {"type": "AgentGuardrails::User", "id": "oncall-admin"},
                "action": {"type": "AgentGuardrails::Action", "id": "sharepoint.write"},
                "resource": {"type": "AgentGuardrails::SharePointPath", "id": "finance-site/reports"},
                "context": {
                    "break_glass": True,
                    "ticket_id": "INC-9002",
                    "approved_by": "sec-lead",
                    "request_epoch": now,
                    "expires_at": now + 300,
                    "request_id": "req-bg-2",
                },
            },
        },
    ]

    failures = []
    for case in cases:
        decision = authorize(client, case["payload"])
        passed = decision == case["expected"]
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {case['name']}: expected={case['expected']} got={decision}")
        if not passed:
            failures.append((case["name"], case["expected"], decision))

    if failures:
        lines = ["Guardrails integration failures:"]
        for name, expected, got in failures:
            lines.append(f"- {name}: expected {expected}, got {got}")
        raise AssertionError("\n".join(lines))


def main() -> None:
    print("=== Agent Guardrails Integration Test ===")
    try:
        app_id = get_existing_app_id()
    except requests.exceptions.HTTPError as exc:
        resp = exc.response
        if resp is not None and resp.status_code in (401, 403):
            raise RuntimeError(
                "Authentication failed when calling /v1/apps/. "
                "Set CEDAR_BEARER_TOKEN for authenticated mode, or run against AUTH_MODE=none."
            ) from exc
        raise
    print(f"Using app_id={app_id}")
    install_schema(app_id)
    assert_schema_metadata(app_id)
    assert_policy_validation_warnings(app_id)
    install_policies(app_id)
    install_entities(app_id)
    client = build_runtime_client(app_id)
    try:
        run_cases(client)
    finally:
        client.close()
    print("All guardrails cases passed.")


if __name__ == "__main__":
    main()
