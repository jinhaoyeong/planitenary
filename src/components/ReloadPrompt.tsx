import { useRegisterSW } from 'virtual:pwa-register/react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, X } from 'lucide-react';

export const ReloadPrompt = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: any) {
      console.log('SW Registered: ' + r);
    },
    onRegisterError(error: any) {
      console.log('SW registration error', error);
    },
  });

  const close = () => {
    setNeedRefresh(false);
  };

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-28 left-4 right-4 z-50 md:bottom-8 md:right-8 md:left-auto md:w-96"
        >
          <div
            className="editorial-card p-5 flex items-center justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="eyebrow">Fresh edition</div>
              <h3 className="font-display text-2xl leading-none mt-2" style={{ color: 'var(--ink)' }}>
                New content is ready.
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
                Reload to pick up the latest changes.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => updateServiceWorker(true)}
                className="pill-btn pill-primary text-xs px-4 py-2"
              >
                <RefreshCw className="w-3 h-3" />
                Reload
              </button>
              <button
                onClick={close}
                className="p-2 rounded-full"
                style={{ color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
