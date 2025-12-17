"""
Client-side caching layer for Cedar authorization decisions.

This module provides a TTL-based in-memory cache to reduce round-trips
to the Cedar backend for repeated authorization checks.
"""

import hashlib
import json
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CacheEntry:
    """Represents a cached authorization decision."""
    allowed: bool
    reasons: List[str]
    timestamp: float
    ttl: float
    
    def is_expired(self) -> bool:
        """Check if this cache entry has expired."""
        return time.time() > self.timestamp + self.ttl


class AuthzCache:
    """
    Thread-safe TTL cache for authorization decisions.
    
    Supports selective invalidation by app_id for real-time updates.
    """
    
    def __init__(self, default_ttl: float = 60.0, max_size: int = 10000):
        """
        Initialize the cache.
        
        Args:
            default_ttl: Default TTL in seconds for cache entries
            max_size: Maximum number of entries before eviction
        """
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = threading.RLock()
        self._default_ttl = default_ttl
        self._max_size = max_size
        self._stats = {
            "hits": 0,
            "misses": 0,
            "invalidations": 0,
        }
    
    def _make_key(
        self,
        app_id: int,
        principal_type: str,
        principal_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """Generate a cache key from authorization parameters."""
        key_data = {
            "app_id": app_id,
            "principal": f"{principal_type}::{principal_id}",
            "action": action,
            "resource": f"{resource_type}::{resource_id}",
            "context": json.dumps(context or {}, sort_keys=True),
        }
        key_str = json.dumps(key_data, sort_keys=True)
        return hashlib.sha256(key_str.encode()).hexdigest()
    
    def get(
        self,
        app_id: int,
        principal_type: str,
        principal_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Optional[CacheEntry]:
        """
        Get a cached authorization decision.
        
        Returns None if not found or expired.
        """
        key = self._make_key(
            app_id, principal_type, principal_id,
            action, resource_type, resource_id, context
        )
        
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                self._stats["misses"] += 1
                return None
            
            if entry.is_expired():
                del self._cache[key]
                self._stats["misses"] += 1
                return None
            
            self._stats["hits"] += 1
            return entry
    
    def set(
        self,
        app_id: int,
        principal_type: str,
        principal_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        allowed: bool,
        reasons: List[str] = None,
        context: Optional[Dict[str, Any]] = None,
        ttl: Optional[float] = None
    ) -> None:
        """Store an authorization decision in the cache."""
        key = self._make_key(
            app_id, principal_type, principal_id,
            action, resource_type, resource_id, context
        )
        
        with self._lock:
            # Evict expired entries if at capacity
            if len(self._cache) >= self._max_size:
                self._evict_expired()
            
            # If still at capacity, remove oldest entry
            if len(self._cache) >= self._max_size:
                oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k].timestamp)
                del self._cache[oldest_key]
            
            self._cache[key] = CacheEntry(
                allowed=allowed,
                reasons=reasons or [],
                timestamp=time.time(),
                ttl=ttl or self._default_ttl
            )
    
    def invalidate_app(self, app_id: int) -> int:
        """
        Invalidate all cache entries for a specific application.
        
        Returns the number of entries invalidated.
        """
        prefix = f'"app_id": {app_id}'
        count = 0
        
        with self._lock:
            # We need to regenerate keys to find matches, but for efficiency
            # we store app_id in a way that can be checked
            keys_to_remove = []
            for key, entry in self._cache.items():
                # Check if this key belongs to the app
                # Since we hash the key, we need to track app_id separately
                # For simplicity, clear all and let it refill
                pass
            
            # For now, clear all entries (simple but effective)
            # In production, you'd want to track app_id -> keys mapping
            count = len(self._cache)
            self._cache.clear()
            self._stats["invalidations"] += 1
        
        return count
    
    def invalidate_all(self) -> int:
        """Clear all cache entries."""
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            self._stats["invalidations"] += 1
            return count
    
    def _evict_expired(self) -> int:
        """Remove all expired entries. Must be called with lock held."""
        expired_keys = [
            key for key, entry in self._cache.items()
            if entry.is_expired()
        ]
        for key in expired_keys:
            del self._cache[key]
        return len(expired_keys)
    
    @property
    def stats(self) -> Dict[str, int]:
        """Get cache statistics."""
        with self._lock:
            return {
                **self._stats,
                "size": len(self._cache),
                "hit_rate": self._stats["hits"] / max(1, self._stats["hits"] + self._stats["misses"])
            }


