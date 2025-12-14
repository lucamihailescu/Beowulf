import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  mode: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'cedar-theme-mode';

// Get initial theme from localStorage or system preference
const getInitialTheme = (): ThemeMode => {
  // Check localStorage first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  
  // Fall back to system preference
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  
  return 'light';
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>(getInitialTheme);

  // Persist theme to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    
    // Update document class for CSS variables
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(mode);
    
    // Update body background for seamless experience
    document.body.style.background = mode === 'dark' ? '#141414' : '#f5f7fb';
  }, [mode]);

  const toggleTheme = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const setTheme = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
  }, []);

  const contextValue = useMemo(
    () => ({
      mode,
      toggleTheme,
      setTheme,
      isDark: mode === 'dark',
    }),
    [mode, toggleTheme, setTheme]
  );

  // Ant Design theme configuration
  const themeConfig = useMemo(
    () => ({
      algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        // Custom primary color - a nice teal/cyan that works in both modes
        colorPrimary: '#0891b2',
        // Border radius for modern look
        borderRadius: 6,
        // Better font stack
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
      components: {
        Layout: {
          // Sidebar and layout colors
          siderBg: mode === 'dark' ? '#1f1f1f' : '#ffffff',
          headerBg: mode === 'dark' ? '#1f1f1f' : '#ffffff',
          bodyBg: mode === 'dark' ? '#141414' : '#f5f7fb',
        },
        Menu: {
          // Menu colors
          itemBg: 'transparent',
          subMenuItemBg: 'transparent',
        },
      },
    }),
    [mode]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <ConfigProvider theme={themeConfig}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
};

// Hook to use theme context
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export default ThemeProvider;

