/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { applyThemeClass, syncAppChrome } from '../lib/nativeChrome';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const readInitialTheme = (): Theme => {
  const savedTheme = localStorage.getItem('theme') as Theme | null;
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const cloudReadyRef = useRef(false);
  const manualThemeAtRef = useRef(0);
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = readInitialTheme();
    // Paint before first paint of children whenever possible.
    applyThemeClass(initial);
    return initial;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    applyThemeClass(theme);

    const applyChrome = () => {
      void syncAppChrome(theme);
    };
    applyChrome();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') applyChrome();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', applyChrome);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', applyChrome);
    };
  }, [theme]);

  useEffect(() => {
    cloudReadyRef.current = false;
    if (!user) return;

    const accountKey = `theme-${user.id}`;
    const globalTheme = localStorage.getItem('theme') as Theme | null;
    const accountTheme = localStorage.getItem(accountKey) as Theme | null;
    // Prefer the most recent manual global preference so a toggle isn't undone
    // after sign-in / cloud fetch.
    const preferred =
      globalTheme === 'light' || globalTheme === 'dark'
        ? globalTheme
        : accountTheme === 'light' || accountTheme === 'dark'
          ? accountTheme
          : null;
    if (preferred) setTheme(preferred);

    if (!isSupabaseConfigured() || isDemoUser || isLocalTestUser) {
      cloudReadyRef.current = true;
      return;
    }

    let mounted = true;
    void supabase.from('user_preferences').select('theme').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Failed to load cloud theme preference:', error);

      // Don't clobber a theme the user just toggled in this session.
      if (Date.now() - manualThemeAtRef.current < 15_000) {
        cloudReadyRef.current = true;
        return;
      }

      const cloudTheme = data?.theme;
      if (cloudTheme === 'light' || cloudTheme === 'dark') {
        const localOverride = localStorage.getItem('theme') as Theme | null;
        if (localOverride === 'light' || localOverride === 'dark') {
          // Keep local manual choice; push it up on the save effect.
          setTheme(localOverride);
        } else {
          setTheme(cloudTheme);
          localStorage.setItem(accountKey, cloudTheme);
        }
      }
      cloudReadyRef.current = true;
    });
    return () => {
      mounted = false;
    };
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
    const newTheme = theme === 'light' ? 'dark' : 'light';
    manualThemeAtRef.current = Date.now();
    localStorage.setItem('theme', newTheme);
    if (user) localStorage.setItem(`theme-${user.id}`, newTheme);
    // Immediate paint — don't wait for React commit / effects.
    void syncAppChrome(newTheme);
    setTheme(newTheme);
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
