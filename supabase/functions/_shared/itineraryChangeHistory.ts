/**
 * Read-only presentation of itinerary_change_history.
 *
 * The authority table stays behind the service role. This module turns stored
 * proposal diffs into the bounded, traveller-facing payload — summaries and
 * structured change atoms — without snapshots, hashes, or a model. Vitest
 * exercises the same functions the Edge Function runs.
 */
export const HISTORY_LIMIT = 20;
export const HISTORY_HEADLINE = 'AI plan applied';

export interface PublicHistoryPlace {
  name: string;
  day?: number;
  time?: string;
}

export interface PublicHistoryDiff {
  added: PublicHistoryPlace[];
  removed: PublicHistoryPlace[];
  moved: Array<PublicHistoryPlace & { fromDay: number; toDay: number }>;
  retimed: Array<PublicHistoryPlace & { fromTime: string; toTime: string }>;
  durationChanged: Array<PublicHistoryPlace & { fromMinutes?: number; toMinutes?: number }>;
  travelChanged: Array<PublicHistoryPlace & { fromMinutes?: number; toMinutes?: number }>;
  windowsAdded: Array<{ kind: string; name: string; day: number; time: string }>;
  windowsRemoved: Array<{ kind: string; name: string; day: number; time: string }>;
  dayCounts: Array<{ day: number; before: number; after: number }>;
  preservedMustDo: PublicHistoryPlace[];
  unscheduled: PublicHistoryPlace[];
  warnings: string[];
  conflicts: Array<{ message: string; day?: number }>;
}

export interface ItineraryHistoryItem {
  id: string;
  appliedAt: string;
  undoneAt: string | null;
  status: 'applied' | 'undone';
  title: string;
  summary: string;
  diff: PublicHistoryDiff;
}

export interface HistoryRecord {
  id: string;
  status: string;
  appliedAt: string;
  undoneAt: string | null;
  diff: unknown;
}

export interface HistoryDeps {
  readHistory(tripId: string, userId: string, limit: number): Promise<HistoryRecord[] | null>;
}

export type HistoryListResult =
  | { ok: true; changes: ItineraryHistoryItem[] }
  | { ok: false; refusal: 'storage-failed'; detail: string };

export interface HistoryDetailSection {
  title: string;
  items: Array<{ name: string; detail?: string }>;
}

const PLACE_LIMIT = 40;
const TEXT_LIMIT = 20;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result ? result.slice(0, max) : undefined;
};

const finite = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
};

const dayNumber = (value: unknown): number | undefined => {
  const n = finite(value);
  return n !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
};

const clock = (value: unknown): string | undefined => {
  const result = text(value, 5);
  return result && /^\d{1,2}:\d{2}$/.test(result) ? result : text(value, 16);
};

const placeOf = (value: unknown): PublicHistoryPlace | null => {
  const record = asRecord(value);
  const name = text(record?.name, 160);
  if (!name) return null;
  const place: PublicHistoryPlace = { name };
  const day = dayNumber(record?.day);
  const time = clock(record?.time);
  if (day !== undefined) place.day = day;
  if (time) place.time = time;
  return place;
};

const places = (value: unknown): PublicHistoryPlace[] =>
  Array.isArray(value)
    ? value.map(placeOf).filter((entry): entry is PublicHistoryPlace => entry !== null).slice(0, PLACE_LIMIT)
    : [];

const emptyDiff = (): PublicHistoryDiff => ({
  added: [],
  removed: [],
  moved: [],
  retimed: [],
  durationChanged: [],
  travelChanged: [],
  windowsAdded: [],
  windowsRemoved: [],
  dayCounts: [],
  preservedMustDo: [],
  unscheduled: [],
  warnings: [],
  conflicts: [],
});

const windowOf = (value: unknown): { kind: string; name: string; day: number; time: string } | null => {
  const record = asRecord(value);
  const name = text(record?.name, 160);
  const day = dayNumber(record?.day);
  if (!name || day === undefined) return null;
  return {
    kind: text(record?.kind, 40) ?? 'window',
    name,
    day,
    time: clock(record?.time) ?? '',
  };
};

const windows = (value: unknown) =>
  Array.isArray(value)
    ? value.map(windowOf).filter((entry): entry is NonNullable<typeof entry> => entry !== null).slice(0, PLACE_LIMIT)
    : [];

/**
 * Bound the stored Phase 2B diff to what the history UI may show.
 *
 * Drops identities, hashes, and unknown keys. Never reconstructs snapshots.
 */
