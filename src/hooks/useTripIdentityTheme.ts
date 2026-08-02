import { useEffect } from 'react';
import { profileCountryProfile, sanitizeTripProfile } from '../lib/tripProfile';

/**
 * Paints the destination's accent identity over the base theme so each
 * handbook feels designed for its journey. Layout and typography stay put.
 */
/** Relative luminance, used to keep text legible on any generated accent. */
function readableInk(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#0F0E0D';
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.45 ? '#0F0E0D' : '#FFFFFF';
}

export function useTripIdentityTheme(rawProfile: unknown, theme: 'light' | 'dark') {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
      root.style.removeProperty('--accent-ink');
    };

    const profile = sanitizeTripProfile(rawProfile);
    if (!profile || !profile.applyVisualIdentity) {
      clear();
      return clear;
    }

    const { palette } = profileCountryProfile(profile);
    const accent = theme === 'dark' ? palette.darkAccent : palette.accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-soft', theme === 'dark' ? palette.darkAccentSoft : palette.accentSoft);
    root.style.setProperty('--accent-ink', readableInk(accent));

    return clear;
  }, [rawProfile, theme]);
}