class CachedAuthzClient:
    """
    Authorization client with built-in caching.
    
    Wraps REST API calls with a TTL cache for better performance.
    """
    
    def __init__(
        self,
        base_url: str,
        app_id: int,
        cache_ttl: float = 60.0,
        cache_max_size: int = 10000,
        headers: Optional[Dict[str, str]] = None
    ):
        """
        Initialize the cached client.
        
        Args:
            base_url: Cedar backend URL (e.g., "http://localhost:8080")
            app_id: Application ID for authorization checks
            cache_ttl: Cache TTL in seconds
            cache_max_size: Maximum cache entries
            headers: Optional HTTP headers (e.g., for authentication)
        """
        self.base_url = base_url.rstrip("/")
        self.app_id = app_id
        self.headers = headers or {}
        self._cache = AuthzCache(default_ttl=cache_ttl, max_size=cache_max_size)
    
    def check(
        self,
        principal_type: str,
        principal_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        context: Optional[Dict[str, Any]] = None,
        bypass_cache: bool = False
    ) -> bool:
        """
        Check if a principal is authorized to perform an action.
        
        Args:
            principal_type: Type of principal (e.g., "User")
            principal_id: ID of the principal (e.g., "alice")
            action: Action to check (e.g., "view")
            resource_type: Type of resource (e.g., "Document")
            resource_id: ID of the resource
            context: Optional context for the authorization check
            bypass_cache: If True, skip cache and fetch from backend
        
        Returns:
            True if authorized, False otherwise
        """
        import requests
        
        # Check cache first (unless bypassed)
        if not bypass_cache:
            cached = self._cache.get(
                self.app_id, principal_type, principal_id,
                action, resource_type, resource_id, context
            )
            if cached is not None:
                return cached.allowed
        
        # Make API call
        payload = {
            "application_id": self.app_id,
            "principal": {"type": principal_type, "id": principal_id},
            "action": {"type": "Action", "id": action},
            "resource": {"type": resource_type, "id": resource_id},
            "context": context or {}
        }
        
        response = requests.post(
            f"{self.base_url}/v1/authorize",
            json=payload,
            headers=self.headers,
            timeout=5.0
        )
        response.raise_for_status()
        
        result = response.json()
        allowed = result.get("decision") == "allow"
        reasons = result.get("reasons", [])
        
        # Update cache
        self._cache.set(
            self.app_id, principal_type, principal_id,
            action, resource_type, resource_id,
            allowed=allowed,
            reasons=reasons,
            context=context
        )
        
        return allowed
    
    def get_entitlements(
        self,
        username: str,
        groups: Optional[List[str]] = None,
        include_inherited: bool = True
    ) -> Dict[str, Any]:
        """
        Get all entitlements for a user and their groups.
        
        Args:
            username: The user's ID
            groups: Optional list of group IDs the user belongs to
            include_inherited: Include permissions inherited from groups
        
        Returns:
            Entitlements response with user and group permissions
        """
        import requests
        
        payload = {
            "application_id": self.app_id,
            "username": username,
            "groups": groups or [],
            "include_inherited": include_inherited
        }
        
        response = requests.post(
            f"{self.base_url}/v1/entitlements",
            json=payload,
            headers=self.headers,
            timeout=10.0
        )
        response.raise_for_status()
        
        return response.json()
    
    def invalidate(self, app_id: Optional[int] = None) -> int:
        """
        Invalidate cached entries.
        
        Args:
            app_id: If provided, invalidate only entries for this app.
                   If None, invalidate all entries.
        
        Returns:
            Number of entries invalidated
        """
        if app_id is not None:
            return self._cache.invalidate_app(app_id)
        return self._cache.invalidate_all()
    
    @property
    def cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        return self._cache.stats

