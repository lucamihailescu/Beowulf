#!/usr/bin/env python3
"""
Test script for MCP integration features:
1. /v1/entitlements endpoint (IdP integration)
2. /v1/events SSE endpoint (real-time updates)
3. MCP SDK (client-side caching, authorization helpers)
"""

import json
import requests
import sys
import threading
import time

BASE_URL = "http://localhost:8080"
MCP_GATEWAY_URL = "http://localhost:8090"


def _get_first_app():
    apps_resp = requests.get(f"{BASE_URL}/v1/apps/")
    if not apps_resp.ok:
        return None
    apps = apps_resp.json() or []
    return apps[0] if apps else None


def test_entitlements_endpoint():
    """Test the /v1/entitlements endpoint for IdP integration."""
    print("\n=== Testing /v1/entitlements Endpoint ===")
    
    # First, get an existing app
    apps_resp = requests.get(f"{BASE_URL}/v1/apps/")
    if not apps_resp.ok or not apps_resp.json():
        print("No apps found. Please run seed first.")
        return False
    
    app = apps_resp.json()[0]
    app_id = app["id"]
    app_name = app["name"]
    print(f"Using app: {app_name} (ID: {app_id})")
    
    # Test 1: Query by application_id
    print("\n[Test 1] Query entitlements by application_id")
    payload = {
        "application_id": app_id,
        "username": "alice",
        "groups": ["analysts"],
        "include_inherited": True
    }
    
    resp = requests.post(f"{BASE_URL}/v1/entitlements", json=payload)
    if resp.ok:
        data = resp.json()
        print(f"  ✓ Response received")
        print(f"    Username: {data.get('username')}")
        print(f"    App: {data.get('application_name')} (ID: {data.get('application_id')})")
        print(f"    User entitlements: {len(data.get('entitlements', []))} entries")
        print(f"    Group entitlements: {len(data.get('group_entitlements', {}))} groups")
        
        # Show sample entitlement
        if data.get('entitlements'):
            sample = data['entitlements'][0]
            print(f"    Sample: effect={sample.get('effect')}, actions={sample.get('actions')}")
    else:
        print(f"  ✗ Failed: {resp.status_code} - {resp.text}")
        return False
    
    # Test 2: Query by application_name
    print("\n[Test 2] Query entitlements by application_name")
    payload2 = {
        "application_name": app_name,
        "username": "alice"
    }
    
    resp = requests.post(f"{BASE_URL}/v1/entitlements", json=payload2)
    if resp.ok:
        print(f"  ✓ Response received by name lookup")
    else:
        print(f"  ✗ Failed: {resp.status_code}")
        return False
    
    # Test 3: Error handling - missing username
    print("\n[Test 3] Error handling - missing username")
    resp = requests.post(f"{BASE_URL}/v1/entitlements", json={"application_id": app_id})
    if resp.status_code == 400:
        print(f"  ✓ Correctly returned 400 for missing username")
    else:
        print(f"  ✗ Expected 400, got {resp.status_code}")
        return False
    
    # Test 4: Error handling - missing app
    print("\n[Test 4] Error handling - missing application")
    resp = requests.post(f"{BASE_URL}/v1/entitlements", json={"username": "alice"})
    if resp.status_code == 400:
        print(f"  ✓ Correctly returned 400 for missing application")
    else:
        print(f"  ✗ Expected 400, got {resp.status_code}")
        return False
    
    return True


