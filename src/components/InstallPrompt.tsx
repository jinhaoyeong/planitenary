import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share, PlusSquare, X } from 'lucide-react';

export const InstallPrompt = () => {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    if (isIOSDevice && !isStandalone) {
      const timer = setTimeout(() => setShowPrompt(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!showPrompt) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex flex-col justify-end pb-8"
        style={{ backgroundColor: 'color-mix(in srgb, var(--ink) 70%, transparent)', backdropFilter: 'blur(6px)' }}
        onClick={() => setShowPrompt(false)}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="mx-4 editorial-card p-6 relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setShowPrompt(false)}
            className="absolute top-4 right-4 p-2 rounded-full"
            style={{ color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-4 mb-5">
            <img src="/apple-touch-icon.png" alt="App Icon" className="w-16 h-16 rounded-3xl" style={{ border: '1px solid var(--border)' }} />
            <div>
              <span className="eyebrow">Install</span>
              <h3 className="font-display text-3xl leading-none mt-2" style={{ color: 'var(--ink)' }}>
                Add to home screen
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
                For the best little field-guide experience.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3" style={{ color: 'var(--ink)' }}>
              <span className="font-display text-2xl w-8 text-center" style={{ color: 'var(--accent)' }}>1</span>
              <span className="text-sm">Tap the <Share className="w-4 h-4 inline mx-1" /> Share button below</span>
            </div>
            <div className="flex items-center gap-3" style={{ color: 'var(--ink)' }}>
              <span className="font-display text-2xl w-8 text-center" style={{ color: 'var(--accent)' }}>2</span>
              <span className="text-sm">Choose <span className="font-semibold">Add to Home Screen</span> <PlusSquare className="w-4 h-4 inline mx-1" /></span>
            </div>
          </div>

          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 animate-bounce" style={{ color: 'var(--bg-elevated)' }}>
            ▼
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
