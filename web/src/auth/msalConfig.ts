import { Configuration, LogLevel } from '@azure/msal-browser';

// Get configuration from environment variables (via Vite)
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID || '';
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID || '';
const redirectUri = import.meta.env.VITE_REDIRECT_URI || window.location.origin;
const authMode = import.meta.env.VITE_AUTH_MODE || 'none';

// Check if auth is enabled
export const isAuthEnabled = (): boolean => {
  return authMode !== 'none' && authMode !== '';
};

// Check if we're using JWT/Entra ID auth
export const isJWTAuth = (): boolean => {
  return authMode === 'jwt';
};

// Check if we're using Kerberos auth
export const isKerberosAuth = (): boolean => {
  return authMode === 'kerberos';
};

// MSAL configuration for Entra ID
export const msalConfig: Configuration = {
  auth: {
    clientId: clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: redirectUri,
    postLogoutRedirectUri: redirectUri,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: 'sessionStorage', // Use sessionStorage for better security
    storeAuthStateInCookie: false, // Set to true if you have issues in IE11/Edge
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            return;
          case LogLevel.Warning:
            console.warn(message);
            return;
          case LogLevel.Info:
            // Uncomment for debugging
            // console.info(message);
            return;
          case LogLevel.Verbose:
            // Uncomment for debugging
            // console.debug(message);
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
  scopes: clientId ? [`api://${clientId}/access_as_user`] : [],
};

// Silent token request configuration
export const silentRequest = {
  scopes: loginRequest.scopes,
  forceRefresh: false,
};

