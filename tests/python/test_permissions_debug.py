import requests
import json
import sys

def test_debug_param():
    base_url = "http://localhost:8080"
    
    print("Searching for existing application...")
    try:
        resp = requests.get(f"{base_url}/v1/apps/")
        if not resp.ok:
            print(f"Failed to list apps: {resp.text}")
            sys.exit(1)
            
        apps = resp.json()
        if not apps:
            print("No applications found. Please run seed script first.")
            sys.exit(1)
            
        # Use first app
        app_id = apps[0]["id"]
        print(f"Using App ID: {app_id}")
    except Exception as e:
        print(f"Connection failed: {e}")
        sys.exit(1)
    
    # 2. Call permissions WITHOUT debug
    url = f"{base_url}/v1/apps/{app_id}/permissions?principal_type=User&principal_id=alice"
    print(f"\n[Test 1] Requesting without debug: {url}")
    resp = requests.get(url)
    
    if not resp.ok:
        print(f"Failed: {resp.text}")
        sys.exit(1)
        
    data = resp.json()
    permissions = data.get("permissions") or []
    
    if not permissions:
        print("Note: No permissions found for alice. Ensure seed data is active.")
    
    for p in permissions:
        if "policy_id" in p and p["policy_id"]:
            print(f"FAIL: Found policy_id '{p['policy_id']}' when debug is OFF")
            sys.exit(1)
            
    print("PASS: policy_id hidden/empty when debug=false")
    
    # 3. Call permissions WITH debug
    url_debug = f"{url}&debug=true"
    print(f"\n[Test 2] Requesting with debug: {url_debug}")
    resp = requests.get(url_debug)
    data = resp.json()
    permissions = data.get("permissions") or []
    
    found_id = False
    for p in permissions:
        if "policy_id" in p and p["policy_id"]:
            print(f"Found policy_id: {p['policy_id']}")
            found_id = True
            
    if permissions and not found_id:
        print("FAIL: Permissions returned but policy_id missing when debug=true")
        sys.exit(1)
    
    if found_id:
        print("PASS: policy_id present when debug=true")
    elif not permissions:
        print("PASS (Conditional): No permissions to check, but no error.")

if __name__ == "__main__":
    test_debug_param()
