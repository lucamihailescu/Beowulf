"""
MCP Authorization helpers for Cedar integration.

This module provides the main CedarMCPAuthorizer class that MCP servers
can use to enforce authorization on tool calls.
"""

import functools
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, TypeVar

from .cache import CachedAuthzClient
from .sse import SSESubscriber, create_cache_invalidator

logger = logging.getLogger(__name__)

# Type variable for generic decorators
F = TypeVar('F', bound=Callable[..., Any])


@dataclass
class CedarMCPConfig:
    """Configuration for Cedar MCP authorization."""
    
    # Cedar backend URL
    cedar_url: str = "http://localhost:8080"
    
    # gRPC URL (optional, for lower latency)
    grpc_url: str = "localhost:50051"
    
    # Application ID in Cedar
    app_id: int = 1
    
    # Application name (alternative to app_id)
    app_name: Optional[str] = None
    
    # Cache TTL in seconds
    cache_ttl_seconds: float = 60.0
    
    # Maximum cache entries
    cache_max_size: int = 10000
    
    # Enable SSE subscription for real-time invalidation
    enable_sse: bool = True
    
    # Authentication headers
    auth_headers: Dict[str, str] = field(default_factory=dict)
    
    # Default principal type
    default_principal_type: str = "User"
    
    # Default resource type for tools
    default_tool_resource_type: str = "Tool"


