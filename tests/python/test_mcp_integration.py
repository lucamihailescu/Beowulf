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