export function sanitizeHistoryDiff(value: unknown): PublicHistoryDiff {
  const record = asRecord(value) ?? {};
  const diff = emptyDiff();
  diff.added = places(record.added);
  diff.removed = places(record.removed);
  diff.moved = Array.isArray(record.moved)
    ? record.moved.flatMap((entry) => {
        const place = placeOf(entry);
        const row = asRecord(entry);
        const fromDay = dayNumber(row?.fromDay);
        const toDay = dayNumber(row?.toDay);
        return place && fromDay !== undefined && toDay !== undefined
          ? [{ ...place, fromDay, toDay }]
          : [];
      }).slice(0, PLACE_LIMIT)
    : [];
  diff.retimed = Array.isArray(record.retimed)
    ? record.retimed.flatMap((entry) => {
        const place = placeOf(entry);
        const row = asRecord(entry);
        const fromTime = clock(row?.fromTime);
        const toTime = clock(row?.toTime);
        return place && fromTime && toTime ? [{ ...place, fromTime, toTime }] : [];
      }).slice(0, PLACE_LIMIT)
    : [];
  const minutesChange = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      const place = placeOf(entry);
      if (!place) return [];
      const row = asRecord(entry);
      const next = { ...place } as PublicHistoryPlace & { fromMinutes?: number; toMinutes?: number };
      const fromMinutes = finite(row?.fromMinutes);
      const toMinutes = finite(row?.toMinutes);
      if (fromMinutes !== undefined) next.fromMinutes = fromMinutes;
      if (toMinutes !== undefined) next.toMinutes = toMinutes;
      return [next];
    }).slice(0, PLACE_LIMIT);
  };
  diff.durationChanged = minutesChange(record.durationChanged);
  diff.travelChanged = minutesChange(record.travelChanged);
  diff.windowsAdded = windows(record.windowsAdded);
  diff.windowsRemoved = windows(record.windowsRemoved);
  diff.dayCounts = Array.isArray(record.dayCounts)
    ? record.dayCounts.flatMap((entry) => {
        const row = asRecord(entry);
        const day = dayNumber(row?.day);
        const before = finite(row?.before);
        const after = finite(row?.after);
        return day !== undefined && before !== undefined && after !== undefined
          ? [{ day, before, after }]
          : [];
      }).slice(0, PLACE_LIMIT)
    : [];
  diff.preservedMustDo = places(record.preservedMustDo);
  diff.unscheduled = places(record.unscheduled);
  diff.warnings = Array.isArray(record.warnings)
    ? record.warnings
        .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
        .map((entry) => entry.trim().slice(0, 200))
        .slice(0, TEXT_LIMIT)
    : [];
  diff.conflicts = Array.isArray(record.conflicts)
    ? record.conflicts.flatMap((entry) => {
        const row = asRecord(entry);
        const message = text(row?.message, 200);
        if (!message) return [];
        const day = dayNumber(row?.day);
        return day !== undefined ? [{ message, day }] : [{ message }];
      }).slice(0, TEXT_LIMIT)
    : [];
  return diff;
}

