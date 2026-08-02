import { PawPrint } from 'lucide-react';

interface AppSettingsPanelProps {
  showPets: boolean;
  onTogglePets: () => void;
}

export function AppSettingsPanel({ showPets, onTogglePets }: AppSettingsPanelProps) {
  return (
    <section className="w-full space-y-6">
      <div className="editorial-card p-4 sm:p-5 md:p-8">
        <div className="eyebrow">Settings</div>
        <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[0.95]" style={{ color: 'var(--ink)' }}>
          App preferences.
        </h2>
        <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
          Control optional extras for your handbook. These preferences stay on this device.
        </p>
      </div>

      <div className="editorial-card p-4 sm:p-5 md:p-8">
        <div
          className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <div className="min-w-0 flex items-start gap-3">
            <div
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <PawPrint className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Animated pets</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Show playful pet companions floating over the handbook. Off by default for a cleaner view.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showPets}
            aria-label="Show animated pets"
            className="editorial-toggle shrink-0 self-start sm:self-center"
            data-checked={showPets ? 'true' : 'false'}
            onClick={onTogglePets}
          >
            <span className="editorial-toggle-thumb" />
          </button>
        </div>
      </div>
    </section>
  );
}
