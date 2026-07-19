import type { Factor } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const TOTP_CODE_PATTERN = /^\d{6}$/;

export type MfaStatus = {
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
  /** Verified TOTP factors that can be used for challenges. */
  verifiedFactors: Factor[];
  /** Unverified / incomplete enrollments that should be cleaned up. */
  unverifiedFactors: Factor[];
  /** True when the session must complete an MFA challenge before full access. */
  needsChallenge: boolean;
  /** True when at least one verified TOTP factor is enrolled. */
  isEnabled: boolean;
};

export async function getMfaStatus(): Promise<MfaStatus> {
  const [{ data: aal, error: aalError }, { data: factors, error: factorsError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);

  if (aalError) throw aalError;
  if (factorsError) throw factorsError;

  const verifiedFactors = factors?.totp ?? [];
  const unverifiedFactors = (factors?.all ?? []).filter(
    (factor) => factor.factor_type === 'totp' && factor.status !== 'verified',
  );
  const currentLevel = aal?.currentLevel ?? null;
  const nextLevel = aal?.nextLevel ?? null;
  const needsChallenge = currentLevel === 'aal1' && nextLevel === 'aal2';

  return {
    currentLevel,
    nextLevel,
    verifiedFactors,
    unverifiedFactors,
    needsChallenge,
    isEnabled: verifiedFactors.length > 0,
  };
}

export async function verifyTotpCode(factorId: string, code: string) {
  const trimmed = code.trim();
  if (!TOTP_CODE_PATTERN.test(trimmed)) {
    throw new Error('Enter the 6-digit code from your authenticator app.');
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) throw challengeError;
  if (!challenge?.id) throw new Error('Unable to start the authenticator challenge.');

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: trimmed,
  });
  if (verifyError) throw verifyError;
}

/** Re-check password, then complete MFA when enrolled, before sensitive account updates. */
export async function confirmSensitiveAction(options: {
  email: string;
  currentPassword: string;
  totpCode?: string;
  mfaEnabled: boolean;
  factorId?: string;
}) {
  const { email, currentPassword, totpCode, mfaEnabled, factorId } = options;

  if (!currentPassword) {
    throw new Error('Enter your current password to confirm this change.');
  }

  const { error: passwordError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (passwordError) {
    throw new Error('Current password is incorrect.');
  }

  if (mfaEnabled) {
    if (!factorId) {
      throw new Error('Two-factor authentication is enabled, but no authenticator was found.');
    }
    if (!totpCode?.trim()) {
      throw new Error('Enter your authenticator code to confirm this change.');
    }
    await verifyTotpCode(factorId, totpCode);
  }
}

export async function cleanupUnverifiedTotpFactors(factors: Factor[]) {
  await Promise.all(
    factors.map(async (factor) => {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }),
  );
}
