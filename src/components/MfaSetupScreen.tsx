import { ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { TotpEnrollmentCard } from './TotpEnrollmentCard';

export function MfaSetupScreen() {
  const { user, signOut, refreshMfaStatus } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg"
      >
        <section className="editorial-card p-5 sm:p-8">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'var(--accent-soft)' }}
            >
              <ShieldCheck className="w-6 h-6" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <div className="eyebrow">Required security</div>
              <h1 className="font-display text-3xl sm:text-4xl mt-1">Enable 2FA</h1>
            </div>
          </div>

          <p className="mt-4 text-sm sm:text-base" style={{ color: 'var(--ink-muted)' }}>
            Cloud accounts must enroll an authenticator app before continuing. Signed in as{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>{user?.email}</span>.
          </p>

          <div className="mt-6">
            <TotpEnrollmentCard
              setupOnly
              onEnabled={() => {
                void refreshMfaStatus();
              }}
            />
          </div>

          <button
            type="button"
            className="pill-btn pill-soft w-full justify-center mt-5"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </section>
      </motion.div>
    </div>
  );
}
