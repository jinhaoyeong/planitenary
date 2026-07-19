import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Mail, Phone, ShieldCheck, Smartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  cleanupUnverifiedTotpFactors,
  confirmSensitiveAction,
  getMfaStatus,
  TOTP_CODE_PATTERN,
  verifyTotpCode,
} from '../lib/authSecurity';
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from '../lib/supabase';

const strongPassword = (value: string) => value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value);

type EnrollDraft = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function SecurityPanel() {
  const { user, isDemoUser, isLocalTestUser, refreshMfaStatus } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [otp, setOtp] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  const [actionTotp, setActionTotp] = useState('');
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

  if (!user) return null;

  const run = async (name: string, task: () => Promise<string>) => {
    setBusy(name);
    setStatus(null);
    try {
      setStatus(await task());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update account security.');
    } finally {
      setBusy(null);
    }
  };

  const requireConfirmation = async () => {
    if (!user.email) throw new Error('Your account email is required to confirm this change.');
    await confirmSensitiveAction({
      email: user.email,
      currentPassword,
      totpCode: actionTotp,
      mfaEnabled,
      factorId: factorId ?? undefined,
    });
  };

  const clearSensitiveInputs = () => {
    setCurrentPassword('');
    setActionTotp('');
  };

  return (
    <section className="editorial-card p-4 sm:p-5 md:p-8">
      <div className="eyebrow">Security</div>
      <h2 className="font-display text-3xl sm:text-4xl mt-4">Protect your account.</h2>
      <p className="mt-3 text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
        Enable two-factor authentication and confirm password, email, or phone changes with your current password
        {mfaEnabled ? ' and authenticator code' : ''}.
      </p>

      {!cloudAccount && (
        <div className="mt-5 rounded-2xl p-4 text-sm" style={{ background: 'var(--accent-soft)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          Security changes are available for cloud accounts. Demo and local test accounts remain device-only.
        </div>
      )}
      {status && (
        <div className="mt-5 rounded-2xl p-4 text-sm" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          {status}
        </div>
      )}

      <div className="mt-6 rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-start gap-3">
          <Smartphone className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-2xl">Two-factor authentication</h3>
            <p className="text-sm mt-2" style={{ color: 'var(--ink-muted)' }}>
              Use an authenticator app (Google Authenticator, 1Password, Authy) for sign-in and sensitive account changes.
            </p>

            {mfaLoading ? (
              <p className="text-sm mt-4" style={{ color: 'var(--ink-muted)' }}>Checking authenticator status…</p>
            ) : mfaEnabled ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl px-3 py-2 text-sm font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--ink)' }}>
                  Authenticator app is enabled.
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="editorial-input"
                  placeholder="Code to disable 2FA"
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
                      return 'Two-factor authentication has been disabled.';
                    })
                  }
                >
                  {busy === 'disable-mfa' ? 'Disabling…' : 'Disable authenticator'}
                </button>
              </div>
            ) : enrollDraft ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                  Scan this QR code in your authenticator app, then enter the 6-digit code to finish setup.
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
                  placeholder="6-digit verification code"
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
                        return 'Two-factor authentication is now enabled.';
                      })
                    }
                  >
                    {busy === 'verify-mfa' ? 'Verifying…' : 'Confirm and enable'}
                  </button>
                  <button
                    disabled={busy !== null}
                    className="pill-btn pill-soft w-full justify-center"
                    onClick={() =>
                      void run('cancel-mfa', async () => {
                        await supabase.auth.mfa.unenroll({ factorId: enrollDraft.factorId });
                        setEnrollDraft(null);
                        setEnrollCode('');
                        return 'Authenticator setup cancelled.';
                      })
                    }
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl px-3 py-2 text-sm" style={{ background: 'var(--accent-soft)', color: 'var(--ink)' }}>
                  2FA is off. Enable it so password and email changes require an authenticator code.
                </div>
                <button
                  disabled={!cloudAccount || busy !== null}
                  className="pill-btn pill-primary w-full justify-center"
                  onClick={() =>
                    void run('enroll-mfa', async () => {
                      const existing = await getMfaStatus();
                      if (existing.unverifiedFactors.length > 0) {
                        await cleanupUnverifiedTotpFactors(existing.unverifiedFactors);
                      }
                      const { data, error } = await supabase.auth.mfa.enroll({
                        factorType: 'totp',
                        friendlyName: 'Authenticator app',
                      });
                      if (error) throw error;
                      if (!data?.id || !data.totp) throw new Error('Unable to start authenticator enrollment.');
                      setEnrollDraft({
                        factorId: data.id,
                        qrCode: data.totp.qr_code,
                        secret: data.totp.secret,
                      });
                      return 'Scan the QR code, then confirm with a code from your authenticator app.';
                    })
                  }
                >
                  {busy === 'enroll-mfa' ? 'Starting…' : 'Enable authenticator app'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <h3 className="font-display text-2xl">Confirm sensitive changes</h3>
        <p className="text-sm mt-2" style={{ color: 'var(--ink-muted)' }}>
          Password, email, and phone updates require your current password
          {mfaEnabled ? ' and a fresh authenticator code' : ''}.
        </p>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="editorial-input mt-4"
          placeholder="Current password"
          autoComplete="current-password"
          disabled={!cloudAccount || busy !== null}
        />
        {mfaEnabled && (
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={actionTotp}
            onChange={(e) => setActionTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="editorial-input mt-3"
            placeholder="Authenticator code"
            disabled={!cloudAccount || busy !== null}
          />
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <KeyRound className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="font-display text-2xl mt-3">Change password</h3>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="editorial-input mt-4"
            placeholder="New password"
            autoComplete="new-password"
          />
          <p className="text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>8+ characters, one uppercase letter, and one number.</p>
          <button
            disabled={
              !cloudAccount ||
              !currentPassword ||
              (mfaEnabled && !TOTP_CODE_PATTERN.test(actionTotp)) ||
              !strongPassword(password) ||
              busy !== null
            }
            className="pill-btn pill-primary w-full justify-center mt-4"
            onClick={() =>
              void run('password', async () => {
                await requireConfirmation();
                const { error } = await supabase.auth.updateUser({ password });
                if (error) throw error;
                setPassword('');
                clearSensitiveInputs();
                return 'Password updated successfully.';
              })
            }
          >
            {busy === 'password' ? 'Updating…' : 'Update password'}
          </button>
        </div>

        <div className="rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <Mail className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="font-display text-2xl mt-3">Change email</h3>
          <p className="text-xs mt-2 truncate" style={{ color: 'var(--ink-muted)' }}>Current: {user.email}</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="editorial-input mt-4"
            placeholder="New email address"
            autoComplete="email"
          />
          <button
            disabled={
              !cloudAccount ||
              !currentPassword ||
              (mfaEnabled && !TOTP_CODE_PATTERN.test(actionTotp)) ||
              !email.includes('@') ||
              busy !== null
            }
            className="pill-btn pill-primary w-full justify-center mt-4"
            onClick={() =>
              void run('email', async () => {
                await requireConfirmation();
                const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: getAuthRedirectUrl() });
                if (error) throw error;
                setEmail('');
                clearSensitiveInputs();
                return 'Confirmation sent. Complete the email change using the link in your inbox.';
              })
            }
          >
            {busy === 'email' ? 'Sending…' : 'Update email'}
          </button>
        </div>

        <div className="rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <Phone className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="font-display text-2xl mt-3">Phone number</h3>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="editorial-input mt-4"
            placeholder="+60123456789"
          />
          <button
            disabled={
              !cloudAccount ||
              !currentPassword ||
              (mfaEnabled && !TOTP_CODE_PATTERN.test(actionTotp)) ||
              !phone.startsWith('+') ||
              busy !== null
            }
            className="pill-btn pill-primary w-full justify-center mt-4"
            onClick={() =>
              void run('phone', async () => {
                await requireConfirmation();
                const { error } = await supabase.auth.updateUser({ phone });
                if (error) throw error;
                setPendingPhone(phone);
                clearSensitiveInputs();
                return 'Verification code sent to the new phone number.';
              })
            }
          >
            {busy === 'phone' ? 'Sending…' : 'Send verification code'}
          </button>
          {pendingPhone && (
            <div className="mt-3 flex flex-col gap-2">
              <input
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="editorial-input"
                placeholder="SMS verification code"
              />
              <button
                disabled={!otp || busy !== null}
                className="pill-btn pill-soft w-full justify-center"
                onClick={() =>
                  void run('otp', async () => {
                    const { error } = await supabase.auth.verifyOtp({
                      phone: pendingPhone,
                      token: otp,
                      type: 'phone_change',
                    });
                    if (error) throw error;
                    setOtp('');
                    setPendingPhone('');
                    return 'Phone number verified.';
                  })
                }
              >
                {busy === 'otp' ? 'Verifying…' : 'Verify phone'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-3xl p-4 sm:p-5 flex items-start gap-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
        <div>
          <h3 className="font-semibold">Security notification emails</h3>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
            Password, email, and phone change alerts are controlled project-wide in Supabase Authentication → Emails.
            Enable those three notifications there, and turn on Multi-factor authentication under Authentication → Providers / MFA
            so authenticator enrollment works for cloud accounts.
          </p>
        </div>
      </div>
    </section>
  );
}
