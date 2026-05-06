import { useState } from 'react';
import { supabase, isSupabaseConfigured, getAuthRedirectUrl } from '../lib/supabase';
import { Plane, Lock, Mail, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { DEMO_EMAIL, DEMO_PASSWORD, useAuth } from '../contexts/AuthContext';

const getAuthErrorMessage = (err: { message?: string; code?: string; status?: number } | null | undefined) => {
  const message = err?.message ?? 'An error occurred during authentication.';
  const code = err?.code ?? '';

  if (message.includes('Failed to fetch')) {
    return 'Connection failed. Restart the dev server after editing `.env`, then try again.';
  }

  if (code === 'over_email_send_rate_limit' || message.toLowerCase().includes('rate limit')) {
    return 'Too many signup emails were requested. Wait a few minutes, or use a different email while testing.';
  }

  if (message.toLowerCase().includes('email not confirmed')) {
    return 'This account exists, but the email has not been confirmed yet. Open the verification email first.';
  }

  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Incorrect email or password. If you just signed up, verify the email before signing in.';
  }

  return message;
};

export const Auth = () => {
  const { signInDemo, signInLocal, signUpLocal } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const supabaseReady = isSupabaseConfigured();

  // Simple password strength check
  const isStrongPassword = (pass: string) => {
    return pass.length >= 8 && /[A-Z]/.test(pass) && /[0-9]/.test(pass);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD) {
      signInDemo();
      setLoading(false);
      return;
    }

    if (!isLogin && !isStrongPassword(password)) {
      setError('Password must be at least 8 characters long and contain a number and an uppercase letter.');
      setLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const localSignIn = signInLocal(email, password);
        if (localSignIn.success) return;

        if (!supabaseReady) {
          setError('Authentication is not configured yet. Add your Supabase environment variables to enable cloud sign in, or use a local test account created on this device.');
          return;
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        if (!supabaseReady) {
          const localSignUp = signUpLocal(email, password);
          if (!localSignUp.success) {
            setError(localSignUp.error || 'Unable to create local test account.');
          }
          return;
        }

        const { error, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getAuthRedirectUrl(),
          },
        });
        if (error) throw error;
        if (data.user && !data.session) {
          setError('Registration successful! Please check your email to verify your account on this same site.');
        }
      }
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[color:var(--bg)]" style={{ color: 'var(--ink)' }}>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="editorial-card p-5 sm:p-8 text-center mb-8 bg-white dark:bg-slate-900">
          <div className="mx-auto w-16 h-16 bg-rose-100 dark:bg-rose-900/30 rounded-full flex items-center justify-center mb-6">
            <Plane className="w-8 h-8 text-rose-500" />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl mb-2 text-slate-900 dark:text-white">
            Travel <span className="font-display-italic text-rose-500">Handbook</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            {isLogin ? 'Welcome back. Sign in to your trips.' : 'Create an account to start planning.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5 text-left">
            {!supabaseReady && (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm">
                Cloud auth needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, but local test sign up still works on this device.
              </div>
            )}
            {error && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Email Address</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="editorial-input w-full !pl-11"
                  placeholder="you@example.com"
                />
                <Mail className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="editorial-input w-full !pl-11 !pr-11"
                  placeholder={isLogin ? "••••••••" : "Min. 8 chars, 1 uppercase, 1 number"}
                />
                <Lock className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {!isLogin && password && !isStrongPassword(password) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Password must be 8+ chars with at least 1 uppercase and 1 number.
                </p>
              )}
            </div>

            {isLogin && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-400">Remember me</span>
                </label>
                <a href="#" className="text-sm font-semibold text-rose-500 hover:text-rose-600">Forgot password?</a>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!isLogin && !isStrongPassword(password))}
              className="w-full py-3.5 rounded-xl bg-slate-900 dark:bg-rose-600 text-white font-bold hover:bg-slate-800 dark:hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Create Account')}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsLogin(true);
                setEmail(DEMO_EMAIL);
                setPassword(DEMO_PASSWORD);
                setError(null);
                signInDemo();
              }}
              className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:border-rose-500 hover:text-rose-500 transition-colors"
            >
              Enter Demo Mode
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Test login: <span className="font-semibold">{DEMO_EMAIL}</span> / <span className="font-semibold">{DEMO_PASSWORD}</span>
            </p>
            {!isLogin && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                If Supabase email is rate-limited, the app will create a local test account with these same credentials.
              </p>
            )}
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-sm text-slate-500 dark:text-slate-400">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError(null);
              }}
              className="font-bold text-rose-500 hover:text-rose-600 transition-colors"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
