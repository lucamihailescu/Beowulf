#!/usr/bin/env python3
import requests
import json
import sys

# Base URL for the REST API (default port 8080)
BASE_URL = "http://localhost:8080"
API_KEY = "dev-secret-key"

def get_first_app_id():
    """
    Fetches the list of applications and returns the ID of the first one.
    """
    url = f"{BASE_URL}/v1/apps"
    headers = {
        "X-API-Key": API_KEY
    }
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            apps = response.json()
            if apps and len(apps) > 0:
                return apps[0]["id"]
            else:
                print("Error: No applications found.")
                return None
        else:
            print(f"Error fetching apps: {response.status_code}")
            print(response.text)
            return None
    except Exception as e:
        print(f"Error fetching apps: {e}")
        return None

def get_permissions_rest(app_id, principal_type, principal_id):
    """
    Calls the REST API to get permissions/entitlements for a principal.
    """
    print(f"\n--- Requesting Permissions via REST ---")
    print(f"App ID: {app_id}")
    print(f"Principal: {principal_type}::{principal_id}")

    # Construct the URL
    url = f"{BASE_URL}/v1/apps/{app_id}/permissions"
    params = {
        "principal_type": principal_type,
        "principal_id": principal_id
    }
    headers = {
        "X-API-Key": API_KEY
    }

    try:
        response = requests.get(url, params=params, headers=headers)
        
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
    # Get dynamic app ID
    app_id = get_first_app_id()
    
    if app_id:
        # 1. Check permissions for alice
        get_permissions_rest(
            app_id=app_id,
            principal_type="User",
            principal_id="alice"
        )
    else:
        print("Skipping tests due to missing application.")

