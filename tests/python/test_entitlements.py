import grpc
import sys
import os

# Add current directory to path so generated modules can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import authz_pb2
import authz_pb2_grpc

def get_entitlements(app_id, principal_type, principal_id, action_type, action_id, resource_type):
    """
    Calls LookupResources to find which resources of a given type the principal can access.
    """
    print(f"\n--- Requesting Entitlements ---")
    print(f"App ID: {app_id}")
    print(f"Principal: {principal_type}::{principal_id}")
    print(f"Action: {action_type}::{action_id}")
    print(f"Target Resource Type: {resource_type}")

    try:
        # Connect to the gRPC server
        # Assuming the server is running locally on port 50051 as per README
        with grpc.insecure_channel('localhost:50051') as channel:
            stub = authz_pb2_grpc.AuthorizationServiceStub(channel)
            
            # Construct the request
            request = authz_pb2.LookupResourcesRequest(
                application_id=app_id,
                principal=authz_pb2.Entity(type=principal_type, id=principal_id),
                action=authz_pb2.Entity(type=action_type, id=action_id),
                resource_type=resource_type,
                context={} 
            )
            
            # Make the RPC call
            response = stub.LookupResources(request)
            
            # Print results
            print(f"Result: Found {len(response.resource_ids)} resources")
            for res_id in response.resource_ids:
                print(f" - {res_id}")
                
            return response.resource_ids

    except grpc.RpcError as e:
        print(f"RPC Error: {e.code()} - {e.details()}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == '__main__':
    # specific examples based on potential real usage
    
    # 1. Check what Documents alice can view
    get_entitlements(
        app_id="1",
        principal_type="User",
        principal_id="alice",
        action_type="Action",
        action_id="view",
        resource_type="Document"
    )

    # 2. Check what Documents bob can view (assuming another user)
    get_entitlements(
        app_id="1",
        principal_type="User",
        principal_id="bob",
        action_type="Action",
        action_id="view",
        resource_type="Document"
    )

    # 3. Check for a Group (if supported by policy logic)
    get_entitlements(
        app_id="1",
        principal_type="Group",
        principal_id="admins",
        action_type="Action",
        action_id="edit",
        resource_type="Document"
    )

