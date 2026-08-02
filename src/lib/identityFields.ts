/**
 * Field provenance for generated handbook copy.
 *
 * Every piece of copy the Trip Identity System writes onto an itinerary is
 * tracked here so regeneration can tell the difference between text the app
 * wrote and text the traveller wrote. Values stay plain strings on the
 * itinerary; provenance lives in a sidecar map so old saved trips keep loading
 * and the rendering layer never has to change.
 */

import type { Itinerary } from '../data';
import type { TripIdentity } from './tripIdentity';
import type { TripProfile } from './tripProfile';

/**
 * `unknown` covers trips saved before provenance existed. Those fields may
 * already hold hand-written copy, so they are protected exactly like `manual`
 * until the traveller says otherwise.
 */
export type FieldSource = 'generated' | 'manual' | 'unknown';

export interface FieldProvenance {
  source: FieldSource;
  /** The value the generator last wrote, used to detect edits made elsewhere. */
  generatedValue?: string;
  generatedAt?: string;
}

/** Strict union so renamed fields can never leave stale provenance behind. */
export type GeneratedField =
  | 'brandTitle'
  | 'name'
  | 'description'
  | 'heroEyebrow'
  | 'heroPrimaryButton'
  | 'heroSecondaryButton'
  | 'dayBadge'
  | 'dayBadgeUnit'
  | 'coverHeadline'
  | 'coverLabel'
  | 'coverYear'
  | 'marquee'
  | 'overviewHeading'
  | 'overviewDescription'
  | 'searchPlaceholder';

export type FieldSourceMap = Partial<Record<GeneratedField, FieldProvenance>>;

interface FieldDefinition {
  label: string;
  group: 'Hero' | 'Cover' | 'Itinerary' | 'Handbook';
  /** Reads the field as a comparable string. Lists join on newlines. */
  read: (itinerary: Itinerary) => string;
  write: (value: string) => Partial<Itinerary>;
  fromIdentity: (identity: TripIdentity) => string;
}

const LIST_SEPARATOR = '\n';

const splitList = (value: string) =>
  value.split(LIST_SEPARATOR).map((item) => item.trim()).filter((item) => item.length > 0);