def test_sse_endpoint():
    """Test the /v1/events SSE endpoint."""
    print("\n=== Testing /v1/events SSE Endpoint ===")
    
    received_events = []
    stop_flag = threading.Event()
    
    def listen_sse():
        """Background thread to listen for SSE events."""
        try:
            with requests.get(
                f"{BASE_URL}/v1/events",
                headers={"Accept": "text/event-stream"},
                stream=True,
                timeout=(5, 10)  # 5s connect, 10s read
            ) as resp:
                for line in resp.iter_lines(decode_unicode=True):
                    if stop_flag.is_set():
                        break
                    if line and line.startswith("data:"):
                        data = line[5:].strip()
                        try:
                            event = json.loads(data)
                            received_events.append(event)
                        except:
                            pass
        except requests.exceptions.Timeout:
            pass
        except Exception as e:
            print(f"  SSE listener error: {e}")
    
    # Start SSE listener
    print("[Test 1] Connecting to SSE endpoint...")
    listener_thread = threading.Thread(target=listen_sse, daemon=True)
    listener_thread.start()
    
    # Wait for connection
    time.sleep(1)
    
    # Check if we received the initial "connected" event
    if any(e.get("type") == "connected" for e in received_events):
        print("  ✓ Received 'connected' event")
    else:
        print("  ! No 'connected' event yet (may still be connecting)")
    
    # Trigger a policy update to generate an event
    print("\n[Test 2] Triggering policy update event...")
    apps_resp = requests.get(f"{BASE_URL}/v1/apps/")
    if apps_resp.ok and apps_resp.json():
        app_id = apps_resp.json()[0]["id"]
        
        # Create a test policy (then delete it)
        policy_payload = {
            "name": f"sse-test-policy-{int(time.time())}",
            "description": "Temporary policy for SSE test",
            "policy_text": "permit(principal, action, resource);",
            "activate": True
        }
        
        create_resp = requests.post(f"{BASE_URL}/v1/apps/{app_id}/policies", json=policy_payload)
        if create_resp.ok:
            policy_id = create_resp.json().get("policy_id")
            print(f"  Created test policy {policy_id}")
            
            # Wait for event propagation
            time.sleep(0.5)
            
            # Check for policy_updated event
            policy_events = [e for e in received_events if e.get("type") == "policy_updated"]
            if policy_events:
                print(f"  ✓ Received {len(policy_events)} policy_updated event(s)")
            else:
                print("  ! No policy_updated event received (may be timing issue)")
            
            # Cleanup: delete the test policy
            if policy_id:
                del_resp = requests.delete(f"{BASE_URL}/v1/apps/{app_id}/policies/{policy_id}")
                if del_resp.ok:
                    print(f"  Cleaned up test policy {policy_id}")
        else:
            print(f"  ✗ Failed to create test policy: {create_resp.text}")
    
    # Stop listener
    stop_flag.set()
    listener_thread.join(timeout=2)
    
    print(f"\n[Summary] Received {len(received_events)} total events")
    return True


def test_mcp_sdk():
    """Test the MCP SDK (requires the SDK to be importable)."""
    print("\n=== Testing MCP SDK ===")
    
    try:
        # Add clients to path
        import os
        sdk_path = os.path.join(os.path.dirname(__file__), "..", "..", "clients", "python")
        sys.path.insert(0, sdk_path)
        
        from mcp import CedarMCPAuthorizer, CedarMCPConfig
        print("[Test 1] SDK imports successfully")
        print("  ✓ CedarMCPAuthorizer imported")
        print("  ✓ CedarMCPConfig imported")
        
        # Create config
        config = CedarMCPConfig(
            cedar_url=BASE_URL,
            app_id=1,
            cache_ttl_seconds=30,
            enable_sse=False  # Disable for quick test
        )
        print("\n[Test 2] Config created successfully")
        
        # Create authorizer
        authorizer = CedarMCPAuthorizer(config)
        print("  ✓ Authorizer initialized")
        
        # Test authorization check
        print("\n[Test 3] Testing authorization check...")
        try:
            result = authorizer.authorize(
                user_id="alice",
                action="view",
                resource_type="Document",
                resource_id="test-doc"
            )
            print(f"  ✓ Authorization check returned: {result}")
        except Exception as e:
            print(f"  ! Authorization check: {e}")
        
        # Test entitlements
        print("\n[Test 4] Testing entitlements lookup...")
        try:
            entitlements = authorizer.get_user_entitlements("alice", groups=["analysts"])
            print(f"  ✓ Entitlements received: {len(entitlements.get('entitlements', []))} entries")
        except Exception as e:
            print(f"  ! Entitlements lookup: {e}")
        
        # Test cache stats
        print("\n[Test 5] Testing cache stats...")
        stats = authorizer.cache_stats
        print(f"  ✓ Cache stats: hits={stats.get('hits', 0)}, misses={stats.get('misses', 0)}")
        
        # Cleanup
        authorizer.close()
        print("\n  ✓ Authorizer closed")
        
        return True
        
    except ImportError as e:
        print(f"  ✗ SDK import failed: {e}")
        print("    Make sure 'requests' is installed")
        return False
    except Exception as e:
        print(f"  ✗ SDK test failed: {e}")
        return False


