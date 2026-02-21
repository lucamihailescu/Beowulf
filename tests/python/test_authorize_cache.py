import requests
import json
import time

from beowulf_sdk_loader import Beowulf, BeowulfAPIError

BASE_URL = "http://localhost:8080"

def get_app_id():
    try:
        resp = requests.get(f"{BASE_URL}/v1/apps/")
        if resp.ok and resp.json():
            return resp.json()[0]['id']
    except:
        pass
    return 1

def test_authorize_cache(app_id=None, principal_id="alice", action_id="view", resource_id="doc-123"):
    if app_id is None:
        app_id = get_app_id()
    print(f"Using App ID: {app_id}")
    token = None
    import os
    if os.getenv("CEDAR_APP_API_KEY"):
        token = os.getenv("CEDAR_APP_API_KEY")
    elif os.getenv("CEDAR_API_KEY"):
        token = os.getenv("CEDAR_API_KEY")
    headers: dict[str, str] = {}
    if os.getenv("CEDAR_BEARER_TOKEN"):
        headers["Authorization"] = f"Bearer {os.getenv('CEDAR_BEARER_TOKEN')}"
    client = Beowulf(token=token, pdp=BASE_URL, application_id=int(app_id), headers=headers, timeout=5.0)
    
    payload = {
        "principal": {"type": "User", "id": principal_id},
        "action": {"type": "Action", "id": action_id},
        "resource": {"type": "Document", "id": resource_id},
        "context": {}
    }

    print(f"\n--- Testing Cache Invalidation Flow ---")
    
    # Phase 1: Warm up and verify L1
    print("\n[Phase 1] Warming Cache...")
    for i in range(1, 4):
        make_auth_request(client, payload, f"Warm-up {i}")
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
    
    policy_id = None
    try:
        resp = requests.post(create_policy_url, json=policy_payload)
        if resp.status_code == 200:
            print(" -> Policy updated successfully. Cache should be invalidated.")
            policy_id = resp.json().get("policy_id")
        else:
            print(f" -> Policy update failed: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f" -> Policy update failed with exception: {e}")

    # Phase 3: Verify Cache Miss (DB Hit) then Re-warm (L1)
    print("\n[Phase 3] Verifying Invalidation & Re-warming...")
    for i in range(1, 4):
        make_auth_request(client, payload, f"Post-Update {i}")
        time.sleep(0.1)

    # Cleanup
    if policy_id:
        print(f"\n[Cleanup] Deleting test policy {policy_id}...")
        del_url = f"{BASE_URL}/v1/apps/{app_id}/policies/{policy_id}"
        try:
            del_resp = requests.delete(del_url)
            if del_resp.status_code == 200:
                print(" -> Policy deleted successfully.")
            else:
                print(f" -> Delete failed: {del_resp.status_code} {del_resp.text}")
        except Exception as e:
            print(f" -> Delete failed with exception: {e}")
    client.close()

def make_auth_request(client: Beowulf, payload: dict, label: str):
    try:
        start_time = time.time()
        decision, headers = client.authorize_with_metadata_sync(
            user=payload["principal"],
            action=payload["action"],
            resource=payload["resource"],
            context=payload.get("context", {}),
        )
        latency = (time.time() - start_time) * 1000 # ms
        cache_source = headers.get("x-cedar-cache") or headers.get("X-Cedar-Cache", "Unknown")
        print(f" {label}: Status=200, Decision={decision.decision}, Cache={cache_source}, Latency={latency:.2f}ms")
    except BeowulfAPIError as e:
        print(f" {label}: Error {e.status_code} - {e.response_body}")
    except Exception as e:
        print(f" {label}: Failed - {e}")

if __name__ == '__main__':
    test_authorize_cache()