export const FIELD_DEFINITIONS: Record<GeneratedField, FieldDefinition> = {
  brandTitle: {
    label: 'Handbook name',
    group: 'Handbook',
    read: (itinerary) => itinerary.brandTitle ?? '',
    write: (value) => ({ brandTitle: value }),
    fromIdentity: (identity) => identity.brandTitle,
  },
  name: {
    label: 'Hero title',
    group: 'Hero',
    read: (itinerary) => itinerary.name ?? '',
    write: (value) => ({ name: value }),
    fromIdentity: (identity) => identity.heroTitle,
  },
  description: {
    label: 'Hero description',
    group: 'Hero',
    read: (itinerary) => itinerary.description ?? '',
    write: (value) => ({ description: value }),
    fromIdentity: (identity) => identity.heroDescription,
  },
  heroEyebrow: {
    label: 'Hero subtitle',
    group: 'Hero',
    read: (itinerary) => itinerary.heroEyebrow ?? '',
    write: (value) => ({ heroEyebrow: value }),
    fromIdentity: (identity) => identity.heroEyebrow,
  },
  heroPrimaryButton: {
    label: 'Primary button',
    group: 'Hero',
    read: (itinerary) => itinerary.primaryButtonLabel ?? '',
    write: (value) => ({ primaryButtonLabel: value }),
    fromIdentity: (identity) => identity.primaryButtonLabel,
  },
  heroSecondaryButton: {
    label: 'Secondary button',
    group: 'Hero',
    read: (itinerary) => itinerary.secondaryButtonLabel ?? '',
    write: (value) => ({ secondaryButtonLabel: value }),
    fromIdentity: (identity) => identity.secondaryButtonLabel,
  },
  dayBadge: {
    label: 'Day badge',
    group: 'Hero',
    read: (itinerary) => itinerary.heroDayBadge ?? '',
    write: (value) => ({ heroDayBadge: value }),
    fromIdentity: (identity) => identity.dayBadgeValue,
  },
  dayBadgeUnit: {
    label: 'Day badge unit',
    group: 'Hero',
    read: (itinerary) => itinerary.heroDayBadgeUnit ?? '',
    write: (value) => ({ heroDayBadgeUnit: value }),
    fromIdentity: (identity) => identity.dayBadgeUnit,
  },
  coverHeadline: {
    label: 'Cover headline',
    group: 'Cover',
    read: (itinerary) => itinerary.coverHeadline ?? '',
    write: (value) => ({ coverHeadline: value }),
    fromIdentity: (identity) => identity.coverHeadline,
  },
  coverLabel: {
    label: 'Cover label',
    group: 'Cover',
    read: (itinerary) => itinerary.coverLabel ?? '',
    write: (value) => ({ coverLabel: value }),
    fromIdentity: (identity) => identity.coverLabel,
  },
  coverYear: {
    label: 'Cover year',
    group: 'Cover',
    read: (itinerary) => itinerary.coverYear ?? '',
    write: (value) => ({ coverYear: value }),
    fromIdentity: (identity) => identity.coverYear,
  },
  marquee: {
    label: 'Marquee labels',
    group: 'Handbook',
    read: (itinerary) => (itinerary.marqueeItems ?? []).join(LIST_SEPARATOR),
    write: (value) => ({ marqueeItems: splitList(value) }),
    fromIdentity: (identity) => identity.marqueeItems.join(LIST_SEPARATOR),
  },
  overviewHeading: {
    label: 'Itinerary heading',
    group: 'Itinerary',
    read: (itinerary) => itinerary.overviewEyebrow ?? '',
    write: (value) => ({ overviewEyebrow: value }),
    fromIdentity: (identity) => identity.overviewEyebrow,
  },
  overviewDescription: {
    label: 'Itinerary description',
    group: 'Itinerary',
    read: (itinerary) => itinerary.overviewDescription ?? '',
    write: (value) => ({ overviewDescription: value }),
    fromIdentity: (identity) => identity.overviewDescription,
  },
  searchPlaceholder: {
    label: 'Search placeholder',
    group: 'Itinerary',
    read: (itinerary) => itinerary.searchPlaceholder ?? '',
    write: (value) => ({ searchPlaceholder: value }),
    fromIdentity: (identity) => identity.searchPlaceholder,
  },
};

export const GENERATED_FIELDS = Object.keys(FIELD_DEFINITIONS) as GeneratedField[];

const FIELD_SET = new Set<string>(GENERATED_FIELDS);

export const isGeneratedField = (value: unknown): value is GeneratedField =>
  typeof value === 'string' && FIELD_SET.has(value);

/** Human-readable form of a stored field value (lists become "a · b · c"). */
export const displayFieldValue = (field: GeneratedField, value: string) =>
  field === 'marquee' ? splitList(value).join(' · ') : value;

/**
 * Comparison form used to decide whether a value really changed. Accidental
 * whitespace is ignored; punctuation and capitalisation are deliberate edits
 * and are preserved.
 */
export const normalizeFieldValue = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();

const valuesMatch = (left: string, right: string) =>
  normalizeFieldValue(left) === normalizeFieldValue(right);

