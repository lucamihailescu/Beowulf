import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import {
  PublicClientApplication,
  AccountInfo,
  AuthenticationResult,
  InteractionStatus,
} from '@azure/msal-browser';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { createMsalConfig, loginRequest, isAuthEnabled, isJWTAuth, isKerberosAuth, isLDAPAuth, fetchAuthConfig, getIdentityProvider } from './msalConfig';
import { configureAuth, api } from '../api';

// User info type
export interface UserInfo {
  id: string;
  name: string;
  email: string;
  groups: string[];
}

// LDAP token storage key
const LDAP_TOKEN_KEY = 'cedar_ldap_token';
const LDAP_USER_KEY = 'cedar_ldap_user';

// Auth context type
interface AuthContextType {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username?: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  authMode: 'jwt' | 'kerberos' | 'ldap' | 'none';
  showLoginForm?: boolean;
  loginError?: string;
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
  } else {
    // Check if we have signed-in accounts
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
      msalInstance.setActiveAccount(accounts[0]);
    }
  }
  
  return msalInstance;
};

// MSAL Auth Provider (for JWT mode)
const MSALAuthContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<UserInfo | null>(null);
  const tokenGetterRef = useRef<() => Promise<string | null>>(() => Promise.resolve(null));
  const loginRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const apiConfigured = useRef(false);

  // Loading is true while MSAL is processing (e.g., handling redirect)
  const isLoading = inProgress !== InteractionStatus.None;

  const sessionLogged = useRef(false);

  useEffect(() => {
    if (isAuthenticated && accounts.length > 0) {
      const account = accounts[0];
      setUser({
        id: account.username || account.localAccountId,
        name: account.name || 'Unknown',
        email: account.username || '',
        groups: [],
      });

      // Log session to audit trail (only once per session)
      if (!sessionLogged.current) {
        sessionLogged.current = true;
        // Delay slightly to ensure token is available
        setTimeout(async () => {
          try {
            const token = await tokenGetterRef.current();
            if (token) {
              await api.getSession();
            }
          } catch (e) {
            console.warn('Failed to log session:', e);
          }
        }, 500);
      }
    } else {
      setUser(null);
      sessionLogged.current = false;
    }
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
      // Use ID token for our backend API (has client_id as audience)
      // Access token is for Microsoft Graph API (has graph.microsoft.com as audience)
      return response.idToken || response.accessToken;
    } catch (error) {
      // NOTE: Do NOT automatically redirect here. This causes infinite loops if the silent request fails
      // (e.g. due to browser blocking 3rd party cookies or extensions like password managers interfering).
      // Instead, return null and let the API layer handle the 401 response by calling onAuthError if needed.
      console.warn('Silent token acquisition failed:', error);
      return null;
    }
  }, [instance, accounts, isAuthenticated]);

  // Keep refs updated with latest functions
  useLayoutEffect(() => {
    tokenGetterRef.current = getAccessToken;
  }, [getAccessToken]);

  useLayoutEffect(() => {
    loginRef.current = login;
  }, [login]);

  // Configure API client once with stable wrapper functions
  // Use useLayoutEffect to ensure this runs before child components mount and make API calls
  useLayoutEffect(() => {
    if (!apiConfigured.current) {
      configureAuth({
        getToken: () => tokenGetterRef.current(),
        onAuthError: () => loginRef.current(),
      });
      apiConfigured.current = true;
    }
  }, []);

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
  // Use useLayoutEffect to ensure this runs before child components mount and make API calls
  useLayoutEffect(() => {
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

// LDAP Auth Provider (for LDAP/AD mode)
const LDAPAuthContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginError, setLoginError] = useState<string | undefined>();
  const apiConfigured = useRef(false);

  // Check for existing token on mount
  useEffect(() => {
    const storedToken = sessionStorage.getItem(LDAP_TOKEN_KEY);
    const storedUser = sessionStorage.getItem(LDAP_USER_KEY);

    if (storedToken && storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        setUser(userData);
      } catch {
        // Invalid stored user, clear it
        sessionStorage.removeItem(LDAP_TOKEN_KEY);
        sessionStorage.removeItem(LDAP_USER_KEY);
        setShowLoginForm(true);
      }
    } else {
      setShowLoginForm(true);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (username?: string, password?: string) => {
    if (!username || !password) {
      setShowLoginForm(true);
      return;
    }

    setIsLoading(true);
    setLoginError(undefined);

    try {
      const result = await api.ldapAuth({ username, password });
      
      // Store token and user
      sessionStorage.setItem(LDAP_TOKEN_KEY, result.token);
      
      const userData: UserInfo = {
        id: result.user.username,
        name: result.user.display_name || result.user.username,
        email: result.user.email,
        groups: result.user.groups,
      };
      sessionStorage.setItem(LDAP_USER_KEY, JSON.stringify(userData));
      
      setUser(userData);
      setShowLoginForm(false);
    } catch (error: any) {
      console.error('LDAP login failed:', error);
      setLoginError(error.message || 'Authentication failed');
      setShowLoginForm(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    sessionStorage.removeItem(LDAP_TOKEN_KEY);
    sessionStorage.removeItem(LDAP_USER_KEY);
    setUser(null);
    setShowLoginForm(true);
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    return sessionStorage.getItem(LDAP_TOKEN_KEY);
  }, []);

  // Configure API client once - token getter reads from sessionStorage which is always current
  // Use useLayoutEffect to ensure this runs before child components mount and make API calls
  useLayoutEffect(() => {
    if (!apiConfigured.current) {
      configureAuth({
        getToken: getAccessToken,
        onAuthError: () => {
          // Token expired or invalid, show login form
          sessionStorage.removeItem(LDAP_TOKEN_KEY);
          sessionStorage.removeItem(LDAP_USER_KEY);
          setUser(null);
          setShowLoginForm(true);
        },
      });
      apiConfigured.current = true;
    }
  }, [getAccessToken]);

  const contextValue = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
      getAccessToken,
      authMode: 'ldap' as const,
      showLoginForm,
      loginError,
    }),
    [user, isLoading, login, logout, getAccessToken, showLoginForm, loginError]
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

  // Check if LDAP is enabled (AD identity provider)
  if (isLDAPAuth()) {
    const idp = getIdentityProvider();
    // If Kerberos is also enabled, prefer Kerberos for SSO
    if (idp?.auth_method === 'ldap+kerberos') {
      return <KerberosAuthContent>{children}</KerberosAuthContent>;
    }
    return <LDAPAuthContent>{children}</LDAPAuthContent>;
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

