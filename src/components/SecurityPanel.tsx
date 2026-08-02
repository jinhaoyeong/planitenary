import { useEffect, useState } from 'react';
import { KeyRound, Mail, Phone, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { confirmSensitiveAction, TOTP_CODE_PATTERN } from '../lib/authSecurity';
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from '../lib/supabase';
import { TotpEnrollmentCard } from './TotpEnrollmentCard';

const strongPassword = (value: string) => value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value);

type PendingAction = 'password' | 'email' | 'phone';

const ACTION_LABELS: Record<PendingAction, { title: string; confirm: string }> = {
  password: { title: 'Update password', confirm: 'Confirm & update password' },
  email: { title: 'Update email', confirm: 'Confirm & update email' },
  phone: { title: 'Update phone number', confirm: 'Confirm & send code' },
};

export function SecurityPanel() {
  const { user, isDemoUser, isLocalTestUser, mfaEnabled, mfaFactorId } = useAuth();
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [otp, setOtp] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [actionTotp, setActionTotp] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const cloudAccount = Boolean(user && isSupabaseConfigured() && !isDemoUser && !isLocalTestUser);

  useEffect(() => {
    if (!pendingAction) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [pendingAction]);

  if (!user) return null;

  const clearSensitiveInputs = () => {
    setCurrentPassword('');
    setActionTotp('');
    setConfirmError(null);
  };

  const closeConfirm = () => {
    if (busy !== null) return;
    setPendingAction(null);
    clearSensitiveInputs();
  };

  const openConfirm = (action: PendingAction) => {
    if (!cloudAccount || busy !== null) return;
    clearSensitiveInputs();
    setPendingAction(action);
  };

  const runConfirmedAction = async () => {
    if (!pendingAction || !user.email) return;

    setBusy(pendingAction);
    setConfirmError(null);
    setStatus(null);

    try {
      await confirmSensitiveAction({
        email: user.email,
        currentPassword,
        totpCode: actionTotp,
        mfaEnabled,
        factorId: mfaFactorId ?? undefined,
      });

      if (pendingAction === 'password') {
        if (!strongPassword(password)) throw new Error('Choose a stronger password before continuing.');
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword('');
        setStatus('Password updated successfully.');
      } else if (pendingAction === 'email') {
        if (!email.includes('@')) throw new Error('Enter a valid email address.');
        const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: getAuthRedirectUrl() });
        if (error) throw error;
        setEmail('');
        setStatus('Confirmation sent. Complete the email change using the link in your inbox.');
      } else {
        if (!phone.startsWith('+')) throw new Error('Phone numbers must include a country code, e.g. +60123456789.');
        const { error } = await supabase.auth.updateUser({ phone });
        if (error) throw error;
        setPendingPhone(phone);
        setStatus('Verification code sent to the new phone number.');
      }

      setPendingAction(null);
      clearSensitiveInputs();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'Unable to confirm this change.');
    } finally {
      setBusy(null);
    }
  };

  const confirmReady =
    Boolean(currentPassword) &&
    (!mfaEnabled || TOTP_CODE_PATTERN.test(actionTotp)) &&
    busy === null;

  return (
    <section className="editorial-card p-4 sm:p-5 md:p-8">
      <div className="eyebrow">Account security</div>
      <h2 className="font-display text-3xl sm:text-4xl mt-4">Protect your account.</h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
        Manage 2FA, password, email, and phone.
      </p>

      {!cloudAccount && (
        <div className="mt-4 rounded-2xl px-3 py-2 text-sm" style={{ background: 'var(--accent-soft)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          Sign in with a cloud account to change these settings.
        </div>
      )}
      {status && (
        <div className="mt-5 rounded-2xl p-4 text-sm" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          {status}
        </div>
      )}

      <div className="mt-6">
        <TotpEnrollmentCard />
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
            disabled={!cloudAccount || !strongPassword(password) || busy !== null}
            className="pill-btn pill-primary w-full justify-center mt-4"
            onClick={() => openConfirm('password')}
          >
            Update password
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
            disabled={!cloudAccount || !email.includes('@') || busy !== null}
            className="pill-btn pill-primary w-full justify-center mt-4"
            onClick={() => openConfirm('email')}
          >
            Update email
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
            disabled={!cloudAccount || !phone.startsWith('+') || busy !== null}
            className="pill-btn pill-primary w-full justify-center mt-4"
            onClick={() => openConfirm('phone')}
          >
            Send verification code
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
                onClick={() => {
                  void (async () => {
                    setBusy('otp');
                    setStatus(null);
                    try {
                      const { error } = await supabase.auth.verifyOtp({
                        phone: pendingPhone,
                        token: otp,
                        type: 'phone_change',
                      });
                      if (error) throw error;
                      setOtp('');
                      setPendingPhone('');
                      setStatus('Phone number verified.');
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : 'Unable to verify phone.');
                    } finally {
                      setBusy(null);
                    }
                  })();
                }}
              >
                {busy === 'otp' ? 'Verifying…' : 'Verify phone'}
              </button>
            </div>
          )}
        </div>
      </div>

      {pendingAction && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sensitive-confirm-title"
        >
          <button
            type="button"
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(15, 14, 13, 0.55)' }}
            aria-label="Close confirmation"
            onClick={closeConfirm}
          />
          <div
            className="relative z-10 w-full max-w-md rounded-[1.75rem] p-5 sm:p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            <button
              type="button"
              onClick={closeConfirm}
              className="absolute top-4 right-4 p-2 rounded-full"
              style={{ color: 'var(--ink-muted)' }}
              aria-label="Close"
              disabled={busy !== null}
            >
              <X className="w-5 h-5" />
            </button>

            <div className="eyebrow">Required</div>
            <h3 id="sensitive-confirm-title" className="font-display text-2xl sm:text-3xl mt-3 pr-10">
              Confirm sensitive changes
            </h3>
            <p className="text-sm mt-2" style={{ color: 'var(--ink-muted)' }}>
              Enter your current password
              {mfaEnabled ? ' and authenticator code' : ''} to {ACTION_LABELS[pendingAction].title.toLowerCase()}.
            </p>

            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="editorial-input mt-5"
              placeholder="Current password"
              autoComplete="current-password"
              autoFocus
              disabled={busy !== null}
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
                disabled={busy !== null}
              />
            )}

            {confirmError && (
              <div className="mt-3 rounded-2xl px-3 py-2 text-sm" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                {confirmError}
              </div>
            )}

            <div className="mt-5 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                className="pill-btn pill-soft w-full justify-center"
                onClick={closeConfirm}
                disabled={busy !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pill-btn pill-primary w-full justify-center"
                disabled={!confirmReady}
                onClick={() => void runConfirmedAction()}
              >
                {busy === pendingAction ? 'Confirming…' : ACTION_LABELS[pendingAction].confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
