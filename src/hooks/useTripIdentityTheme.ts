import { useEffect } from 'react';
import { profileCountryProfile, sanitizeTripProfile } from '../lib/tripProfile';

/**
 * Paints the destination's accent identity over the base theme so each
 * handbook feels designed for its journey. Layout and typography stay put.
 */
export function useTripIdentityTheme(rawProfile: unknown, theme: 'light' | 'dark') {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    };

    const profile = sanitizeTripProfile(rawProfile);
    if (!profile || !profile.applyVisualIdentity) {
      clear();
      return clear;
    }

    const { palette } = profileCountryProfile(profile);
    root.style.setProperty('--accent', theme === 'dark' ? palette.darkAccent : palette.accent);
    root.style.setProperty('--accent-soft', theme === 'dark' ? palette.darkAccentSoft : palette.accentSoft);

    return clear;
  }, [rawProfile, theme]);
}
