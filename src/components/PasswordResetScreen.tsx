import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Lock, Plane, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const isStrongPassword = (password: string) =>
  password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);

export function PasswordResetScreen() {
  const { user, signOut, clearPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!isStrongPassword(password)) {
      setError('Use at least 8 characters, including one uppercase letter and one number.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match. Check both fields and try again.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message || 'We could not update your password. Request a new reset link and try again.');
      return;
    }

    setSuccess(true);
  };

  const continueToSignIn = async () => {
    await signOut();
    clearPasswordRecovery();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[color:var(--bg)]" style={{ color: 'var(--ink)' }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="editorial-card p-5 sm:p-8 text-center bg-white dark:bg-slate-900">
          <div className="mx-auto w-16 h-16 bg-rose-100 dark:bg-rose-900/30 rounded-full flex items-center justify-center mb-6">
            {success ? <CheckCircle2 className="w-8 h-8 text-rose-500" /> : <Plane className="w-8 h-8 text-rose-500" />}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl mb-2 text-slate-900 dark:text-white">
            {success ? 'Password updated.' : 'Choose a new password.'}
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            {success
              ? 'Your Travel Handbook account is ready. Sign in again with your new password.'
              : `Create a new password for ${user?.email ?? 'your account'}.`}
          </p>

          {success ? (
            <button type="button" onClick={() => void continueToSignIn()} className="auth-submit mt-8 w-full py-3.5 rounded-xl font-bold transition-colors">
              Continue to sign in
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-5 text-left">
              {error && (
                <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <PasswordField
                id="new-password"
                label="New password"
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((visible) => !visible)}
                autoComplete="new-password"
              />
              <PasswordField
                id="confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                visible={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((visible) => !visible)}
                autoComplete="new-password"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">Use 8+ characters with at least 1 uppercase letter and 1 number.</p>
              <button type="submit" disabled={loading} className="auth-submit w-full py-3.5 rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Updating password…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: 'new-password';
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-bold text-slate-700 dark:text-slate-300">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="editorial-input w-full !pl-11 !pr-11"
        />
        <Lock className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
        <button type="button" onClick={onToggle} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          {visible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}
