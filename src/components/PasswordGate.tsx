import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { Lock, ShieldAlert, Unlock } from 'lucide-react';

/* ─── disable React DevTools in production ─── */
if (import.meta.env.PROD && typeof window !== 'undefined') {
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook) {
    hook.inject = () => {};
    hook.onCommitFiberRoot = () => {};
    hook.onCommitFiberUnmount = () => {};
  }
}

/* ─── constants ─── */
const SESSION_KEY = 'ctb_session';
const ATTEMPT_KEY = 'ctb_attempts';
const INACTIVITY_LIMIT = 20 * 60 * 1000;
const CHECK_INTERVAL = 30 * 1000;
const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCKOUT_ESCALATION = [30, 60, 120, 300]; // seconds — escalates each round

const CORRECT_HASH =
  '66be2f269f74cc3fc0e1da335772e1cffd29b85e7cad9d296f23323aaab41b82';

/* ─── premium easings ─── */
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
const EASE_OUT_QUART = [0.25, 1, 0.5, 1] as const;

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ─── signed session token ─── */
async function generateSessionToken(timestamp: number): Promise<string> {
  return sha256(CORRECT_HASH + ':ctb:' + timestamp);
}

/* ─── session helpers ─── */
interface SessionData {
  lastActivity: number;
  createdAt: number;
  token: string;
}

function readSession(): SessionData | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (
      typeof p.lastActivity !== 'number' ||
      typeof p.createdAt !== 'number' ||
      typeof p.token !== 'string'
    )
      return null;
    return p as SessionData;
  } catch {
    return null;
  }
}

function touchSession() {
  const session = readSession();
  if (!session) return;
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ ...session, lastActivity: Date.now() }),
  );
}

async function createSession(): Promise<void> {
  const now = Date.now();
  const token = await generateSessionToken(now);
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ lastActivity: now, createdAt: now, token }),
  );
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

/** Synchronous quick-check (structure + timing). Used for initial render. */
function isSessionQuickValid(): boolean {
  const session = readSession();
  if (!session) return false;
  return Date.now() - session.lastActivity < INACTIVITY_LIMIT;
}

/** Full async validation — verifies the signed token wasn't forged. */
async function isSessionFullyValid(): Promise<boolean> {
  const session = readSession();
  if (!session) return false;
  if (Date.now() - session.lastActivity >= INACTIVITY_LIMIT) return false;
  const expected = await generateSessionToken(session.createdAt);
  return session.token === expected;
}

/* ─── persistent attempt tracking (survives refresh) ─── */
interface AttemptData {
  count: number;
  lockUntil: number;
  lockRound: number;
}

function getAttemptData(): AttemptData {
  try {
    const raw = localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return { count: 0, lockUntil: 0, lockRound: 0 };
    const p = JSON.parse(raw);
    return {
      count: typeof p.count === 'number' ? p.count : 0,
      lockUntil: typeof p.lockUntil === 'number' ? p.lockUntil : 0,
      lockRound: typeof p.lockRound === 'number' ? p.lockRound : 0,
    };
  } catch {
    return { count: 0, lockUntil: 0, lockRound: 0 };
  }
}

function persistAttemptData(data: AttemptData): void {
  localStorage.setItem(ATTEMPT_KEY, JSON.stringify(data));
}

function clearAttemptData(): void {
  localStorage.removeItem(ATTEMPT_KEY);
}

/* ═══════════════════════════════════════════════════
   Wrapper — owns the auth state + inactivity timers
   ═══════════════════════════════════════════════════ */
