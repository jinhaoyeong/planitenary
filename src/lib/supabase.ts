import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configuredAuthRedirectUrl = import.meta.env.VITE_SUPABASE_AUTH_REDIRECT_URL;

const normalizeSupabaseUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return undefined;

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+(auth|rest)\/v1\/?$/i, '').replace(/\/+$/, '');
  }
};

const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

// Use harmless placeholder values when env vars are missing so the UI can still boot.
const fallbackUrl = 'https://placeholder-project.supabase.co';
const fallbackAnonKey = 'placeholder-anon-key';

export const supabase = createClient(
  supabaseUrl ?? fallbackUrl,
  hasSupabaseConfig ? supabaseAnonKey : fallbackAnonKey
);

export const isSupabaseConfigured = () => {
  return hasSupabaseConfig;
};

const trimRedirectUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim().replace(/^['"]|['"]$/g, '');
  return trimmed || undefined;
};

const isHttpUrl = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

const looksLikeHostname = (value: string): boolean => {
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(value);
};

const resolveRedirectUrl = (value: string | undefined, currentOrigin?: string): string | undefined => {
  const sanitizedValue = trimRedirectUrl(value);
  if (!sanitizedValue) return currentOrigin;

  try {
    if (isHttpUrl(sanitizedValue)) {
      return new URL(sanitizedValue).toString();
    }

    if (looksLikeHostname(sanitizedValue)) {
      return new URL(`https://${sanitizedValue}`).toString();
    }

    if (currentOrigin) {
      return new URL(sanitizedValue, currentOrigin).toString();
    }
  } catch {
    // Fall through to the safe default below.
  }

  return currentOrigin;
};

// Where Supabase sends users after they click an email verification / magic link.
// Priority: explicit env override -> the current site origin -> undefined (let Supabase
// fall back to the Site URL configured in the dashboard). We never hardcode a domain so
// links always return to wherever the app is actually running. Note: whatever URL this
// resolves to must also be added to the Supabase "Redirect URLs" allow-list, otherwise
// Supabase ignores it and redirects to the dashboard's Site URL instead.
export const getAuthRedirectUrl = (): string | undefined => {
  const currentOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined;
  return resolveRedirectUrl(configuredAuthRedirectUrl, currentOrigin);
};
