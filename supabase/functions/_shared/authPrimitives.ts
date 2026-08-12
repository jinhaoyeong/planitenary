import type { User } from '@supabase/supabase-js';

/** Return the bearer value only when the request carries a usable session. */
export function bearerToken(request: Request): string | null {
  const value = request.headers.get('Authorization')?.trim() || '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || null;
}

/** Anonymous accounts carry this server-provided flag; never infer identity from metadata. */
export function isAnonymousUser(user: User): boolean {
  return (user as User & { is_anonymous?: boolean }).is_anonymous === true;
}
