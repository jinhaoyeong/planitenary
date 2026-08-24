import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

export const WelcomeScreen = ({ onStart }: { onStart: () => void }) => {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 pb-10 text-center overflow-hidden"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.97 }}
        transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-2xl mx-auto"
      >
        <span className="eyebrow">Spring 2026 · A little field guide</span>

        <h1
          className="mt-8 font-display text-[3.5rem] sm:text-7xl md:text-8xl leading-[0.95] tracking-tight"
          style={{ color: 'var(--ink)' }}
        >
          Hello,
          <br />
          <span className="font-display-italic" style={{ color: 'var(--accent)' }}>wanderers.</span>
        </h1>

        <p
          className="mt-8 text-base md:text-lg max-w-md mx-auto leading-relaxed"
          style={{ color: 'var(--ink-muted)' }}
        >
          A thoughtful place to collect your trips, notes, places, and plans —
          ready for your next journey.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mt-12"
      >
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'instant' });
            onStart();
          }}
          className="pill-btn pill-primary text-base px-8 py-4"
        >
          Continue to account
          <ArrowRight className="w-5 h-5" />
        </button>
      </motion.div>
    </motion.div>
  );
};
