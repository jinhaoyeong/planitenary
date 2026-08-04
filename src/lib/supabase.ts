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

/**
 * Call a travel intelligence Edge Function.
 *
 * Provider keys live in Supabase function secrets, so every third-party call
 * goes through here rather than the browser. Throws on failure; callers are
 * expected to fall back to a labelled offline path rather than surfacing an
 * error, because a plan should degrade honestly, not disappear.
 */
export async function invokeTravelFunction(name: string, body?: unknown): Promise<unknown> {
  if (!hasSupabaseConfig) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke(name, {
    body: body ?? {},
  });
  if (error) {
    // FunctionsHttpError keeps the response body on `context`. Preserve the
    // provider's safe diagnostic so a 400/403 is distinguishable from an
    // empty destination; never expose request headers or secret values.
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object' && 'clone' in context && typeof context.clone === 'function') {
      let providerMessage: string | undefined;
      try {
        const payload = await (context as Response).clone().json() as { error?: unknown };
        if (typeof payload.error === 'string' && payload.error.trim()) providerMessage = payload.error;
      } catch { /* Some Supabase errors have no JSON response body. */ }
      if (providerMessage) throw new Error(providerMessage);
    }
    throw new Error(error.message || `${name} failed.`);
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data;
}

/**
 * AI is deliberately a named server boundary. The browser can request an
 * interpretation, but never receives or sends a Gemini credential directly.
 */
export async function invokeTravelReasoning(operation: string, input: unknown): Promise<unknown> {
  return invokeTravelFunction('travel-reasoning', { operation, input });
}

export const getSupabaseUserId = async (): Promise<string | null> => {
  if (!hasSupabaseConfig) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
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
  const configured = trimRedirectUrl(configuredAuthRedirectUrl);
  const configuredIsLocalhost = Boolean(
    configured && /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(configured),
  );
  const currentIsDeployed = Boolean(
    currentOrigin && !/^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(currentOrigin),
  );
  return resolveRedirectUrl(configuredIsLocalhost && currentIsDeployed ? currentOrigin : configured, currentOrigin);
};
