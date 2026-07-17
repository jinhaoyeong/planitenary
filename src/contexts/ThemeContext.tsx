/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const cloudReadyRef = useRef(false);
  const [theme, setTheme] = useState<Theme>(() => {
    // 1. Prioritize user's manual selection from localStorage
    const savedTheme = localStorage.getItem('theme') as Theme;
    if (savedTheme) {
      return savedTheme;
    }
    // 2. Fallback to system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Listener for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      // Only follow system if user hasn't manually overridden it
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    // Modern browsers use addEventListener
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    cloudReadyRef.current = false;
    if (!user) return;
    const accountKey = `theme-${user.id}`;
    const accountTheme = localStorage.getItem(accountKey) as Theme | null;
    if (accountTheme === 'light' || accountTheme === 'dark') setTheme(accountTheme);

    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      cloudReadyRef.current = true;
      return;
    }
    let mounted = true;
    void supabase.from('user_preferences').select('theme').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Failed to load cloud theme preference:', error);
      const cloudTheme = data?.theme;
      if (cloudTheme === 'light' || cloudTheme === 'dark') {
        setTheme(cloudTheme);
        localStorage.setItem(accountKey, cloudTheme);
      }
      cloudReadyRef.current = true;
    });
    return () => { mounted = false; };
  }, [user?.id, isDemoUser, isLocalTestUser]);

  useEffect(() => {
    if (!user || !cloudReadyRef.current) return;
    localStorage.setItem(`theme-${user.id}`, theme);
    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) return;
    const timeoutId = window.setTimeout(async () => {
      const { error } = await supabase.from('user_preferences').upsert({
        user_id: user.id,
        theme,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error('Failed to save cloud theme preference:', error);
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [theme, user?.id, isDemoUser, isLocalTestUser]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const newTheme = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      return newTheme;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
