import { describe, expect, it } from 'vitest';
import { bearerToken, isAnonymousUser } from '../../supabase/functions/_shared/authPrimitives';

describe('the authenticated reasoning request helpers', () => {
  it('extracts only a bearer token from the Authorization header', () => {
    expect(bearerToken(new Request('https://example.test', {
      headers: { Authorization: 'bearer session-token' },
    }))).toBe('session-token');
    expect(bearerToken(new Request('https://example.test', {
      headers: { Authorization: 'Basic session-token' },
    }))).toBeNull();
    expect(bearerToken(new Request('https://example.test'))).toBeNull();
  });

  it('uses the server-provided anonymous flag rather than user metadata', () => {
    expect(isAnonymousUser({ id: 'user-1', user_metadata: { is_anonymous: true } } as never)).toBe(false);
    expect(isAnonymousUser({ id: 'user-2', is_anonymous: true } as never)).toBe(true);
  });
});
