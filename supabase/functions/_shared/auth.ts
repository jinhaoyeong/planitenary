import { createClient } from '@supabase/supabase-js';
import { bearerToken, isAnonymousUser } from './authPrimitives.ts';

export { bearerToken, isAnonymousUser } from './authPrimitives.ts';

export interface VerifiedCaller {
  userId: string;
  isAnonymous: false;
}

export type AuthenticationResult =
  | { ok: true; caller: VerifiedCaller }
  | { ok: false; status: 401 | 503; detail: string };

/**
 * Establish identity inside the Edge Function.
 *
 * `verify_jwt` at the gateway remains useful defense-in-depth, but this call is
 * what gives the business handler a verified user id and lets it reject
 * anonymous sessions explicitly.
 */
export async function authenticateRequest(request: Request): Promise<AuthenticationResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, detail: 'Authentication required.' };

  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  if (!url || !anonKey) {
    return { ok: false, status: 503, detail: 'Authentication is not configured.' };
  }

  try {
    const client = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || isAnonymousUser(data.user)) {
      return { ok: false, status: 401, detail: 'Authentication required.' };
    }
    return { ok: true, caller: { userId: data.user.id, isAnonymous: false } };
  } catch {
    return { ok: false, status: 401, detail: 'Authentication required.' };
  }
}