class CedarMCPAuthorizer:
    """
    Authorization helper for MCP servers using Cedar policies.
    
    Provides:
    - Tool filtering based on user permissions
    - Authorization checks before tool execution
    - Client-side caching with SSE invalidation
    - Entitlements lookup for IdP integration
    
    Example:
        config = CedarMCPConfig(
            cedar_url="http://localhost:8080",
            app_id=1,
            cache_ttl_seconds=60
        )
        
        authorizer = CedarMCPAuthorizer(config)
        
        # Filter tools for a user
        available_tools = authorizer.filter_tools(all_tools, user_id="alice")
        
        # Check authorization
        if authorizer.authorize_tool("read_document", user_id="alice"):
            result = execute_tool(...)
    """
    
    def __init__(self, config: CedarMCPConfig):
        """Initialize the authorizer with configuration."""
        self.config = config
        
        # Initialize cached client
        self._client = CachedAuthzClient(
            base_url=config.cedar_url,
            app_id=config.app_id,
            cache_ttl=config.cache_ttl_seconds,
            cache_max_size=config.cache_max_size,
            headers=config.auth_headers
        )
        
        # Initialize SSE subscriber for real-time invalidation
        self._sse_subscriber: Optional[SSESubscriber] = None
        if config.enable_sse:
            self._start_sse_subscriber()
    
    def _start_sse_subscriber(self) -> None:
        """Start SSE subscriber for cache invalidation."""
        try:
            invalidator = create_cache_invalidator(self._client._cache)
            self._sse_subscriber = SSESubscriber(
                url=f"{self.config.cedar_url}/v1/events",
                on_event=invalidator,
                app_id=self.config.app_id,
                headers=self.config.auth_headers
            )
            self._sse_subscriber.start()
        except Exception as e:
            logger.warning(f"Failed to start SSE subscriber: {e}")
    
    def authorize(
        self,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        context: Optional[Dict[str, Any]] = None,
        user_type: Optional[str] = None
    ) -> bool:
        """
        Check if a user is authorized to perform an action.
        
        Args:
            user_id: The user's ID
            action: The action to perform (e.g., "view", "edit")
            resource_type: Type of resource (e.g., "Document", "Tool")
            resource_id: ID of the resource
            context: Optional context for the authorization check
            user_type: Principal type (defaults to config.default_principal_type)
        
        Returns:
            True if authorized, False otherwise
        """
        principal_type = user_type or self.config.default_principal_type
        
        try:
            return self._client.check(
                principal_type=principal_type,
                principal_id=user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                context=context
            )
        except Exception as e:
            logger.error(f"Authorization check failed: {e}")
            # Fail closed on errors
            return False
    
    def authorize_tool(
        self,
        tool_name: str,
        user_id: str,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Check if a user is authorized to use a specific tool.
        
        Args:
            tool_name: Name of the tool
            user_id: The user's ID
            context: Optional context for the authorization check
        
        Returns:
            True if authorized, False otherwise
        """
        return self.authorize(
            user_id=user_id,
            action=tool_name,
            resource_type=self.config.default_tool_resource_type,
            resource_id=tool_name,
            context=context
        )
    
    def filter_tools(
        self,
        tools: List[Any],
        user_id: str,
        tool_name_attr: str = "name"
    ) -> List[Any]:
        """
        Filter a list of tools to only those the user can access.
        
        Args:
            tools: List of tool objects
            user_id: The user's ID
            tool_name_attr: Attribute name for tool's name (default: "name")
        
        Returns:
            Filtered list of authorized tools
        """
        authorized_tools = []
        for tool in tools:
            tool_name = getattr(tool, tool_name_attr, None)
            if tool_name is None:
                # Try dict access
                tool_name = tool.get(tool_name_attr) if isinstance(tool, dict) else None
            
            if tool_name and self.authorize_tool(tool_name, user_id):
                authorized_tools.append(tool)
        
        return authorized_tools
    
    def get_user_entitlements(
        self,
        username: str,
        groups: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Get all entitlements for a user (IdP integration).
        
        Args:
            username: The user's ID
            groups: Optional list of group IDs
        
        Returns:
            Entitlements response with user and group permissions
        """
        return self._client.get_entitlements(
            username=username,
            groups=groups,
            include_inherited=True
        )
    
    def get_allowed_actions(
        self,
        user_id: str,
        groups: Optional[List[str]] = None
    ) -> List[str]:
        """
        Get list of all actions/tools a user is allowed to perform.
        
        Args:
            user_id: The user's ID
            groups: Optional list of group IDs
        
        Returns:
            List of allowed action names
        """
        entitlements = self.get_user_entitlements(user_id, groups)
        
        allowed_actions = set()
        
        # User's direct entitlements
        for entry in entitlements.get("entitlements", []):
            if entry.get("effect") == "permit":
                allowed_actions.update(entry.get("actions", []))
        
        # Group entitlements
        for group_id, entries in entitlements.get("group_entitlements", {}).items():
            for entry in entries:
                if entry.get("effect") == "permit":
                    allowed_actions.update(entry.get("actions", []))
        
        return list(allowed_actions)
    
    def require_authorization(
        self,
        action: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        user_id_param: str = "user_id"
    ) -> Callable[[F], F]:
        """
        Decorator to require authorization before function execution.
        
        Args:
            action: Action name (defaults to function name)
            resource_type: Resource type (defaults to Tool)
            resource_id: Resource ID (defaults to action/function name)
            user_id_param: Name of the parameter containing user ID
        
        Returns:
            Decorator function
        
        Example:
            @authorizer.require_authorization(action="read_document")
            async def read_document(user_id: str, doc_id: str):
                ...
        """
        def decorator(func: F) -> F:
            @functools.wraps(func)
            def wrapper(*args, **kwargs):
                # Extract user_id from kwargs
                uid = kwargs.get(user_id_param)
                if uid is None:
                    raise ValueError(f"Missing required parameter: {user_id_param}")
                
                # Determine action
                act = action or func.__name__
                res_type = resource_type or self.config.default_tool_resource_type
                res_id = resource_id or act
                
                if not self.authorize(uid, act, res_type, res_id):
                    raise PermissionError(
                        f"User {uid} is not authorized to perform {act}"
                    )
                
                return func(*args, **kwargs)
            
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                # Extract user_id from kwargs
                uid = kwargs.get(user_id_param)
                if uid is None:
                    raise ValueError(f"Missing required parameter: {user_id_param}")
                
                # Determine action
                act = action or func.__name__
                res_type = resource_type or self.config.default_tool_resource_type
                res_id = resource_id or act
                
                if not self.authorize(uid, act, res_type, res_id):
                    raise PermissionError(
                        f"User {uid} is not authorized to perform {act}"
                    )
                
                return await func(*args, **kwargs)
            
            # Return appropriate wrapper based on function type
            import asyncio
            if asyncio.iscoroutinefunction(func):
                return async_wrapper  # type: ignore
            return wrapper  # type: ignore
        
        return decorator
    
    def invalidate_cache(self, app_id: Optional[int] = None) -> int:
        """
        Manually invalidate the authorization cache.
        
        Args:
            app_id: If provided, invalidate only for this app
        
        Returns:
            Number of entries invalidated
        """
        return self._client.invalidate(app_id)
    
    @property
    def cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        return self._client.cache_stats
    
    def close(self) -> None:
        """Close the authorizer and stop background tasks."""
        if self._sse_subscriber:
            self._sse_subscriber.stop()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

