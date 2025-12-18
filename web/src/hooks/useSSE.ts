import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE_URL } from '../api';

export type SSEEventType = 'connected' | 'policy_updated' | 'entity_updated' | 'heartbeat';

export interface SSEEvent {
  type: SSEEventType;
  timestamp: string;
  data?: {
    application_id?: number;
    policy_id?: number;
    entity_type?: string;
    entity_id?: string;
    action?: string;
  };
}

export interface SSEState {
  connected: boolean;
  lastEvent: SSEEvent | null;
  error: string | null;
  reconnectAttempts: number;
}

export interface UseSSEOptions {
  onPolicyUpdate?: (event: SSEEvent) => void;
  onEntityUpdate?: (event: SSEEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_RECONNECT_DELAY = 3000; // 3 seconds

/**
 * Hook for connecting to the SSE events endpoint for real-time updates.
 * Automatically handles reconnection on disconnect.
 */
export function useSSE(options: UseSSEOptions = {}): SSEState & { reconnect: () => void } {
  const {
    onPolicyUpdate,
    onEntityUpdate,
    onConnect,
    onDisconnect,
    enabled = true,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    reconnectDelay = DEFAULT_RECONNECT_DELAY,
  } = options;

  const [state, setState] = useState<SSEState>({
    connected: false,
    lastEvent: null,
    error: null,
    reconnectAttempts: 0,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!enabled) return;
    
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      // Build SSE URL - use /api prefix for load balancer, or direct for dev
      const sseUrl = `${API_BASE_URL}/v1/events`;
      console.log('[SSE] Connecting to:', sseUrl);
      
      const eventSource = new EventSource(sseUrl, { withCredentials: true });
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!mountedRef.current) return;
        console.log('[SSE] Connection opened');
        setState(prev => ({
          ...prev,
          connected: true,
          error: null,
          reconnectAttempts: 0,
        }));
      };

      eventSource.onmessage = (event) => {
        if (!mountedRef.current) return;
        
        try {
          const data: SSEEvent = JSON.parse(event.data);
          console.log('[SSE] Event received:', data.type, data);

          setState(prev => ({
            ...prev,
            lastEvent: data,
          }));

          // Handle specific event types
          switch (data.type) {
            case 'connected':
              onConnect?.();
              break;
            case 'policy_updated':
              onPolicyUpdate?.(data);
              break;
            case 'entity_updated':
              onEntityUpdate?.(data);
              break;
            case 'heartbeat':
              // Just update lastEvent, no callback needed
              break;
          }
        } catch (e) {
          console.warn('[SSE] Failed to parse event:', e);
        }
      };

      eventSource.onerror = (error) => {
        if (!mountedRef.current) return;
        console.error('[SSE] Connection error:', error);
        
        eventSource.close();
        eventSourceRef.current = null;

        setState(prev => {
          const newAttempts = prev.reconnectAttempts + 1;
          const shouldReconnect = newAttempts < maxReconnectAttempts;

          if (shouldReconnect) {
            console.log(`[SSE] Will reconnect in ${reconnectDelay}ms (attempt ${newAttempts}/${maxReconnectAttempts})`);
            reconnectTimeoutRef.current = window.setTimeout(() => {
              if (mountedRef.current) {
                connect();
              }
            }, reconnectDelay);
          } else {
            console.error('[SSE] Max reconnection attempts reached');
          }

          return {
            ...prev,
            connected: false,
            error: shouldReconnect 
              ? `Connection lost. Reconnecting... (${newAttempts}/${maxReconnectAttempts})`
              : 'Connection lost. Max reconnection attempts reached.',
            reconnectAttempts: newAttempts,
          };
        });

        onDisconnect?.();
      };
    } catch (e) {
      console.error('[SSE] Failed to create EventSource:', e);
      setState(prev => ({
        ...prev,
        connected: false,
        error: `Failed to connect: ${(e as Error).message}`,
      }));
    }
  }, [enabled, onConnect, onDisconnect, onPolicyUpdate, onEntityUpdate, maxReconnectAttempts, reconnectDelay]);

  const reconnect = useCallback(() => {
    setState(prev => ({ ...prev, reconnectAttempts: 0 }));
    connect();
  }, [connect]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    
    if (enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      
      if (eventSourceRef.current) {
        console.log('[SSE] Closing connection on unmount');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [enabled, connect]);

  return { ...state, reconnect };
}

export default useSSE;

