import requests
import json
import sys

def get_permissions_rest(app_id, principal_type, principal_id):
    """
    Calls the REST API to get permissions/entitlements for a principal.
    """
    print(f"\n--- Requesting Permissions via REST ---")
    print(f"App ID: {app_id}")
    print(f"Principal: {principal_type}::{principal_id}")

    # Base URL for the REST API (default port 8080)
    base_url = "http://localhost:8080"
    
    # Construct the URL
    url = f"{base_url}/v1/apps/{app_id}/permissions"
    params = {
        "principal_type": principal_type,
        "principal_id": principal_id
    }

    try:
        response = requests.get(url, params=params)
        
        # Check if request was successful
        if response.status_code == 200:
            data = response.json()
            print("Response Status: 200 OK")
            print("Permissions Response:")
            print(json.dumps(data, indent=2))
            return data
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    except requests.exceptions.RequestException as e:
        print(f"Request Error: {e}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == '__main__':
    # 1. Check permissions for alice
    get_permissions_rest(
        app_id="1",
        principal_type="User",
        principal_id="alice"
    )

    # 2. Check permissions for bob
    get_permissions_rest(
        app_id="1",
        principal_type="User",
        principal_id="bob"
    )

