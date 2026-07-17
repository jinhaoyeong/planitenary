import { useState } from 'react';
import { KeyRound, Mail, Phone, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from '../lib/supabase';

const strongPassword = (value: string) => value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value);

export function SecurityPanel() {
  const { user, isDemoUser, isLocalTestUser } = useAuth();
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [otp, setOtp] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const cloudAccount = Boolean(user && isSupabaseConfigured() && !isDemoUser && !isLocalTestUser);

  if (!user) return null;

  const run = async (name: string, task: () => Promise<string>) => {
    setBusy(name);
    setStatus(null);
    try { setStatus(await task()); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to update account security.'); }
    finally { setBusy(null); }
  };

  return (
    <section className="editorial-card p-4 sm:p-5 md:p-8">
      <div className="eyebrow">Security</div>
      <h2 className="font-display text-3xl sm:text-4xl mt-4">Protect your account.</h2>
      <p className="mt-3 text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
        Update sign-in details and confirm sensitive changes through Supabase Auth.
      </p>

      {!cloudAccount && (
        <div className="mt-5 rounded-2xl p-4 text-sm" style={{ background: 'var(--accent-soft)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          Security changes are available for cloud accounts. Demo and local test accounts remain device-only.
        </div>
      )}
      {status && <div className="mt-5 rounded-2xl p-4 text-sm" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>{status}</div>}

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <KeyRound className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="font-display text-2xl mt-3">Change password</h3>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="editorial-input mt-4" placeholder="New password" />
          <p className="text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>8+ characters, one uppercase letter, and one number.</p>
          <button disabled={!cloudAccount || !strongPassword(password) || busy !== null} className="pill-btn pill-primary w-full justify-center mt-4" onClick={() => void run('password', async () => {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            setPassword('');
            return 'Password updated successfully.';
          })}>{busy === 'password' ? 'Updating…' : 'Update password'}</button>
        </div>

        <div className="rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <Mail className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="font-display text-2xl mt-3">Change email</h3>
          <p className="text-xs mt-2 truncate" style={{ color: 'var(--ink-muted)' }}>Current: {user.email}</p>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="editorial-input mt-4" placeholder="New email address" />
          <button disabled={!cloudAccount || !email.includes('@') || busy !== null} className="pill-btn pill-primary w-full justify-center mt-4" onClick={() => void run('email', async () => {
            const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: getAuthRedirectUrl() });
            if (error) throw error;
            setEmail('');
            return 'Confirmation sent. Complete the email change using the link in your inbox.';
          })}>{busy === 'email' ? 'Sending…' : 'Update email'}</button>
        </div>

        <div className="rounded-3xl p-4 sm:p-5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <Phone className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="font-display text-2xl mt-3">Phone number</h3>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="editorial-input mt-4" placeholder="+60123456789" />
          <button disabled={!cloudAccount || !phone.startsWith('+') || busy !== null} className="pill-btn pill-primary w-full justify-center mt-4" onClick={() => void run('phone', async () => {
            const { error } = await supabase.auth.updateUser({ phone });
            if (error) throw error;
            setPendingPhone(phone);
            return 'Verification code sent to the new phone number.';
          })}>{busy === 'phone' ? 'Sending…' : 'Send verification code'}</button>
          {pendingPhone && (
            <div className="mt-3 flex flex-col gap-2">
              <input inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value)} className="editorial-input" placeholder="Verification code" />
              <button disabled={!otp || busy !== null} className="pill-btn pill-soft w-full justify-center" onClick={() => void run('otp', async () => {
                const { error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token: otp, type: 'phone_change' });
                if (error) throw error;
                setOtp(''); setPendingPhone('');
                return 'Phone number verified.';
              })}>{busy === 'otp' ? 'Verifying…' : 'Verify phone'}</button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-3xl p-4 sm:p-5 flex items-start gap-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
        <div>
          <h3 className="font-semibold">Security notification emails</h3>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
            Password, email, and phone change alerts are controlled project-wide in Supabase Authentication → Emails. Enable those three notifications there; they cannot be safely overridden by individual browser-side toggles.
          </p>
        </div>
      </div>
    </section>
  );
}