const counted = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`;

const windowKindLabel = (kind: string): string => {
  if (kind === 'meal-window') return 'meal window';
  if (kind === 'rest-window') return 'rest window';
  if (kind === 'free-time') return 'open window';
  return 'window';
};

const windowSummary = (windowsAdded: PublicHistoryDiff['windowsAdded'], windowsRemoved: PublicHistoryDiff['windowsRemoved']): string[] => {
  const parts: string[] = [];
  if (windowsAdded.length) {
    const kinds = new Set(windowsAdded.map((entry) => entry.kind));
    if (kinds.size === 1) {
      const label = windowKindLabel(windowsAdded[0].kind);
      parts.push(counted(windowsAdded.length, `${label} added`, `${label}s added`));
    } else {
      parts.push(counted(windowsAdded.length, 'window added', 'windows added'));
    }
  }
  if (windowsRemoved.length) {
    parts.push(counted(windowsRemoved.length, 'window removed', 'windows removed'));
  }
  return parts;
};

/** Deterministic one-line summary. Never calls a model. */
export function summarizeItineraryChangeDiff(diff: PublicHistoryDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(counted(diff.added.length, 'place added', 'places added'));
  if (diff.removed.length) parts.push(counted(diff.removed.length, 'place removed', 'places removed'));
  if (diff.moved.length) parts.push(counted(diff.moved.length, 'place moved', 'places moved'));
  if (diff.retimed.length) parts.push(counted(diff.retimed.length, 'place retimed', 'places retimed'));
  if (diff.durationChanged.length) parts.push(counted(diff.durationChanged.length, 'duration changed', 'durations changed'));
  if (diff.travelChanged.length) parts.push(counted(diff.travelChanged.length, 'travel leg updated', 'travel legs updated'));
  parts.push(...windowSummary(diff.windowsAdded, diff.windowsRemoved));
  if (diff.unscheduled.length) parts.push(counted(diff.unscheduled.length, 'place unscheduled', 'places unscheduled'));
  if (diff.dayCounts.length && parts.length === 0) {
    parts.push(counted(diff.dayCounts.length, 'day updated', 'days updated'));
  }
  return parts.slice(0, 4).join(' · ') || 'Times and details only';
}

const minutesLabel = (from?: number, to?: number): string | undefined => {
  if (from !== undefined && to !== undefined) return `${from} → ${to} min`;
  if (to !== undefined) return `updated to ${to} min`;
  if (from !== undefined) return `was ${from} min`;
  return undefined;
};

/** Sections for the detail view. Empty categories are omitted. */
export function historyDetailSections(diff: PublicHistoryDiff): HistoryDetailSection[] {
  const sections: HistoryDetailSection[] = [];
  const push = (title: string, items: HistoryDetailSection['items']) => {
    if (items.length) sections.push({ title, items });
  };

  push('Places added', diff.added.map((entry) => ({
    name: entry.name,
    detail: [entry.day !== undefined ? `Day ${entry.day}` : undefined, entry.time].filter(Boolean).join(' · ') || undefined,
  })));
  push('Places removed', diff.removed.map((entry) => ({
    name: entry.name,
    detail: entry.day !== undefined ? `Day ${entry.day}` : undefined,
  })));
  push('Places moved', diff.moved.map((entry) => ({
    name: entry.name,
    detail: `Moved from Day ${entry.fromDay} → Day ${entry.toDay}${entry.time ? ` · ${entry.time}` : ''}`,
  })));
  push('Times changed', diff.retimed.map((entry) => ({
    name: entry.name,
    detail: `${entry.fromTime} → ${entry.toTime}`,
  })));
  push('Durations changed', diff.durationChanged.map((entry) => ({
    name: entry.name,
    detail: minutesLabel(entry.fromMinutes, entry.toMinutes),
  })));
  push('Travel time changed', diff.travelChanged.map((entry) => ({
    name: entry.name || 'Travel',
    detail: minutesLabel(entry.fromMinutes, entry.toMinutes) ?? 'Travel time updated',
  })));
  push('Windows', [
    ...diff.windowsAdded.map((entry) => ({
      name: entry.name,
      detail: `${windowKindLabel(entry.kind)} added · Day ${entry.day}${entry.time ? ` · ${entry.time}` : ''}`,
    })),
    ...diff.windowsRemoved.map((entry) => ({
      name: entry.name,
      detail: `${windowKindLabel(entry.kind)} removed · Day ${entry.day}${entry.time ? ` · ${entry.time}` : ''}`,
    })),
  ]);
  push('Day changes', diff.dayCounts.map((entry) => ({
    name: `Day ${entry.day}`,
    detail: `${entry.before} → ${entry.after} places`,
  })));
  push('Must do', diff.preservedMustDo.map((entry) => ({
    name: entry.name,
    detail: 'preserved',
  })));
  push('Unscheduled', diff.unscheduled.map((entry) => ({
    name: entry.name,
    detail: 'Moved to unassigned',
  })));
  push('Warnings', [
    ...diff.warnings.map((message) => ({ name: message })),
    ...diff.conflicts.map((entry) => ({
      name: entry.message,
      detail: entry.day !== undefined ? `Day ${entry.day}` : undefined,
    })),
  ]);
  return sections;
}

export function presentHistoryRecord(record: HistoryRecord): ItineraryHistoryItem | null {
  const id = text(record.id, 80);
  const appliedAt = text(record.appliedAt, 60);
  const status = record.status === 'undone' ? 'undone' : record.status === 'applied' ? 'applied' : null;
  if (!id || !appliedAt || !status) return null;
  const diff = sanitizeHistoryDiff(record.diff);
  return {
    id,
    appliedAt,
    undoneAt: text(record.undoneAt, 60) ?? null,
    status,
    title: HISTORY_HEADLINE,
    summary: summarizeItineraryChangeDiff(diff),
    diff,
  };
}

/**
 * Map a service-role row (snake_case, nested proposal.diff) without copying
 * snapshots or hashes even if the query accidentally selected them.
 */
export function historyRecordFromAuthorityRow(row: unknown): HistoryRecord | null {
  const record = asRecord(row);
  if (!record) return null;
  const id = text(record.id, 80);
  const appliedAt = text(record.applied_at ?? record.appliedAt, 60);
  const status = text(record.status, 20);
  if (!id || !appliedAt || !status) return null;
  const nested = record.itinerary_change_proposals ?? record.proposal;
  const proposal = Array.isArray(nested) ? asRecord(nested[0]) : asRecord(nested);
  const undone = text(record.undone_at ?? record.undoneAt, 60) ?? null;
  return {
    id,
    status,
    appliedAt,
    undoneAt: undone,
    diff: proposal?.diff ?? record.diff ?? null,
  };
}

export async function listItineraryChangeHistory(
  tripId: string,
  userId: string,
  deps: HistoryDeps,
): Promise<HistoryListResult> {
  const rows = await deps.readHistory(tripId, userId, HISTORY_LIMIT);
  if (rows === null) {
    return { ok: false, refusal: 'storage-failed', detail: 'Plan changes could not be loaded.' };
  }
  const changes = rows
    .map(presentHistoryRecord)
    .filter((entry): entry is ItineraryHistoryItem => entry !== null)
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt) || right.id.localeCompare(left.id))
    .slice(0, HISTORY_LIMIT);
  return { ok: true, changes };
}

const sameLocalDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

export function formatHistoryAppliedAt(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(date, now)) return `Today · ${time}`;
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

export function formatHistoryClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
