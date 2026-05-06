import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, BookOpen, Map, Sparkles, Wallet, Camera } from 'lucide-react';
import { useSwipe } from '../hooks/useSwipe';

const slides = [
  {
    eyebrow: 'Welcome',
    titleTop: 'Plan trips',
    titleAccent: 'beautifully.',
    body: 'A clean travel handbook for building your itinerary, one day at a time, with a layout that feels like a real iOS app.',
    icon: Sparkles,
    cardTitle: 'A calm start',
    cardBody: 'Swipe through this short intro to see how the app works.',
  },
  {
    eyebrow: 'Itinerary',
    titleTop: 'Build days',
    titleAccent: 'your way.',
    body: 'Add cities, activities, notes, and timing details so each day reads like a polished travel plan instead of a messy checklist.',
    icon: BookOpen,
    cardTitle: 'Day-by-day planning',
    cardBody: 'Keep structure clear while still leaving space for flexible plans.',
  },
  {
    eyebrow: 'Maps',
    titleTop: 'See places',
    titleAccent: 'faster.',
    body: 'Jump between your itinerary and maps to understand where you are going, what is nearby, and how your trip flows in real space.',
    icon: Map,
    cardTitle: 'Location context',
    cardBody: 'Useful for city hopping, route planning, and spot clustering.',
  },
  {
    eyebrow: 'Budget',
    titleTop: 'Track spend',
    titleAccent: 'clearly.',
    body: 'Keep travel costs, notes, and quick references in one place, so your handbook stays useful before, during, and after the trip.',
    icon: Wallet,
    cardTitle: 'Practical tools',
    cardBody: 'Budgets, documents, and checklists stay close to the main trip flow.',
  },
  {
    eyebrow: 'Memories',
    titleTop: 'Save the story',
    titleAccent: 'with photos.',
    body: 'Upload cover images, keep photo moments, and personalize the handbook so every trip feels like your own travel journal.',
    icon: Camera,
    cardTitle: 'Ready to begin',
    cardBody: 'Start with a blank trip and shape the app around your journey.',
  },
] as const;

export const WelcomeScreen = ({ onStart }: { onStart: () => void }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const slide = slides[activeIndex];
  const isLastSlide = activeIndex === slides.length - 1;

  const goNext = () => {
    setActiveIndex((current) => Math.min(current + 1, slides.length - 1));
  };

  const goPrev = () => {
    setActiveIndex((current) => Math.max(current - 1, 0));
  };

  const finishOnboarding = () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    onStart();
  };

  const swipeHandlers = useSwipe({
    onSwipeLeft: () => {
      if (isLastSlide) {
        finishOnboarding();
        return;
      }
      goNext();
    },
    onSwipeRight: () => {
      goPrev();
    },
    threshold: 40,
    verticalLimit: 120,
  });

  const progressLabel = useMemo(() => `${activeIndex + 1} / ${slides.length}`, [activeIndex]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at top, color-mix(in srgb, var(--accent) 16%, transparent), transparent 38%)',
        }}
      />

      <div
        className="relative flex min-h-screen flex-col px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6"
        {...swipeHandlers}
      >
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <span className="eyebrow">Travel handbook</span>
          <button
            type="button"
            onClick={finishOnboarding}
            className="text-sm font-semibold"
            style={{ color: 'var(--ink-muted)' }}
          >
            Skip
          </button>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              className="editorial-card p-5 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="eyebrow">{slide.eyebrow}</div>
                <div
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <slide.icon className="h-6 w-6" />
                </div>
              </div>

              <h1 className="mt-6 font-display text-[2.8rem] sm:text-[3.5rem] leading-[0.92] tracking-tight">
                {slide.titleTop}
                <br />
                <span className="font-display-italic" style={{ color: 'var(--accent)' }}>
                  {slide.titleAccent}
                </span>
              </h1>

              <p className="mt-5 text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                {slide.body}
              </p>

              <div
                className="mt-8 rounded-[1.75rem] p-5"
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in srgb, var(--accent-soft) 90%, var(--bg-elevated)), var(--bg-elevated))',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--ink-muted)' }}>
                  {progressLabel}
                </div>
                <div className="mt-3 font-display text-3xl leading-tight">{slide.cardTitle}</div>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  {slide.cardBody}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 flex items-center justify-center gap-2">
            {slides.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Go to intro page ${index + 1}`}
                className="rounded-full transition-all"
                style={{
                  width: index === activeIndex ? '1.75rem' : '0.5rem',
                  height: '0.5rem',
                  backgroundColor: index === activeIndex ? 'var(--accent)' : 'color-mix(in srgb, var(--ink) 14%, transparent)',
                }}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={goPrev}
              disabled={activeIndex === 0}
              className="pill-btn pill-soft flex-1 justify-center disabled:opacity-40"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <button
              type="button"
              onClick={isLastSlide ? finishOnboarding : goNext}
              className="pill-btn pill-primary flex-1 justify-center"
            >
              {isLastSlide ? 'Start planning' : 'Continue'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <p className="mt-4 text-center text-xs sm:text-sm" style={{ color: 'var(--ink-muted)' }}>
            Swipe left or right to move through the intro.
          </p>
        </div>
      </div>
    </motion.div>
  );
};