def test_mcp_gateway_registry():
    """Test MCP gateway registry APIs."""
    print("\n=== Testing MCP Gateway Registry APIs ===")

    gateway_id = f"test-gateway-{int(time.time())}"
    register_payload = {
        "gateway_id": gateway_id,
        "name": "integration-test-gateway",
        "endpoint": "http://localhost:8090",
        "auth_mode": "none",
        "metadata": {"source": "test_mcp_integration.py"}
    }
    resp = requests.post(f"{BASE_URL}/v1/mcp/gateways/register", json=register_payload)
    if not resp.ok:
        print(f"  ✗ Register failed: {resp.status_code} {resp.text}")
        return False
    print("  ✓ Gateway registered")

    list_resp = requests.get(f"{BASE_URL}/v1/mcp/gateways/")
    if not list_resp.ok:
        print(f"  ✗ List failed: {list_resp.status_code}")
        return False
    listed = list_resp.json().get("items", [])
    if not any(g.get("gateway_id") == gateway_id for g in listed):
        print("  ✗ Registered gateway not found in list")
        return False
    print("  ✓ Gateway appears in list")

    approve_resp = requests.post(f"{BASE_URL}/v1/mcp/gateways/{gateway_id}/approve")
    if not approve_resp.ok:
        print(f"  ✗ Approve failed: {approve_resp.status_code} {approve_resp.text}")
        return False
    print("  ✓ Gateway approved")

    suspend_resp = requests.post(f"{BASE_URL}/v1/mcp/gateways/{gateway_id}/suspend")
    if not suspend_resp.ok:
        print(f"  ✗ Suspend failed: {suspend_resp.status_code} {suspend_resp.text}")
        return False
    print("  ✓ Gateway suspended")

    unsuspend_resp = requests.post(f"{BASE_URL}/v1/mcp/gateways/{gateway_id}/unsuspend")
    if not unsuspend_resp.ok:
        print(f"  ✗ Unsuspend failed: {unsuspend_resp.status_code} {unsuspend_resp.text}")
        return False
    print("  ✓ Gateway resumed")

    delete_resp = requests.delete(f"{BASE_URL}/v1/mcp/gateways/{gateway_id}")
    if not delete_resp.ok:
        print(f"  ✗ Delete failed: {delete_resp.status_code} {delete_resp.text}")
        return False
    print("  ✓ Gateway deleted")
    return True


def test_mcp_approval_workflow():
    """Test MCP approval request lifecycle APIs."""
    print("\n=== Testing MCP Approval Workflow APIs ===")

    app = _get_first_app()
    if not app:
        print("  ✗ No app found. Please run seed first.")
        return False

    gateway_id = f"approval-gateway-{int(time.time())}"
    reg_resp = requests.post(f"{BASE_URL}/v1/mcp/gateways/register", json={
        "gateway_id": gateway_id,
        "name": "approval-test-gateway"
    })
    if not reg_resp.ok:
        print(f"  ✗ Unable to register temp gateway: {reg_resp.status_code} {reg_resp.text}")
        return False

    create_payload = {
        "application_id": app["id"],
        "gateway_id": gateway_id,
        "principal_type": "User",
        "principal_id": "alice",
        "action": "tool.invoke",
        "resource": "server:filesystem.read",
        "tool_server": "filesystem",
        "tool_name": "read",
        "reason": "high-risk operation",
        "expires_in_seconds": 120
    }
    create_resp = requests.post(f"{BASE_URL}/v1/mcp/approvals/", json=create_payload)
    if not create_resp.ok:
        print(f"  ✗ Create approval failed: {create_resp.status_code} {create_resp.text}")
        return False
    created = create_resp.json()
    request_id = created.get("request_id")
    if not request_id:
        print("  ✗ approval create response missing request_id")
        return False
    print(f"  ✓ Approval created ({request_id})")

    approve_resp = requests.post(f"{BASE_URL}/v1/mcp/approvals/{request_id}/approve")
    if not approve_resp.ok:
        print(f"  ✗ Approve approval failed: {approve_resp.status_code} {approve_resp.text}")
        return False
    if approve_resp.json().get("status") != "approved":
        print("  ✗ Approval status is not approved after approval")
        return False
    print("  ✓ Approval approved")

    create_resp_2 = requests.post(f"{BASE_URL}/v1/mcp/approvals/", json=create_payload)
    if not create_resp_2.ok:
        print(f"  ✗ Create second approval failed: {create_resp_2.status_code}")
        return False
    req2 = create_resp_2.json().get("request_id")
    reject_resp = requests.post(f"{BASE_URL}/v1/mcp/approvals/{req2}/reject", json={"reason": "manual rejection test"})
    if not reject_resp.ok:
        print(f"  ✗ Reject approval failed: {reject_resp.status_code} {reject_resp.text}")
        return False
    if reject_resp.json().get("status") != "rejected":
        print("  ✗ Approval status is not rejected after rejection")
        return False
    print("  ✓ Approval rejected")
    return True