export function sanitizeFieldSources(value: unknown): FieldSourceMap | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  const result: FieldSourceMap = {};

  for (const [key, raw] of entries) {
    if (!isGeneratedField(key) || !raw || typeof raw !== 'object') continue;
    const record = raw as Partial<FieldProvenance>;
    const source: FieldSource =
      record.source === 'generated' || record.source === 'manual' ? record.source : 'unknown';
    result[key] = {
      source,
      generatedValue: typeof record.generatedValue === 'string' ? record.generatedValue : undefined,
      generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : undefined,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** Provenance for a field, defaulting to the protected `unknown` state. */
export function fieldProvenance(itinerary: Itinerary, field: GeneratedField): FieldProvenance {
  return itinerary.fieldSources?.[field] ?? { source: 'unknown' };
}

/**
 * The effective source, accounting for edits that bypassed provenance
 * tracking: if a field claims to be generated but no longer matches what the
 * generator wrote, treat it as manual rather than overwriting it.
 */
export function effectiveFieldSource(itinerary: Itinerary, field: GeneratedField): FieldSource {
  const provenance = fieldProvenance(itinerary, field);
  if (provenance.source !== 'generated') return provenance.source;
  if (provenance.generatedValue === undefined) return 'generated';
  const current = FIELD_DEFINITIONS[field].read(itinerary);
  return valuesMatch(current, provenance.generatedValue) ? 'generated' : 'manual';
}

/* -------------------------------------------------------------------------- */
/* Proposals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * An immutable snapshot of generated copy. The preview and the apply step both
 * read this exact object, so what the traveller confirms is what gets written
 * even if the profile changes in between.
 */
export interface IdentityProposal {
  itineraryId: string;
  profileRevision: string;
  generatedAt: string;
  fields: Record<GeneratedField, string>;
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
};

/** Stable fingerprint of a profile, used to detect drift between preview and apply. */
export function profileRevision(profile: TripProfile): string {
  const serialized = stableStringify(profile);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `r${hash.toString(36)}`;
}

export function buildIdentityProposal(
  itinerary: Itinerary,
  profile: TripProfile,
  identity: TripIdentity,
  generatedAt = new Date().toISOString(),
): IdentityProposal {
  const fields = {} as Record<GeneratedField, string>;
  for (const field of GENERATED_FIELDS) {
    fields[field] = FIELD_DEFINITIONS[field].fromIdentity(identity);
  }
  return {
    itineraryId: itinerary.id,
    profileRevision: profileRevision(profile),
    generatedAt,
    fields,
  };
}

/* -------------------------------------------------------------------------- */
/* Diffing                                                                     */
/* -------------------------------------------------------------------------- */

export type FieldChangeStatus =
  /** Proposed copy matches what is already there. */
  | 'unchanged'
  /** Nothing to lose — the field is currently empty. */
  | 'empty'
  /** App-written copy that is safe to refresh. */
  | 'generated'
  /** The traveller wrote this; preserved unless explicitly selected. */
  | 'manual'
  /** Saved before provenance existed; preserved unless explicitly selected. */
  | 'unknown';

export interface FieldDiff {
  field: GeneratedField;
  label: string;
  group: FieldDefinition['group'];
  current: string;
  proposed: string;
  source: FieldSource;
  status: FieldChangeStatus;
  /** The proposal differs from the current value. */
  willChange: boolean;
  /** Included when the traveller applies without changing the selection. */
  defaultSelected: boolean;
  /** Requires a deliberate opt-in because the copy may be hand-written. */
  requiresConfirmation: boolean;
}

export function diffIdentityProposal(itinerary: Itinerary, proposal: IdentityProposal): FieldDiff[] {
  return GENERATED_FIELDS.map((field) => {
    const definition = FIELD_DEFINITIONS[field];
    const current = definition.read(itinerary);
    const proposed = proposal.fields[field] ?? '';
    const source = effectiveFieldSource(itinerary, field);

    const hasProposal = normalizeFieldValue(proposed).length > 0;
    const willChange = hasProposal && !valuesMatch(current, proposed);
    const isEmpty = normalizeFieldValue(current).length === 0;

    let status: FieldChangeStatus = 'unchanged';
    if (willChange) status = isEmpty ? 'empty' : source;

    const defaultSelected = willChange && (status === 'empty' || status === 'generated');

    return {
      field,
      label: definition.label,
      group: definition.group,
      current,
      proposed,
      source,
      status,
      willChange,
      defaultSelected,
      requiresConfirmation: willChange && (status === 'manual' || status === 'unknown'),
    } satisfies FieldDiff;
  });
}

/** Fields regeneration touches when the traveller does not adjust the selection. */
export const defaultProposalSelection = (diffs: FieldDiff[]): GeneratedField[] =>
  diffs.filter((diff) => diff.defaultSelected).map((diff) => diff.field);

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export interface ApplyProposalResult {
  ok: boolean;
  /** Why the proposal was rejected, when `ok` is false. */
  reason?: 'itinerary-mismatch' | 'profile-changed';
  itinerary: Itinerary;
  applied: GeneratedField[];
}

/**
 * Writes the selected fields and their provenance in one pass, so copy and
 * provenance can never be persisted out of step with each other.
 */
export function applyIdentityProposal(
  itinerary: Itinerary,
  profile: TripProfile,
  proposal: IdentityProposal,
  selection?: Iterable<GeneratedField>,
): ApplyProposalResult {
  if (proposal.itineraryId !== itinerary.id) {
    return { ok: false, reason: 'itinerary-mismatch', itinerary, applied: [] };
  }
  if (proposal.profileRevision !== profileRevision(profile)) {
    return { ok: false, reason: 'profile-changed', itinerary, applied: [] };
  }

  const requested = selection
    ? new Set(selection)
    : new Set(defaultProposalSelection(diffIdentityProposal(itinerary, proposal)));

  let next: Itinerary = { ...itinerary };
  const sources: FieldSourceMap = { ...(itinerary.fieldSources ?? {}) };
  const applied: GeneratedField[] = [];

  for (const field of GENERATED_FIELDS) {
    if (!requested.has(field)) continue;
    const proposed = proposal.fields[field] ?? '';
    if (normalizeFieldValue(proposed).length === 0) continue;

    next = { ...next, ...FIELD_DEFINITIONS[field].write(proposed) };
    sources[field] = {
      source: 'generated',
      generatedValue: proposed,
      generatedAt: proposal.generatedAt,
    };
    applied.push(field);
  }

  return { ok: true, itinerary: { ...next, fieldSources: sources }, applied };
}

/**
 * Marks generated copy as generated. Used when a brand new trip is created,
 * where every field came from the generator.
 */
export function markAllGenerated(
  itinerary: Itinerary,
  proposal: IdentityProposal,
): FieldSourceMap {
  const sources: FieldSourceMap = { ...(itinerary.fieldSources ?? {}) };
  for (const field of GENERATED_FIELDS) {
    const value = proposal.fields[field] ?? '';
    if (normalizeFieldValue(value).length === 0) continue;
    sources[field] = { source: 'generated', generatedValue: value, generatedAt: proposal.generatedAt };
  }
  return sources;
}

/**
 * Records traveller edits. Only fields whose text actually changed become
 * manual, so re-saving a form without touching a field never locks it. Typing
 * the generated wording back in returns the field to generated.
 */
export function markManualFieldEdits(
  itinerary: Itinerary,
  edits: Partial<Record<GeneratedField, string>>,
): Itinerary {
  let next: Itinerary = { ...itinerary };
  const sources: FieldSourceMap = { ...(itinerary.fieldSources ?? {}) };
  let touched = false;

  for (const field of GENERATED_FIELDS) {
    const value = edits[field];
    if (value === undefined) continue;

    const current = FIELD_DEFINITIONS[field].read(itinerary);
    if (valuesMatch(current, value)) continue;

    next = { ...next, ...FIELD_DEFINITIONS[field].write(value) };
    const previous = sources[field];
    const backToGenerated =
      previous?.generatedValue !== undefined && valuesMatch(value, previous.generatedValue);

    sources[field] = {
      source: backToGenerated ? 'generated' : 'manual',
      generatedValue: previous?.generatedValue,
      generatedAt: previous?.generatedAt,
    };
    touched = true;
  }

  return touched ? { ...next, fieldSources: sources } : itinerary;
}
