import requests
import json
import time

BASE_URL = "http://localhost:8080"

def test_authorize_cache(app_id="1", principal_id="alice", action_id="view", resource_id="doc-123"):
    auth_url = f"{BASE_URL}/v1/authorize"
    
    payload = {
        "application_id": int(app_id),
        "principal": {"type": "User", "id": principal_id},
        "action": {"type": "Action", "id": action_id},
        "resource": {"type": "Document", "id": resource_id},
        "context": {}
    }

    print(f"\n--- Testing Cache Invalidation Flow ---")
    
    # Phase 1: Warm up and verify L1
    print("\n[Phase 1] Warming Cache...")
    for i in range(1, 4):
        make_auth_request(auth_url, payload, f"Warm-up {i}")
        time.sleep(0.1)

    # Phase 2: Update Policy to trigger invalidation
    print("\n[Phase 2] Updating Policy (Triggering Invalidation)...")
    create_policy_url = f"{BASE_URL}/v1/apps/{app_id}/policies"
    policy_payload = {
        "name": f"test-policy-{int(time.time())}",
        "description": "Auto-generated test policy",
        "policy_text": f"permit(principal, action, resource); // updated at {time.time()}",
        "activate": True
    }
    
    try:
        resp = requests.post(create_policy_url, json=policy_payload)
        if resp.status_code == 200:
            print(" -> Policy updated successfully. Cache should be invalidated.")
        else:
            print(f" -> Policy update failed: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f" -> Policy update failed with exception: {e}")

    # Phase 3: Verify Cache Miss (DB Hit) then Re-warm (L1)
    print("\n[Phase 3] Verifying Invalidation & Re-warming...")
    for i in range(1, 4):
        make_auth_request(auth_url, payload, f"Post-Update {i}")
        time.sleep(0.1)

def make_auth_request(url, payload, label):
    try:
        start_time = time.time()
        response = requests.post(url, json=payload)
        latency = (time.time() - start_time) * 1000 # ms
        
        if response.status_code == 200:
            cache_source = response.headers.get("X-Cedar-Cache", "Unknown")
            print(f" {label}: Status=200, Cache={cache_source}, Latency={latency:.2f}ms")
        else:
            print(f" {label}: Error {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f" {label}: Failed - {e}")

if __name__ == '__main__':
    test_authorize_cache()