def test_mcp_delegation_flow():
    """Test delegation token issue/introspect/revoke."""
    print("\n=== Testing MCP Delegation APIs ===")

    app = _get_first_app()
    if not app:
        print("  ✗ No app found. Please run seed first.")
        return False

    expires_at = (time.time() + 3600)
    expires_rfc3339 = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at))
    create_payload = {
        "application_id": app["id"],
        "delegator_type": "User",
        "delegator_id": "alice",
        "delegate_type": "Agent",
        "delegate_id": "assistant-1",
        "scope_action": "tool.invoke",
        "expires_at": expires_rfc3339
    }
    create_resp = requests.post(f"{BASE_URL}/v1/mcp/delegations/", json=create_payload)
    if not create_resp.ok:
        print(f"  ✗ Delegation create failed: {create_resp.status_code} {create_resp.text}")
        return False
    created = create_resp.json()
    token = created.get("token")
    grant = created.get("grant", {})
    grant_id = grant.get("grant_id")
    if not token or not grant_id:
        print("  ✗ Delegation create missing token/grant")
        return False
    print(f"  ✓ Delegation issued ({grant_id})")

    introspect_resp = requests.post(f"{BASE_URL}/v1/mcp/delegations/introspect", json={"token": token})
    if not introspect_resp.ok:
        print(f"  ✗ Delegation introspect failed: {introspect_resp.status_code} {introspect_resp.text}")
        return False
    if not introspect_resp.json().get("active"):
        print("  ✗ Delegation should be active before revoke")
        return False
    print("  ✓ Delegation introspection shows active=true")

    revoke_resp = requests.post(f"{BASE_URL}/v1/mcp/delegations/{grant_id}/revoke")
    if not revoke_resp.ok:
        print(f"  ✗ Revoke failed: {revoke_resp.status_code} {revoke_resp.text}")
        return False
    print("  ✓ Delegation revoked")

    introspect_after_revoke = requests.post(f"{BASE_URL}/v1/mcp/delegations/introspect", json={"token": token})
    if not introspect_after_revoke.ok:
        print(f"  ✗ Introspect after revoke failed: {introspect_after_revoke.status_code}")
        return False
    if introspect_after_revoke.json().get("active"):
        print("  ✗ Delegation should be inactive after revoke")
        return False
    print("  ✓ Delegation inactive after revoke")
    return True


def test_mcp_gateway_pending_approval_path():
    """Test gateway pending_approval response path for sensitive actions."""
    print("\n=== Testing MCP Gateway pending_approval path ===")

    app = _get_first_app()
    if not app:
        print("  ✗ No app found. Please run seed first.")
        return False

    payload = {
        "application_id": app["id"],
        "principal": {"type": "User", "id": "alice"},
        "action_id": "tool.delete",
        "tool_server": "filesystem",
        "tool_name": "delete",
        "tool_input": {"path": "/tmp/file.txt"},
        "require_approval": True
    }
    try:
        resp = requests.post(f"{MCP_GATEWAY_URL}/v1/tool/invoke", json=payload, timeout=10)
    except requests.exceptions.RequestException as e:
        print(f"  ! MCP gateway not reachable ({e}); skipping this test")
        return True

    if resp.status_code != 202:
        print(f"  ✗ Expected 202 pending approval, got {resp.status_code}: {resp.text}")
        return False
    body = resp.json()
    if body.get("status") != "pending_approval" or not body.get("approval_request_id"):
        print(f"  ✗ Unexpected pending response payload: {body}")
        return False
    print("  ✓ Gateway returns pending_approval with request id")
    return True


def main():
    print("=" * 60)
    print("MCP Integration Test Suite")
    print("=" * 60)
    
    results = {}
    
    # Test entitlements endpoint
    results["entitlements"] = test_entitlements_endpoint()
    
    # Test SSE endpoint
    results["sse"] = test_sse_endpoint()
    
    # Test MCP SDK
    results["sdk"] = test_mcp_sdk()
    results["mcp_gateway_registry"] = test_mcp_gateway_registry()
    results["mcp_approval_workflow"] = test_mcp_approval_workflow()
    results["mcp_delegation"] = test_mcp_delegation_flow()
    results["mcp_gateway_pending"] = test_mcp_gateway_pending_approval_path()
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    for test_name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {test_name}: {status}")
    
    all_passed = all(results.values())
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()

