import React, { createContext, useContext, useCallback, useState, useMemo } from 'react';
import { useSSE, SSEEvent, SSEState } from '../hooks/useSSE';

interface SSEContextValue extends SSEState {
  reconnect: () => void;
  // Callbacks that components can subscribe to
  subscribeToPolicyUpdates: (callback: (event: SSEEvent) => void) => () => void;
  subscribeToEntityUpdates: (callback: (event: SSEEvent) => void) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

interface SSEProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
}

export function SSEProvider({ children, enabled = true }: SSEProviderProps) {
  // Store subscribers
  const [policySubscribers] = useState<Set<(event: SSEEvent) => void>>(() => new Set());
  const [entitySubscribers] = useState<Set<(event: SSEEvent) => void>>(() => new Set());

  // Handle policy updates - notify all subscribers
  const handlePolicyUpdate = useCallback((event: SSEEvent) => {
    console.log('[SSEContext] Broadcasting policy update to', policySubscribers.size, 'subscribers');
    policySubscribers.forEach(callback => {
      try {
        callback(event);
      } catch (e) {
        console.error('[SSEContext] Subscriber error:', e);
      }
    });
  }, [policySubscribers]);

  // Handle entity updates - notify all subscribers
  const handleEntityUpdate = useCallback((event: SSEEvent) => {
    console.log('[SSEContext] Broadcasting entity update to', entitySubscribers.size, 'subscribers');
    entitySubscribers.forEach(callback => {
      try {
        callback(event);
      } catch (e) {
        console.error('[SSEContext] Subscriber error:', e);
      }
    });
  }, [entitySubscribers]);

  // Use the SSE hook
  const sseState = useSSE({
    enabled,
    onPolicyUpdate: handlePolicyUpdate,
    onEntityUpdate: handleEntityUpdate,
    onConnect: () => console.log('[SSEContext] Connected to SSE'),
    onDisconnect: () => console.log('[SSEContext] Disconnected from SSE'),
  });

  // Subscribe to policy updates
  const subscribeToPolicyUpdates = useCallback((callback: (event: SSEEvent) => void) => {
    policySubscribers.add(callback);
    console.log('[SSEContext] Policy subscriber added, total:', policySubscribers.size);
    
    // Return unsubscribe function
    return () => {
      policySubscribers.delete(callback);
      console.log('[SSEContext] Policy subscriber removed, total:', policySubscribers.size);
    };
  }, [policySubscribers]);

  // Subscribe to entity updates
  const subscribeToEntityUpdates = useCallback((callback: (event: SSEEvent) => void) => {
    entitySubscribers.add(callback);
    console.log('[SSEContext] Entity subscriber added, total:', entitySubscribers.size);
    
    // Return unsubscribe function
    return () => {
      entitySubscribers.delete(callback);
      console.log('[SSEContext] Entity subscriber removed, total:', entitySubscribers.size);
    };
  }, [entitySubscribers]);

  const value = useMemo<SSEContextValue>(() => ({
    ...sseState,
    subscribeToPolicyUpdates,
    subscribeToEntityUpdates,
  }), [sseState, subscribeToPolicyUpdates, subscribeToEntityUpdates]);

  return (
    <SSEContext.Provider value={value}>
      {children}
    </SSEContext.Provider>
  );
}

/**
 * Hook to access SSE context.
 * Must be used within an SSEProvider.
 */
export function useSSEContext(): SSEContextValue {
  const context = useContext(SSEContext);
  if (!context) {
    throw new Error('useSSEContext must be used within an SSEProvider');
  }
  return context;
}

/**
 * Hook to subscribe to policy updates.
 * Automatically unsubscribes when the component unmounts.
 */
export function usePolicyUpdates(callback: (event: SSEEvent) => void, deps: React.DependencyList = []) {
  const { subscribeToPolicyUpdates } = useSSEContext();
  
  React.useEffect(() => {
    return subscribeToPolicyUpdates(callback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeToPolicyUpdates, ...deps]);
}

/**
 * Hook to subscribe to entity updates.
 * Automatically unsubscribes when the component unmounts.
 */
export function useEntityUpdates(callback: (event: SSEEvent) => void, deps: React.DependencyList = []) {
  const { subscribeToEntityUpdates } = useSSEContext();
  
  React.useEffect(() => {
    return subscribeToEntityUpdates(callback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeToEntityUpdates, ...deps]);
}

export default SSEProvider;

