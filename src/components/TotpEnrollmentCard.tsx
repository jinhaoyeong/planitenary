import { useCallback, useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  cleanupUnverifiedTotpFactors,
  getMfaStatus,
  TOTP_CODE_PATTERN,
  verifyTotpCode,
} from '../lib/authSecurity';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type EnrollDraft = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type TotpEnrollmentCardProps = {
  /** When true, hide the disable controls and keep copy focused on first-time setup. */
  setupOnly?: boolean;
  onEnabled?: () => void;
};

export function TotpEnrollmentCard({ setupOnly = false, onEnabled }: TotpEnrollmentCardProps) {
  const { user, isDemoUser, isLocalTestUser, refreshMfaStatus } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [enrollDraft, setEnrollDraft] = useState<EnrollDraft | null>(null);
  const [enrollCode, setEnrollCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const cloudAccount = Boolean(user && isSupabaseConfigured() && !isDemoUser && !isLocalTestUser);

  const loadMfa = useCallback(async () => {
    if (!cloudAccount) {
      setMfaEnabled(false);
      setFactorId(null);
      setMfaLoading(false);
      return;
    }

    setMfaLoading(true);
    try {
      const mfa = await getMfaStatus();
      setMfaEnabled(mfa.isEnabled);
      setFactorId(mfa.verifiedFactors[0]?.id ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load two-factor settings.');
    } finally {
      setMfaLoading(false);
    }
  }, [cloudAccount]);

  useEffect(() => {
    void loadMfa();
  }, [loadMfa]);

  const run = async (name: string, task: () => Promise<string>) => {
    setBusy(name);
    setStatus(null);
    try {
      setStatus(await task());
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Unable to update authenticator settings.';
      setStatus(message);
    } finally {
      setBusy(null);
    }
  };

  const startEnrollment = () =>
    void run('enroll-mfa', async () => {
      if (!cloudAccount) {
        throw new Error('Sign in with a cloud account (not Demo Mode) to enable 2FA.');
      }
      const existing = await getMfaStatus();
      if (existing.isEnabled) {
        setMfaEnabled(true);
        setFactorId(existing.verifiedFactors[0]?.id ?? null);
        await refreshMfaStatus();
        onEnabled?.();
        return 'Two-factor authentication is already enabled on this account.';
      }
      if (existing.unverifiedFactors.length > 0) {
        await cleanupUnverifiedTotpFactors(existing.unverifiedFactors);
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Authenticator ${new Date().toISOString()}`,
      });
      if (error) throw error;
      if (!data?.id || !data.totp) throw new Error('Unable to start authenticator enrollment. Confirm TOTP MFA is enabled in Supabase.');
      setEnrollDraft({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
      return 'Scan the QR code with your authenticator app, then enter the 6-digit code below.';
    });

  return (
    <div className="rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <Smartphone className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl leading-none">Two-factor authentication</h3>
        </div>
        {!mfaLoading && (
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
            style={{
              background: mfaEnabled ? 'var(--accent)' : 'var(--bg-elevated, var(--bg))',
              color: mfaEnabled ? 'var(--accent-ink)' : 'var(--ink-muted)',
              border: mfaEnabled ? 'none' : '1px solid var(--border)',
            }}
          >
            {mfaEnabled ? 'On' : 'Off'}
          </span>
        )}
      </div>

      {!cloudAccount && (
        <p className="mt-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
          Available on cloud accounts only.
        </p>
      )}

      {status && (
        <div className="mt-3 rounded-2xl px-3 py-2 text-sm" style={{ background: 'var(--bg-elevated, var(--bg))', border: '1px solid var(--border)' }}>
          {status}
        </div>
      )}

      {mfaLoading ? (
        <p className="text-sm mt-4" style={{ color: 'var(--ink-muted)' }}>Loading…</p>
      ) : mfaEnabled ? (
        !setupOnly && (
          <div className="mt-4 space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="editorial-input"
              placeholder="Authenticator code"
              disabled={!cloudAccount || busy !== null}
            />
            <button
              disabled={!cloudAccount || !factorId || !TOTP_CODE_PATTERN.test(disableCode) || busy !== null}
              className="pill-btn pill-soft w-full justify-center"
              onClick={() =>
                void run('disable-mfa', async () => {
                  if (!factorId) throw new Error('No authenticator factor found.');
                  await verifyTotpCode(factorId, disableCode);
                  const { error } = await supabase.auth.mfa.unenroll({ factorId });
                  if (error) throw error;
                  setDisableCode('');
                  setMfaEnabled(false);
                  setFactorId(null);
                  await refreshMfaStatus();
                  return '2FA disabled.';
                })
              }
            >
              {busy === 'disable-mfa' ? 'Disabling…' : 'Disable 2FA'}
            </button>
          </div>
        )
      ) : enrollDraft ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Scan the QR code, then enter the 6-digit code.
          </p>
          {enrollDraft.qrCode && (
            <img
              src={enrollDraft.qrCode}
              alt="Authenticator QR code"
              className="mx-auto w-48 h-48 rounded-2xl bg-white p-3"
            />
          )}
          <p className="text-xs break-all" style={{ color: 'var(--ink-muted)' }}>
            Manual key: <span className="font-mono">{enrollDraft.secret}</span>
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={enrollCode}
            onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="editorial-input"
            placeholder="6-digit code"
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              disabled={!TOTP_CODE_PATTERN.test(enrollCode) || busy !== null}
              className="pill-btn pill-primary w-full justify-center"
              onClick={() =>
                void run('verify-mfa', async () => {
                  await verifyTotpCode(enrollDraft.factorId, enrollCode);
                  setEnrollDraft(null);
                  setEnrollCode('');
                  setMfaEnabled(true);
                  setFactorId(enrollDraft.factorId);
                  await refreshMfaStatus();
                  onEnabled?.();
                  return '2FA enabled.';
                })
              }
            >
              {busy === 'verify-mfa' ? 'Verifying…' : 'Enable'}
            </button>
            <button
              disabled={busy !== null}
              className="pill-btn pill-soft w-full justify-center"
              onClick={() =>
                void run('cancel-mfa', async () => {
                  await supabase.auth.mfa.unenroll({ factorId: enrollDraft.factorId });
                  setEnrollDraft(null);
                  setEnrollCode('');
                  return 'Setup cancelled.';
                })
              }
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          disabled={!cloudAccount || busy !== null}
          className="pill-btn pill-primary w-full justify-center mt-4"
          onClick={startEnrollment}
        >
          {busy === 'enroll-mfa' ? 'Starting…' : 'Enable 2FA'}
        </button>
      )}
    </div>
  );
}
