import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  buildTripThemeStyle,
  mergeTripSettings,
} from './tripSettings';
import type { ThemeMode, TripAppSettings, TripThemeSettings } from './tripSettings';

export interface ShellThemePalettes {
  light: TripThemeSettings;
  dark: TripThemeSettings;
}

export const DEFAULT_SHELL_THEME: ShellThemePalettes = {
  light: { ...DEFAULT_LIGHT_THEME },
  dark: { ...DEFAULT_DARK_THEME },
};

const shellThemeKey = (userId?: string | null) =>
  userId ? `shell-theme-${userId}` : 'shell-theme';

export const saveShellTheme = (userId: string | null | undefined, palettes: ShellThemePalettes) => {
  const next: ShellThemePalettes = {
    light: { ...DEFAULT_LIGHT_THEME, ...palettes.light },
    dark: { ...DEFAULT_DARK_THEME, ...palettes.dark },
  };
  const payload = JSON.stringify(next);
  localStorage.setItem(shellThemeKey(userId), payload);
  // Always mirror to the anonymous key so Dashboard can load before/without user id.
  if (userId) localStorage.setItem(shellThemeKey(null), payload);
  return next;
};

export const loadShellTheme = (userId?: string | null): ShellThemePalettes => {
  try {
    const raw =
      localStorage.getItem(shellThemeKey(userId)) ||
      localStorage.getItem(shellThemeKey(null));
    if (!raw) {
      return {
        light: { ...DEFAULT_LIGHT_THEME },
        dark: { ...DEFAULT_DARK_THEME },
      };
    }
    const parsed = JSON.parse(raw) as Partial<ShellThemePalettes> | null;
    return {
      light: { ...DEFAULT_LIGHT_THEME, ...(parsed?.light || {}) },
      dark: { ...DEFAULT_DARK_THEME, ...(parsed?.dark || {}) },
    };
  } catch {
    return {
      light: { ...DEFAULT_LIGHT_THEME },
      dark: { ...DEFAULT_DARK_THEME },
    };
  }
};

export const shellThemeFromTripSettings = (settings: TripAppSettings): ShellThemePalettes => {
  const merged = mergeTripSettings(settings);
  return {
    light: { ...merged.lightTheme },
    dark: { ...merged.theme },
  };
};

export const getShellPalette = (shellTheme: ShellThemePalettes, mode: ThemeMode) =>
  mode === 'light' ? shellTheme.light : shellTheme.dark;

/** Apply palette CSS variables on the document so Dashboard/Auth inherit them. */
export const applyShellThemeToDocument = (shellTheme: ShellThemePalettes, mode: ThemeMode) => {
  const root = document.documentElement;
  const style = buildTripThemeStyle(getShellPalette(shellTheme, mode), mode);
  Object.entries(style).forEach(([key, value]) => {
    if (typeof value === 'string') root.style.setProperty(key, value);
  });
};
