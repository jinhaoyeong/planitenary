import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Lock, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import type { Itinerary } from '../data';
import {
  buildIdentityProposal,
  defaultProposalSelection,
  diffIdentityProposal,
  displayFieldValue,
  profileRevision,
  type FieldDiff,
  type GeneratedField,
  type IdentityProposal,
} from '../lib/identityFields';
import { buildTripIdentity } from '../lib/tripIdentity';
import { regenerateItinerary } from '../lib/trips';
import type { TripProfile } from '../lib/tripProfile';

interface RegenerationPreviewProps {
  itinerary: Itinerary;
  profile: TripProfile;
  onItineraryChange: (itinerary: Itinerary) => void;
}

const STATUS_COPY: Record<FieldDiff['status'], { label: string; tone: 'update' | 'protected' | 'quiet' }> = {
  generated: { label: 'Generated — selected for update', tone: 'update' },
  empty: { label: 'Empty — will be filled', tone: 'update' },
  manual: { label: 'Manually edited — preserved', tone: 'protected' },
  unknown: { label: 'Written before tracking — preserved', tone: 'protected' },
  unchanged: { label: 'No change', tone: 'quiet' },
};

function SelectBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="w-5 h-5 rounded-md shrink-0 mt-0.5 flex items-center justify-center transition-colors"
      style={{
        backgroundColor: checked ? 'var(--accent)' : 'transparent',
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        color: 'var(--accent-ink, #fff)',
      }}
    >
      {checked && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
    </button>
  );
}

function DiffRow({
  diff,
  selected,
  onToggle,
}: {
  diff: FieldDiff;
  selected: boolean;
  onToggle: () => void;
}) {
  const status = STATUS_COPY[diff.status];
  const statusLabel = diff.requiresConfirmation && selected
    ? `${diff.status === 'manual' ? 'Manually edited' : 'Written before tracking'} — selected for overwrite`
    : status.label;

  return (
    <div
      className="flex gap-3 rounded-2xl p-3"
      style={{
        backgroundColor: 'var(--surface)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      <SelectBox checked={selected} onChange={onToggle} label={`Regenerate ${diff.label}`} />
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{diff.label}</span>
          {diff.requiresConfirmation && !selected && (
            <Lock className="w-3 h-3" style={{ color: 'var(--ink-muted)' }} />
          )}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          <span className="font-semibold">Current: </span>
          {displayFieldValue(diff.field, diff.current) || '—'}
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>
          <span className="font-semibold">Proposed: </span>
          {displayFieldValue(diff.field, diff.proposed)}
        </p>
        <p
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: status.tone === 'protected' && !selected ? 'var(--ink-muted)' : 'var(--accent)' }}
        >
          {statusLabel}
        </p>
      </div>
    </div>
  );
}

export function RegenerationPreview({ itinerary, profile, onItineraryChange }: RegenerationPreviewProps) {
  const [proposal, setProposal] = useState<IdentityProposal | null>(null);
  const [selection, setSelection] = useState<Set<GeneratedField>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

  const revision = profileRevision(profile);

  const buildProposal = () =>
    buildIdentityProposal(
      itinerary,
      profile,
      buildTripIdentity(profile, { plannedDays: itinerary.days.length }),
    );

  const diffs = useMemo(
    () => (proposal ? diffIdentityProposal(itinerary, proposal) : []),
    [itinerary, proposal],
  );

  const changes = diffs.filter((diff) => diff.willChange);
  const updates = changes.filter((diff) => !diff.requiresConfirmation);
  const protectedChanges = changes.filter((diff) => diff.requiresConfirmation);
  const unchangedCount = diffs.length - changes.length;
  // The profile can be edited while the preview is open; the proposal stays
  // frozen so applying can never write something the traveller did not see.
  const isStale = proposal !== null && proposal.profileRevision !== revision;

  const openPreview = () => {
    const next = buildProposal();
    setProposal(next);
    setSelection(new Set(defaultProposalSelection(diffIdentityProposal(itinerary, next))));
    setStatus(null);
  };

  const refreshPreview = () => {
    openPreview();
    setStatus('Preview refreshed with your latest trip details.');
  };

  const toggleField = (field: GeneratedField) =>
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  const apply = () => {
    if (!proposal) return;
    const result = regenerateItinerary(itinerary, profile, proposal, selection);

    if (!result.ok) {
      setStatus(
        result.reason === 'profile-changed'
          ? 'Your trip details changed while this preview was open. Refresh it to see the new wording.'
          : 'This preview belongs to a different trip. Refresh it and try again.',
      );
      return;
    }

    onItineraryChange(result.itinerary);
    setProposal(null);
    setSelection(new Set());
    setStatus(
      result.applied.length === 0
        ? 'Nothing selected, so the handbook is unchanged.'
        : `Updated ${result.applied.length} ${result.applied.length === 1 ? 'field' : 'fields'}. Everything else was left as you wrote it.`,
    );
  };

  if (!proposal) {
    return (
      <div className="space-y-3">
        <button type="button" className="pill-btn pill-primary" onClick={openPreview}>
          <Sparkles className="w-4 h-4" />
          Review generated copy
        </button>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          You will see every proposed change before anything is written. Text you typed yourself is preserved unless
          you tick it.
        </p>
        {status && <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{status}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isStale && (
        <div
          className="flex items-start gap-2 rounded-2xl p-3 text-xs"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <span>
            Your trip details changed after this preview was created. Refresh to regenerate the wording below.
          </span>
        </div>
      )}

      {changes.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Nothing to change — the handbook already matches this trip profile.
        </p>
      ) : (
        <div className="space-y-4">
          {updates.length > 0 && (
            <div className="space-y-2">
              <div className="eyebrow m-0">Will update ({updates.length})</div>
              {updates.map((diff) => (
                <DiffRow
                  key={diff.field}
                  diff={diff}
                  selected={selection.has(diff.field)}
                  onToggle={() => toggleField(diff.field)}
                />
              ))}
            </div>
          )}

          {protectedChanges.length > 0 && (
            <div className="space-y-2">
              <div className="eyebrow m-0">Kept as you wrote it ({protectedChanges.length})</div>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                These stay untouched. Tick one only if you want the generated wording instead.
              </p>
              {protectedChanges.map((diff) => (
                <DiffRow
                  key={diff.field}
                  diff={diff}
                  selected={selection.has(diff.field)}
                  onToggle={() => toggleField(diff.field)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {unchangedCount} {unchangedCount === 1 ? 'field already matches' : 'fields already match'} this profile.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="pill-btn pill-primary" onClick={apply} disabled={changes.length === 0}>
          <RotateCcw className="w-4 h-4" />
          {selection.size > 0 ? `Apply ${selection.size} ${selection.size === 1 ? 'change' : 'changes'}` : 'Apply'}
        </button>
        <button type="button" className="pill-btn pill-ghost" onClick={refreshPreview}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
        <button
          type="button"
          className="pill-btn pill-ghost"
          onClick={() => {
            setProposal(null);
            setSelection(new Set());
            setStatus(null);
          }}
        >
          Cancel
        </button>
      </div>

      {status && <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{status}</p>}
    </div>
  );
}
