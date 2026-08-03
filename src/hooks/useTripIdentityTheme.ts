import { useEffect } from 'react';
import { sanitizeTripProfile } from '../lib/tripProfile';
import {
  applyVisualIdentityCss,
  clearVisualIdentityCss,
  resolveVisualIdentity,
} from '../lib/visualIdentity';

/**
 * Applies the Adaptive Destination Design System tokens for the open trip.
 * Intensity "off" clears overrides so the base editorial theme returns.
 * Layout structure stays stable — only approved CSS variables change.
 */
export function useTripIdentityTheme(rawProfile: unknown, theme: 'light' | 'dark') {
  useEffect(() => {
    const root = document.documentElement;
    const profile = sanitizeTripProfile(rawProfile);

    if (!profile) {
      clearVisualIdentityCss(root);
      return () => clearVisualIdentityCss(root);
    }

    const resolved = resolveVisualIdentity(profile, { theme });
    applyVisualIdentityCss(resolved, root);

    return () => clearVisualIdentityCss(root);
  }, [rawProfile, theme]);
}
