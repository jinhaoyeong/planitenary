import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

export const WelcomeScreen = ({ onStart }: { onStart: () => void }) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
      transition={{ duration: reduceMotion ? 0.01 : 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="welcome-screen fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}
    >
      <motion.main
        initial={reduceMotion ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: reduceMotion ? 0 : 0.08, duration: reduceMotion ? 0.01 : 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="welcome-screen-layout"
        aria-labelledby="welcome-title"
      >
        <section className="welcome-screen-copy">
          <p className="welcome-wordmark font-display">Planitenary</p>
          <h1
            id="welcome-title"
            className="font-display leading-[0.95] tracking-tight"
            style={{ color: 'var(--ink)' }}
          >
            Hello,<br />
            <span className="font-display-italic" style={{ color: 'var(--accent)' }}>wanderers.</span>
          </h1>
          <p className="welcome-screen-intro" style={{ color: 'var(--ink-muted)' }}>
            A thoughtful place to collect your trips, notes, places, and plans—ready for your next journey.
          </p>
          <button
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'instant' });
              onStart();
            }}
            className="pill-btn pill-primary welcome-screen-action"
          >
            Continue to account
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </section>
        <div
          className="future-illustration-slot future-illustration-slot-welcome"
          data-future-illustration="welcome-field-guide"
          aria-hidden="true"
        />
      </motion.main>
    </motion.div>
  );
};
