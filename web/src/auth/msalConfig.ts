import { Configuration, LogLevel } from '@azure/msal-browser';
import { EntraAuthConfig, IdentityProvider } from '../api';

// Get configuration from environment variables (via Vite)
const envTenantId = import.meta.env.VITE_AZURE_TENANT_ID || '';
const envClientId = import.meta.env.VITE_AZURE_CLIENT_ID || '';
const envRedirectUri = import.meta.env.VITE_REDIRECT_URI || window.location.origin;
const envAuthMode = import.meta.env.VITE_AUTH_MODE || 'none';

// Dynamic config from backend (will be populated by fetchAuthConfig)
let dynamicConfig: EntraAuthConfig | null = null;
let identityProvider: IdentityProvider | null = null;

// Fetch dynamic auth config from backend
export const fetchAuthConfig = async (): Promise<EntraAuthConfig | null> => {
  try {
    // Fetch identity provider first
    const idpResponse = await fetch('/api/v1/identity-provider');
    if (idpResponse.ok) {
      identityProvider = await idpResponse.json();
    }

    // Only fetch Entra config if Entra is the active provider
    if (identityProvider?.provider === 'entra') {
      const response = await fetch('/api/v1/auth/config');
      if (response.ok) {
        dynamicConfig = await response.json();
        return dynamicConfig;
      }
    }
  } catch (error) {
    console.warn('Failed to fetch auth config, using env vars:', error);
  }
  return null;
};

// Get the current identity provider
export const getIdentityProvider = (): IdentityProvider | null => identityProvider;

// Get effective config values
const getEffectiveConfig = () => {
  // ALWAYS use current window origin as redirect URI to avoid mismatch errors
  // The user may access the app from different URLs (localhost:5173, localhost:8080, etc.)
  const currentOrigin = window.location.origin;
  
  if (dynamicConfig?.enabled) {
    return {
      tenantId: dynamicConfig.tenant_id || '',
      clientId: dynamicConfig.client_id || '',
      redirectUri: currentOrigin,
      authority: dynamicConfig.authority || `https://login.microsoftonline.com/${dynamicConfig.tenant_id}`,
    };
  }
  return {
    tenantId: envTenantId,
    clientId: envClientId,
    redirectUri: currentOrigin,
    authority: `https://login.microsoftonline.com/${envTenantId}`,
  };
};

// Check if auth is enabled (either via env or dynamic config)
export const isAuthEnabled = (): boolean => {
  // Check env var first
  if (envAuthMode !== 'none' && envAuthMode !== '') {
    return true;
  }
  // Check if AD is enabled via database
  if (identityProvider?.provider === 'ad') {
    return true;
  }
  // Check if Entra is enabled via database
  if (identityProvider?.provider === 'entra' && dynamicConfig?.enabled) {
    return true;
  }
  return false;
};

// Check if we're using JWT/Entra ID auth
export const isJWTAuth = (): boolean => {
  // Check env var
  if (envAuthMode === 'jwt') {
    return true;
  }
  // Check database config
  if (identityProvider?.provider === 'entra' && dynamicConfig?.enabled) {
    return true;
  }
  return false;
};

// Check if we're using Kerberos auth
export const isKerberosAuth = (): boolean => {
  // AD with Kerberos enabled
  if (identityProvider?.provider === 'ad' && identityProvider?.auth_method === 'ldap+kerberos') {
    return true;
  }
  return envAuthMode === 'kerberos' || envAuthMode === 'ldap+kerberos';
};

// Check if we're using LDAP auth
export const isLDAPAuth = (): boolean => {
  if (identityProvider?.provider === 'ad') {
    // AD is enabled - use LDAP (possibly with Kerberos fallback)
    return true;
  }
  return envAuthMode === 'ldap' || envAuthMode === 'ldap+kerberos';
};

// Create MSAL config dynamically
export const createMsalConfig = (): Configuration => {
  const config = getEffectiveConfig();
  return {
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      redirectUri: config.redirectUri,
      postLogoutRedirectUri: config.redirectUri,
      navigateToLoginRequestUrl: true,
    },
    cache: {
      cacheLocation: 'localStorage', // Use localStorage for better persistence
      storeAuthStateInCookie: true,  // Fixes loop issues in many browsers
    },
    system: {
      iframeHashTimeout: 10000,
      windowHashTimeout: 10000,
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return;
          switch (level) {
            case LogLevel.Error:
              console.error(message);
              return;
            case LogLevel.Warning:
              console.warn(message);
              return;
          }
        },
        logLevel: LogLevel.Warning,
        piiLoggingEnabled: false,
      },
    },
  };
};

// Legacy static config (for initial load before dynamic config is fetched)
export const msalConfig: Configuration = {
  auth: {
    clientId: envClientId,
    authority: `https://login.microsoftonline.com/${envTenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: true,
  },
  system: {
    iframeHashTimeout: 10000,
    windowHashTimeout: 10000,
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            return;
          case LogLevel.Warning:
            console.warn(message);
            return;
        }
      },
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
  },
};

// Scopes for API access
export const loginRequest = {
  scopes: ['User.Read', 'openid', 'profile', 'email'],
};

// API scopes for backend calls
export const apiRequest = {
  scopes: envClientId ? [`api://${envClientId}/access_as_user`] : [],
};

// Silent token request configuration
export const silentRequest = {
  scopes: loginRequest.scopes,
  forceRefresh: false,
};

