// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

/**
 * Signing in has to land the traveller in the app there and then. These cover
 * the ways it used to need a manual reload instead: the state change arriving
 * while the loading gate was still down, the first session read failing, and
 * the MFA lookup being made from inside the callback that Supabase runs while
 * it still holds its auth lock.
 */

type AuthCallback = (event: string, session: Session | null) => void;

const listeners: AuthCallback[] = [];
const getSession = vi.fn();
const getAuthenticatorAssuranceLevel = vi.fn();
const listFactors = vi.fn();

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: (cb: AuthCallback) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => getAuthenticatorAssuranceLevel(),
        listFactors: () => listFactors(),
      },
    },
  },
}));

import { AuthProvider, useAuth } from './AuthContext';

const session = (id: string) =>
  ({ access_token: 't', user: { id, email: `${id}@example.com` } }) as unknown as Session;

const Probe = () => {
  const { user, isLoading, mfaStatusReady, needsMfaVerification } = useAuth();
  return (
    <div>
      <span data-testid="user">{user?.id ?? 'none'}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="ready">{String(mfaStatusReady)}</span>
      <span data-testid="mfa">{String(needsMfaVerification)}</span>
    </div>
  );
};

const emit = (event: string, next: Session | null) => listeners.forEach((cb) => cb(event, next));

beforeEach(() => {
  listeners.length = 0;
  localStorage.clear();
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: null } });
  getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
  listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
});

describe('signing in without a reload', () => {
  it('hands the app a user as soon as the session arrives', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    emit('SIGNED_IN', session('traveller'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('traveller'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(screen.getByTestId('mfa')).toHaveTextContent('false');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('lifts the loading gate even when the first session read never resolved in time', async () => {
    // The gate used to be lowered only by getSession, so a sign-in that beat it
    // left the app spinning until the tab was reloaded.
    let release: ((value: { data: { session: Session | null } }) => void) | undefined;
    getSession.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    emit('SIGNED_IN', session('early'));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('early');
    release?.({ data: { session: null } });
  });

  it('does not strand the app when the first session read fails', async () => {
    getSession.mockRejectedValue(new Error('network down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
    quiet.mockRestore();
  });

  it('reads MFA status outside the callback, so a blocking lookup cannot wedge sign-in', async () => {
    let calledDuringCallback = false;
    let inCallback = false;
    getAuthenticatorAssuranceLevel.mockImplementation(() => {
      if (inCallback) calledDuringCallback = true;
      return Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    inCallback = true;
    emit('SIGNED_IN', session('locked'));
    inCallback = false;

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(calledDuringCallback).toBe(false);
    expect(screen.getByTestId('user')).toHaveTextContent('locked');
  });

  it('holds the signed-in shell back until MFA is known to be satisfied', async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
    listFactors.mockResolvedValue({ data: { totp: [{ id: 'factor-1' }], all: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }] }, error: null });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    emit('SIGNED_IN', session('needs-code'));

    await waitFor(() => expect(screen.getByTestId('mfa')).toHaveTextContent('true'));
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  });
});
