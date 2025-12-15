"""
Enterprise Policy Management - gRPC Client Wrapper

Example usage:
    from client import EPMClient
    
    client = EPMClient("localhost:50051")
    result = client.check(
        app_id="1",
        principal_type="User",
        principal_id="alice",
        action_type="Action",
        action_id="view",
        resource_type="Document",
        resource_id="doc1"
    )
    print(f"Allowed: {result.allowed}")
"""
import grpc
from . import authz_pb2
from . import authz_pb2_grpc


class EPMClient:
    """Enterprise Policy Management gRPC Client"""
    
    def __init__(self, target: str, secure: bool = False, credentials=None):
        """
        Initialize the client.
        
        Args:
            target: gRPC server address (e.g., "localhost:50051")
            secure: Use TLS connection
            credentials: Optional gRPC credentials for secure connections
        """
        if secure:
            if credentials is None:
                credentials = grpc.ssl_channel_credentials()
            self.channel = grpc.secure_channel(target, credentials)
        else:
            self.channel = grpc.insecure_channel(target)
        
        self.stub = authz_pb2_grpc.AuthorizationServiceStub(self.channel)
    
    def check(
        self,
        app_id: str,
        principal_type: str,
        principal_id: str,
        action_type: str,
        action_id: str,
        resource_type: str,
        resource_id: str,
        context: dict = None
    ) -> authz_pb2.CheckResponse:
        """
        Perform an authorization check.
        
        Returns:
            CheckResponse with allowed, reasons, and errors fields
        """
        request = authz_pb2.CheckRequest(
            application_id=app_id,
            principal=authz_pb2.Entity(type=principal_type, id=principal_id),
            action=authz_pb2.Entity(type=action_type, id=action_id),
            resource=authz_pb2.Entity(type=resource_type, id=resource_id),
        )
        
        if context:
            for key, value in context.items():
                if isinstance(value, str):
                    request.context[key].string_value = value
                elif isinstance(value, int):
                    request.context[key].int_value = value
                elif isinstance(value, bool):
                    request.context[key].bool_value = value
        
        return self.stub.Check(request)
    
    def batch_check(self, checks: list) -> authz_pb2.BatchCheckResponse:
        """
        Perform multiple authorization checks in parallel.
        
        Args:
            checks: List of dicts with keys: app_id, principal_type, principal_id,
                   action_type, action_id, resource_type, resource_id, context
        
        Returns:
            BatchCheckResponse with results list
        """
        requests = []
        for check in checks:
            req = authz_pb2.CheckRequest(
                application_id=check["app_id"],
                principal=authz_pb2.Entity(
                    type=check["principal_type"],
                    id=check["principal_id"]
                ),
                action=authz_pb2.Entity(
                    type=check["action_type"],
                    id=check["action_id"]
                ),
                resource=authz_pb2.Entity(
                    type=check["resource_type"],
                    id=check["resource_id"]
                ),
            )
            requests.append(req)
        
        batch_request = authz_pb2.BatchCheckRequest(checks=requests)
        return self.stub.BatchCheck(batch_request)
    
    def lookup_resources(
        self,
        app_id: str,
        principal_type: str,
        principal_id: str,
        action_type: str,
        action_id: str,
        resource_type: str,
        context: dict = None
    ) -> list:
        """
        Look up resources the principal can access.
        
        Returns:
            List of resource IDs
        """
        request = authz_pb2.LookupResourcesRequest(
            application_id=app_id,
            principal=authz_pb2.Entity(type=principal_type, id=principal_id),
            action=authz_pb2.Entity(type=action_type, id=action_id),
            resource_type=resource_type,
        )
        
        if context:
            for key, value in context.items():
                if isinstance(value, str):
                    request.context[key].string_value = value
                elif isinstance(value, int):
                    request.context[key].int_value = value
                elif isinstance(value, bool):
                    request.context[key].bool_value = value
        
        response = self.stub.LookupResources(request)
        return list(response.resource_ids)
    
    def close(self):
        """Close the gRPC channel."""
        self.channel.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
