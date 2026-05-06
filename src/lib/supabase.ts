import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configuredAuthRedirectUrl = import.meta.env.VITE_SUPABASE_AUTH_REDIRECT_URL;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
const fallbackAuthRedirectUrl = 'https://traeitenarywdre.vercel.app';

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

export const getAuthRedirectUrl = () => {
  if (configuredAuthRedirectUrl) {
    return configuredAuthRedirectUrl;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return origin;
    }
  }

  return fallbackAuthRedirectUrl;
};
