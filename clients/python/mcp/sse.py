"""
Server-Sent Events (SSE) subscriber for Cedar policy updates.

This module provides real-time cache invalidation by subscribing
to policy update events from the Cedar backend.
"""

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

logger = logging.getLogger(__name__)


@dataclass
class PolicyEvent:
    """Represents a policy update event."""
    event_type: str
    app_id: Optional[int]
    timestamp: str
    data: Optional[dict]


class SSESubscriber:
    """
    Subscribes to Cedar policy update events via Server-Sent Events.
    
    When a policy is created, updated, or deleted, the subscriber
    receives an event and can trigger cache invalidation.
    
    Example:
        def on_policy_update(event):
            print(f"Policy updated for app {event.app_id}")
            cache.invalidate(event.app_id)
        
        subscriber = SSESubscriber(
            url="http://localhost:8080/v1/events",
            on_event=on_policy_update
        )
        subscriber.start()
    """
    
    def __init__(
        self,
        url: str,
        on_event: Callable[[PolicyEvent], None],
        app_id: Optional[int] = None,
        headers: Optional[dict] = None,
        reconnect_delay: float = 5.0,
        max_reconnect_delay: float = 60.0
    ):
        """
        Initialize the SSE subscriber.
        
        Args:
            url: SSE endpoint URL (e.g., "http://localhost:8080/v1/events")
            on_event: Callback function for policy events
            app_id: Optional app ID to filter events
            headers: Optional HTTP headers (e.g., for authentication)
            reconnect_delay: Initial reconnect delay in seconds
            max_reconnect_delay: Maximum reconnect delay
        """
        self.url = url
        if app_id:
            self.url = f"{url}?app_id={app_id}"
        
        self.on_event = on_event
        self.headers = headers or {}
        self.reconnect_delay = reconnect_delay
        self.max_reconnect_delay = max_reconnect_delay
        
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._current_delay = reconnect_delay
    
    def start(self) -> None:
        """Start the SSE subscriber in a background thread."""
        if self._running:
            return
        
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info(f"SSE subscriber started: {self.url}")
    
    def stop(self) -> None:
        """Stop the SSE subscriber."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5.0)
            self._thread = None
        logger.info("SSE subscriber stopped")
    
    def _run(self) -> None:
        """Main loop for SSE subscription."""
        while self._running:
            try:
                self._connect_and_listen()
                # Reset delay on successful connection
                self._current_delay = self.reconnect_delay
            except Exception as e:
                logger.warning(f"SSE connection error: {e}")
                if self._running:
                    logger.info(f"Reconnecting in {self._current_delay}s...")
                    time.sleep(self._current_delay)
                    # Exponential backoff
                    self._current_delay = min(
                        self._current_delay * 2,
                        self.max_reconnect_delay
                    )
    
    def _connect_and_listen(self) -> None:
        """Connect to SSE endpoint and process events."""
        import requests
        
        with requests.get(
            self.url,
            headers={**self.headers, "Accept": "text/event-stream"},
            stream=True,
            timeout=(10.0, None)  # 10s connect timeout, no read timeout
        ) as response:
            response.raise_for_status()
            logger.debug(f"Connected to SSE endpoint: {self.url}")
            
            event_type = None
            data_lines = []
            
            for line in response.iter_lines(decode_unicode=True):
                if not self._running:
                    break
                
                if line is None:
                    continue
                
                line = line.strip() if line else ""
                
                # Empty line = event complete
                if not line:
                    if data_lines:
                        self._process_event(event_type, "\n".join(data_lines))
                    event_type = None
                    data_lines = []
                    continue
                
                # Comment (keepalive)
                if line.startswith(":"):
                    continue
                
                # Parse field
                if ":" in line:
                    field, _, value = line.partition(":")
                    value = value.lstrip()
                    
                    if field == "event":
                        event_type = value
                    elif field == "data":
                        data_lines.append(value)
                    # Ignore other fields (id, retry)
    
    def _process_event(self, event_type: Optional[str], data: str) -> None:
        """Process a received SSE event."""
        try:
            payload = json.loads(data) if data else {}
            
            event = PolicyEvent(
                event_type=event_type or payload.get("type", "unknown"),
                app_id=payload.get("app_id"),
                timestamp=payload.get("timestamp", ""),
                data=payload.get("data")
            )
            
            logger.debug(f"Received event: {event.event_type} for app {event.app_id}")
            self.on_event(event)
            
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse SSE data: {e}")
        except Exception as e:
            logger.error(f"Error processing SSE event: {e}")
    
    @property
    def is_running(self) -> bool:
        """Check if the subscriber is running."""
        return self._running
    
    def __enter__(self):
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()


def create_cache_invalidator(cache) -> Callable[[PolicyEvent], None]:
    """
    Create an event handler that invalidates a cache on policy updates.
    
    Args:
        cache: A cache object with invalidate_app(app_id) method
    
    Returns:
        Event handler function
    """
    def handler(event: PolicyEvent) -> None:
        if event.event_type in ("policy_updated", "entity_updated"):
            if event.app_id:
                logger.info(f"Invalidating cache for app {event.app_id}")
                cache.invalidate_app(event.app_id)
            else:
                logger.info("Invalidating entire cache")
                cache.invalidate_all()
    
    return handler