export function PasswordGateWrapper({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(() => isSessionQuickValid());
  const [showContent, setShowContent] = useState(() => isSessionQuickValid());
  const [revealPhase, setRevealPhase] = useState<'idle' | 'revealing'>('idle');

  /* — verify signed token on mount (catches forged sessions) — */
  useEffect(() => {
    if (!authenticated) return;
    isSessionFullyValid().then((valid) => {
      if (!valid) {
        clearSession();
        setAuthenticated(false);
        setShowContent(false);
        setRevealPhase('idle');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lock = useCallback(() => {
    clearSession();
    setShowContent(false);
    setRevealPhase('idle');
    setAuthenticated(false);
  }, []);

  const unlock = useCallback(() => {
    createSession(); // async — writes signed token to sessionStorage
    clearAttemptData();
    setAuthenticated(true);
    setShowContent(true);
    setRevealPhase('revealing');
  }, []);

  /* — activity listeners — */
  useEffect(() => {
    if (!authenticated) return;
    const onActivity = () => touchSession();
    const events = ['click', 'scroll', 'keydown', 'touchstart', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [authenticated]);

  /* — periodic expiry check — */
  useEffect(() => {
    if (!authenticated) return;
    const id = setInterval(() => {
      if (!isSessionQuickValid()) lock();
    }, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [authenticated, lock]);

  /* — check on tab re-focus — */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && authenticated && !isSessionQuickValid()) {
        lock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [authenticated, lock]);

  const wasAlreadyValid = isSessionQuickValid() && revealPhase === 'idle';

  return (
    <>
      {/* App content — mounts as soon as authenticated, behind the gate */}
      {showContent && (
        <AppReveal immediate={wasAlreadyValid}>
          {children}
        </AppReveal>
      )}

      {/* Gate overlay — exits on top of content with split-curtain */}
      <AnimatePresence>
        {!authenticated && (
          <PasswordGate key="gate" onUnlock={unlock} />
        )}
      </AnimatePresence>
    </>
  );
}

/* ═══════════════════════════════════════════════════
   App reveal — cinematic entrance after unlock
   ═══════════════════════════════════════════════════ */
function AppReveal({ children, immediate }: { children: ReactNode; immediate: boolean }) {
  if (immediate) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      {/* Soft fade overlay that gently dissolves away */}
      <motion.div
        className="fixed inset-0 z-[9998] pointer-events-none"
        style={{ backgroundColor: 'var(--bg)' }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.8, ease: EASE_OUT_QUART, delay: 0.2 }}
      />

      {/* Content gently fades in and floats up */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE_OUT_QUART, delay: 0.3 }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Gate UI — full-screen PIN overlay
   ═══════════════════════════════════════════════════ */

const boxContainerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.07, delayChildren: 0.5 },
  },
};

const boxVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.8 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
  },
};

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [filledIndex, setFilledIndex] = useState(-1);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Persistent attempt tracking (survives refresh)
  const attemptRef = useRef<AttemptData>(getAttemptData());
  const [lockCountdown, setLockCountdown] = useState(() => {
    const data = getAttemptData();
    if (data.lockUntil > Date.now()) {
      return Math.ceil((data.lockUntil - Date.now()) / 1000);
    }
    return 0;
  });

  // Animated progress bar
  const progress = useMotionValue(0);
  const progressWidth = useTransform(progress, [0, PIN_LENGTH], ['0%', '100%']);
  const progressOpacity = useTransform(progress, [0, 0.5, PIN_LENGTH], [0, 1, 1]);

  // Focus first input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 600);
    return () => clearTimeout(t);
  }, []);

  // Update progress bar
  useEffect(() => {
    const filled = digits.filter((d) => d !== '').length;
    animate(progress, filled, { type: 'spring', stiffness: 300, damping: 30 });
  }, [digits, progress]);

  // Lockout countdown
  useEffect(() => {
    if (lockCountdown <= 0) return;
    const id = setInterval(() => {
      setLockCountdown((c) => {
        if (c <= 1) { clearInterval(id); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [lockCountdown]);

  const isLockedOut = lockCountdown > 0;

  const clearInputs = () => {
    setDigits(Array(PIN_LENGTH).fill(''));
    setFilledIndex(-1);
    setTimeout(() => inputRefs.current[0]?.focus(), 60);
  };

  const verify = useCallback(
    async (code: string) => {
      if (checking || isLockedOut) return;
      setChecking(true);
      const hash = await sha256(code);

      if (hash === CORRECT_HASH) {
        setSuccess(true);
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'instant' });
          onUnlock();
        }, 650);
      } else {
        const data = attemptRef.current;
        const nextCount = data.count + 1;

        setError(true);
        setTimeout(() => {
          setError(false);
          clearInputs();
        }, 700);

        if (nextCount >= MAX_ATTEMPTS) {
          // Escalating lockout: 30s → 60s → 120s → 300s
          const lockSecs =
            LOCKOUT_ESCALATION[Math.min(data.lockRound, LOCKOUT_ESCALATION.length - 1)];
          const updated: AttemptData = {
            count: 0,
            lockUntil: Date.now() + lockSecs * 1000,
            lockRound: data.lockRound + 1,
          };
          attemptRef.current = updated;
          persistAttemptData(updated);
          setLockCountdown(lockSecs);
        } else {
          const updated: AttemptData = { ...data, count: nextCount };
          attemptRef.current = updated;
          persistAttemptData(updated);
        }
      }
      setChecking(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checking, isLockedOut, onUnlock],
  );

  const handleChange = (index: number, value: string) => {
    if (isLockedOut || success) return;

    // Handle paste
    if (value.length > 1) {
      const pasted = value.replace(/\D/g, '').slice(0, PIN_LENGTH).split('');
      const next = [...digits];
      pasted.forEach((d, i) => {
        if (index + i < PIN_LENGTH) next[index + i] = d;
      });
      setDigits(next);
      setFilledIndex(index + pasted.length - 1);
      const focusIdx = Math.min(index + pasted.length, PIN_LENGTH - 1);
      inputRefs.current[focusIdx]?.focus();
      if (next.every((d) => d !== '')) verify(next.join(''));
      return;
    }

    const digit = value.replace(/\D/g, '');
    if (!digit) return;

    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setFilledIndex(index);

    if (index < PIN_LENGTH - 1) inputRefs.current[index + 1]?.focus();
    if (next.every((d) => d !== '')) verify(next.join(''));
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isLockedOut || success) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];
      if (digits[index]) {
        next[index] = '';
        setDigits(next);
        setFilledIndex(-1);
      } else if (index > 0) {
        next[index - 1] = '';
        setDigits(next);
        setFilledIndex(-1);
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: 'var(--bg)' }}
      initial={{ opacity: 1 }}
      exit={{
        opacity: 0,
        transition: { duration: 0.4, ease: EASE_OUT_QUART },
      }}
    >
      {/* Floating decorative circles */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 300, height: 300,
          background: 'radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)',
          top: '10%', right: '-5%',
          filter: 'blur(40px)',
        }}
        animate={{ y: [0, -20, 0], x: [0, 10, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 200, height: 200,
          background: 'radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)',
          bottom: '15%', left: '-3%',
          filter: 'blur(40px)',
        }}
        animate={{ y: [0, 15, 0], x: [0, -8, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.92 }}
        animate={
          success
            ? {
                opacity: 0,
                y: -20,
                scale: 0.96,
                filter: 'blur(6px)',
                transition: { duration: 0.4, ease: EASE_OUT_EXPO, delay: 0.15 },
              }
            : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
        }
        transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
        className="w-full max-w-sm mx-4 rounded-2xl border p-8 sm:p-10 text-center relative z-10"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-lift)',
        }}
      >
        {/* Brand */}
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: 0.15 }}
          className="font-display-italic text-lg mb-1"
          style={{ color: 'var(--ink-muted)' }}
        >
          Travel Handbook
        </motion.p>

        {/* Lock icon — morphs to Unlock on success */}
        <motion.div
          className="flex justify-center mb-4 mt-3"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.25 }}
        >
          <motion.div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-soft)' }}
            animate={
              success
                ? { scale: [1, 1.3, 1], backgroundColor: 'var(--accent)' }
                : error
                  ? { rotate: [0, -10, 10, -10, 10, 0] }
                  : {}
            }
            transition={success ? { duration: 0.4 } : { duration: 0.4 }}
          >
            <AnimatePresence mode="wait">
              {success ? (
                <motion.div
                  key="unlocked"
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                >
                  <Unlock size={22} style={{ color: 'var(--bg)' }} />
                </motion.div>
              ) : (
                <motion.div
                  key="locked"
                  exit={{ scale: 0, rotate: 90 }}
                  transition={{ duration: 0.15 }}
                >
                  <Lock size={22} style={{ color: 'var(--accent)' }} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        {/* Title */}
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: 0.3 }}
          className="font-display text-2xl sm:text-3xl mb-1"
          style={{ color: 'var(--ink)' }}
        >
          {success ? 'Welcome back' : 'Private planner'}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: 0.38 }}
          className="text-sm mb-8"
          style={{ color: 'var(--ink-muted)' }}
        >
          {success ? 'Opening your planner…' : 'Enter the passcode to continue'}
        </motion.p>

        {/* Progress bar */}
        <div className="relative w-full h-0.5 mb-6 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: progressWidth,
              opacity: progressOpacity,
              backgroundColor: success ? 'var(--accent)' : 'var(--ink-muted)',
            }}
            animate={success ? { backgroundColor: 'var(--accent)' } : {}}
          />
        </div>

        {/* PIN boxes */}
        <motion.div
          className="flex justify-center gap-2 sm:gap-3 mb-6"
          variants={boxContainerVariants}
          initial="hidden"
          animate="visible"
        >
          {digits.map((d, i) => (
            <motion.div
              key={i}
              variants={boxVariants}
              animate={
                success
                  ? {
                      scale: [1, 1.15, 1],
                      transition: { delay: i * 0.04, duration: 0.3 },
                    }
                  : error
                    ? {
                        x: [0, -8, 8, -8, 8, 0],
                        transition: { duration: 0.45, ease: 'easeInOut' },
                      }
                    : filledIndex === i
                      ? {
                          scale: [1, 1.12, 1],
                          transition: { duration: 0.25, ease: 'easeOut' },
                        }
                      : { scale: 1 }
              }
              className="relative"
            >
              <input
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={2}
                autoComplete="one-time-code"
                disabled={isLockedOut || checking || success}
                value={d ? '\u25CF' : ''}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onFocus={(e) => e.target.select()}
                className="pin-box w-11 h-14 sm:w-12 sm:h-16 rounded-xl text-center text-xl sm:text-2xl font-display outline-none transition-colors duration-200"
                style={{
                  backgroundColor: 'var(--bg)',
                  color: 'var(--ink)',
                  borderWidth: '1.5px',
                  borderStyle: 'solid',
                  borderColor: success
                    ? 'var(--accent)'
                    : error
                      ? 'var(--accent)'
                      : d
                        ? 'var(--ink-muted)'
                        : 'var(--border)',
                }}
              />
              {/* Dot fill animation */}
              <AnimatePresence>
                {d && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                    className="absolute inset-0 flex items-center justify-center text-xl sm:text-2xl font-display pointer-events-none"
                    style={{ color: success ? 'var(--accent)' : 'var(--ink)' }}
                  >
                    ●
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>

        {/* Messages */}
        <AnimatePresence mode="wait">
          {success && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-center gap-2 text-sm"
              style={{ color: 'var(--accent)' }}
            >
              <span className="flex gap-1">
                {[0, 1, 2].map((j) => (
                  <motion.span
                    key={j}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.15 }}
                  >
                    ·
                  </motion.span>
                ))}
              </span>
            </motion.div>
          )}

          {isLockedOut && !success && (
            <motion.div
              key="lockout"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center justify-center gap-2 text-sm"
              style={{ color: 'var(--warn)' }}
            >
              <ShieldAlert size={16} />
              <span>Too many attempts. Try again in {lockCountdown}s</span>
            </motion.div>
          )}

          {error && !isLockedOut && !success && (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="text-sm"
              style={{ color: 'var(--accent)' }}
            >
              Incorrect passcode
            </motion.p>
          )}

          {!error && !isLockedOut && !success && (
            <motion.p
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="text-xs"
              style={{ color: 'var(--ink-muted)' }}
            >
              6-digit passcode
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
