import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  PublicClientApplication,
  AccountInfo,
  InteractionRequiredAuthError,
  AuthenticationResult,
} from '@azure/msal-browser';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { createMsalConfig, loginRequest, isAuthEnabled, isJWTAuth, isKerberosAuth, fetchAuthConfig } from './msalConfig';
import { configureAuth } from '../api';

// User info type
export interface UserInfo {
  id: string;
  name: string;
  email: string;
  groups: string[];
}

// Auth context type
interface AuthContextType {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  authMode: 'jwt' | 'kerberos' | 'none';
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// MSAL instance - will be created after config is fetched
let msalInstance: PublicClientApplication | null = null;

// Initialize MSAL with dynamic config
const initializeMsal = async (): Promise<PublicClientApplication> => {
  // First, fetch dynamic auth config from backend
  await fetchAuthConfig();
  
  // Create MSAL instance with effective config
  const config = createMsalConfig();
  msalInstance = new PublicClientApplication(config);
  
  await msalInstance.initialize();
  // Handle redirect response
  const response = await msalInstance.handleRedirectPromise();
  if (response) {
    msalInstance.setActiveAccount(response.account);
  }
  
  return msalInstance;
};

// MSAL Auth Provider (for JWT mode)
const MSALAuthContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const apiConfigured = useRef(false);

  useEffect(() => {
    if (isAuthenticated && accounts.length > 0) {
      const account = accounts[0];
      setUser({
        id: account.username || account.localAccountId,
        name: account.name || 'Unknown',
        email: account.username || '',
        groups: [],
      });
    } else {
      setUser(null);
    }
    setIsLoading(false);
  }, [isAuthenticated, accounts]);

  const login = useCallback(async () => {
    try {
      await instance.loginRedirect(loginRequest);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }, [instance]);

  const logout = useCallback(async () => {
    try {
      await instance.logoutRedirect({
        postLogoutRedirectUri: window.location.origin,
      });
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }, [instance]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!isAuthenticated || accounts.length === 0) {
      return null;
    }

    try {
      const account = accounts[0] as AccountInfo;
      const response: AuthenticationResult = await instance.acquireTokenSilent({
        ...loginRequest,
        account,
      });
      return response.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        // Silent token acquisition failed, need interactive login
        await instance.acquireTokenRedirect(loginRequest);
        return null;
      }
      console.error('Token acquisition failed:', error);
      return null;
    }
  }, [instance, accounts, isAuthenticated]);

  // Configure API client with token getter
  useEffect(() => {
    if (!apiConfigured.current) {
      configureAuth({
        getToken: getAccessToken,
        onAuthError: login,
      });
      apiConfigured.current = true;
    }
  }, [getAccessToken, login]);

  const contextValue = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      login,
      logout,
      getAccessToken,
      authMode: 'jwt' as const,
    }),
    [user, isAuthenticated, isLoading, login, logout, getAccessToken]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

// Kerberos Auth Provider (for Kerberos/SPNEGO mode)
const KerberosAuthContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const apiConfigured = useRef(false);

  useEffect(() => {
    // For Kerberos, we fetch user info from the backend
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/v1/me', {
          credentials: 'include', // Include cookies/credentials for SPNEGO
        });
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('Failed to fetch user info:', error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, []);

  const login = useCallback(async () => {
    // For Kerberos, authentication happens automatically via browser
    // Just reload the page to trigger SPNEGO
    window.location.reload();
  }, []);

  const logout = useCallback(async () => {
    // For Kerberos, there's no real logout - just clear local state
    setUser(null);
    // Optionally redirect to a logout page or reload
    window.location.href = '/';
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    // Kerberos uses cookies/SPNEGO, no explicit token needed
    return null;
  }, []);

  // Configure API client for Kerberos (no token, uses credentials: include)
  useEffect(() => {
    if (!apiConfigured.current) {
      configureAuth({
        getToken: async () => null,
        onAuthError: login,
      });
      apiConfigured.current = true;
    }
  }, [login]);

  const contextValue = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
      getAccessToken,
      authMode: 'kerberos' as const,
    }),
    [user, isLoading, login, logout, getAccessToken]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

// No-Auth Provider (auth disabled)
const NoAuthContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const contextValue = useMemo(
    () => ({
      user: { id: 'anonymous', name: 'Anonymous User', email: '', groups: [] },
      isAuthenticated: true,
      isLoading: false,
      login: async () => {},
      logout: async () => {},
      getAccessToken: async () => null,
      authMode: 'none' as const,
    }),
    []
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

// Main Auth Provider component
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [msalReady, setMsalReady] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [msalApp, setMsalApp] = useState<PublicClientApplication | null>(null);

  useEffect(() => {
    // Always fetch config first, then decide auth mode
    const init = async () => {
      await fetchAuthConfig();
      setConfigLoaded(true);
      
      // If JWT/Entra auth is enabled (either via env or dynamic config), initialize MSAL
      if (isJWTAuth()) {
        const instance = await initializeMsal();
        setMsalApp(instance);
      }
      setMsalReady(true);
    };
    
    init();
  }, []);

  if (!configLoaded || !msalReady) {
    return null; // Or a loading spinner
  }

  if (!isAuthEnabled()) {
    return <NoAuthContent>{children}</NoAuthContent>;
  }

  if (isKerberosAuth()) {
    return <KerberosAuthContent>{children}</KerberosAuthContent>;
  }

  if (isJWTAuth() && msalApp) {
    return (
      <MsalProvider instance={msalApp}>
        <MSALAuthContent>{children}</MSALAuthContent>
      </MsalProvider>
    );
  }

  // Fallback to no auth
  return <NoAuthContent>{children}</NoAuthContent>;
};

// Hook to use auth context
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

