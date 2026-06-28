import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configuredAuthRedirectUrl = import.meta.env.VITE_SUPABASE_AUTH_REDIRECT_URL;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

// Use harmless placeholder values when env vars are missing so the UI can still boot.
const fallbackUrl = 'https://placeholder-project.supabase.co';
const fallbackAnonKey = 'placeholder-anon-key';

export const supabase = createClient(
  hasSupabaseConfig ? supabaseUrl : fallbackUrl,
  hasSupabaseConfig ? supabaseAnonKey : fallbackAnonKey
);

export const isSupabaseConfigured = () => {
  return hasSupabaseConfig;
};

// Where Supabase sends users after they click an email verification / magic link.
// Priority: explicit env override -> the current site origin -> undefined (let Supabase
// fall back to the Site URL configured in the dashboard). We never hardcode a domain so
// links always return to wherever the app is actually running. Note: whatever URL this
// resolves to must also be added to the Supabase "Redirect URLs" allow-list, otherwise
// Supabase ignores it and redirects to the dashboard's Site URL instead.
export const getAuthRedirectUrl = (): string | undefined => {
  if (configuredAuthRedirectUrl) {
    return configuredAuthRedirectUrl;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return undefined;
};
