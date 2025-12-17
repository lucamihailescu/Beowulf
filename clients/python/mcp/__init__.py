"""
Cedar MCP Authorization SDK

This module provides authorization helpers for Model Context Protocol (MCP) servers
integrating with the Cedar Enterprise Policy Management system.

Features:
- Client-side TTL caching for authorization decisions
- SSE-based real-time cache invalidation
- Tool filtering based on user permissions
- Decorator-based authorization enforcement

Example:
    from cedar_mcp import CedarMCPAuthorizer, CedarMCPConfig
    
    config = CedarMCPConfig(
        cedar_url="http://localhost:8080",
        app_id=1,
        cache_ttl_seconds=60
    )
    
    authorizer = CedarMCPAuthorizer(config)
    
    # Filter available tools based on user permissions
    available_tools = authorizer.filter_tools(all_tools, user_id="alice")
    
    # Check authorization before tool execution
    if authorizer.authorize_tool("read_document", user_id="alice"):
        result = execute_tool(...)
"""

from .authorizer import CedarMCPAuthorizer, CedarMCPConfig
from .cache import CachedAuthzClient
from .sse import SSESubscriber

__all__ = [
    "CedarMCPAuthorizer",
    "CedarMCPConfig",
    "CachedAuthzClient", 
    "SSESubscriber",
]

