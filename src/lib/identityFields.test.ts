import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import {
  applyIdentityProposal,
  buildIdentityProposal,
  defaultProposalSelection,
  diffIdentityProposal,
  effectiveFieldSource,
  markManualFieldEdits,
  normalizeFieldValue,
  profileRevision,
  sanitizeFieldSources,
  type FieldDiff,
  type GeneratedField,
} from './identityFields';
import { buildTripIdentity } from './tripIdentity';
import { createItineraryFromProfile } from './trips';
import { createEmptyProfile, type TripProfile } from './tripProfile';

const kyotoProfile = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [
    { city: 'Kyoto', country: 'Japan', region: 'Kyoto Prefecture', lat: 35.0116, lng: 135.7681 },
  ],
  startDate: '2027-10-04',
  endDate: '2027-10-11',
  tripTypes: ['food'],
  styles: ['cafes', 'temples'],
  moods: ['slow-living'],
  budgetTier: 'mid-range',
  tripCurrency: 'JPY',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const proposalFor = (itinerary: Itinerary, profile: TripProfile, generatedAt = '2026-02-01T00:00:00.000Z') =>
  buildIdentityProposal(
    itinerary,
    profile,
    buildTripIdentity(profile, { plannedDays: itinerary.days.length, now: new Date('2026-02-01T00:00:00.000Z') }),
    generatedAt,
  );

const find = (diffs: FieldDiff[], field: GeneratedField) => {
  const diff = diffs.find((entry) => entry.field === field);
  if (!diff) throw new Error(`missing diff for ${field}`);
  return diff;
};

describe('normalizeFieldValue', () => {
  it('ignores accidental whitespace', () => {
    expect(normalizeFieldValue('  Kyoto   Autumn Escape  ')).toBe('Kyoto Autumn Escape');
    expect(normalizeFieldValue('one\r\ntwo')).toBe('one\ntwo');
  });

  it('keeps punctuation and capitalisation differences', () => {
    expect(normalizeFieldValue('Kyoto, autumn')).not.toBe(normalizeFieldValue('Kyoto autumn'));
    expect(normalizeFieldValue('kyoto autumn')).not.toBe(normalizeFieldValue('Kyoto Autumn'));
  });
});

describe('trip creation', () => {
  it('marks every generated field as generated', () => {
    const itinerary = createItineraryFromProfile(kyotoProfile(), 'trip-1');

    expect(itinerary.fieldSources?.name?.source).toBe('generated');
    expect(itinerary.fieldSources?.description?.source).toBe('generated');
    expect(itinerary.fieldSources?.name?.generatedValue).toBe(itinerary.name);
    expect(effectiveFieldSource(itinerary, 'description')).toBe('generated');
  });
});

describe('diffIdentityProposal', () => {
  it('refreshes generated fields and preserves manual ones', () => {
    const profile = kyotoProfile();
    const created = createItineraryFromProfile(profile, 'trip-1');
    const edited = markManualFieldEdits(created, { description: 'My personal Kyoto food journey.' });

    const changed = kyotoProfile({ budgetTier: 'luxury', moods: ['romantic'], styles: ['shopping'] });
    const diffs = diffIdentityProposal(edited, proposalFor(edited, changed));

    const description = find(diffs, 'description');
    expect(description.source).toBe('manual');
    expect(description.status).toBe('manual');
    expect(description.defaultSelected).toBe(false);
    expect(description.requiresConfirmation).toBe(true);

    const heroEyebrow = find(diffs, 'heroEyebrow');
    expect(heroEyebrow.source).toBe('generated');
    expect(heroEyebrow.willChange).toBe(true);
    expect(heroEyebrow.defaultSelected).toBe(true);
  });

  it('treats copy saved before provenance existed as unknown and protects it', () => {
    const legacy: Itinerary = {
      id: 'trip-legacy',
      name: 'Grandma’s Kyoto trip',
      description: 'Written by hand long before the generator existed.',
      cities: ['Kyoto'],
      days: [],
    };

    const diffs = diffIdentityProposal(legacy, proposalFor(legacy, kyotoProfile()));
    const name = find(diffs, 'name');

    expect(name.source).toBe('unknown');
    expect(name.status).toBe('unknown');
    expect(name.willChange).toBe(true);
    expect(name.defaultSelected).toBe(false);
    expect(defaultProposalSelection(diffs)).not.toContain('name');
    expect(defaultProposalSelection(diffs)).not.toContain('description');
  });

  it('fills empty fields even when their provenance is unknown', () => {
    const legacy: Itinerary = {
      id: 'trip-legacy',
      name: 'Grandma’s Kyoto trip',
      description: 'Written by hand.',
      cities: ['Kyoto'],
      days: [],
    };

    const searchPlaceholder = find(
      diffIdentityProposal(legacy, proposalFor(legacy, kyotoProfile())),
      'searchPlaceholder',
    );

    expect(searchPlaceholder.current).toBe('');
    expect(searchPlaceholder.status).toBe('empty');
    expect(searchPlaceholder.defaultSelected).toBe(true);
  });

  it('reports identical copy as unchanged', () => {
    const profile = kyotoProfile();
    const created = createItineraryFromProfile(profile, 'trip-1');
    const diffs = diffIdentityProposal(created, proposalFor(created, profile));

    expect(diffs.every((diff) => !diff.willChange)).toBe(true);
    expect(defaultProposalSelection(diffs)).toHaveLength(0);
  });

  it('does not treat a whitespace-only difference as an edit', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const respaced = markManualFieldEdits(created, { name: `  ${created.name}  ` });

    expect(respaced.fieldSources?.name?.source).toBe('generated');
    expect(effectiveFieldSource(respaced, 'name')).toBe('generated');
  });

  it('protects generated fields that drifted without going through the editor', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const tampered: Itinerary = { ...created, description: 'Edited by a direct write.' };

    expect(tampered.fieldSources?.description?.source).toBe('generated');
    expect(effectiveFieldSource(tampered, 'description')).toBe('manual');

    const diffs = diffIdentityProposal(tampered, proposalFor(tampered, kyotoProfile({ budgetTier: 'luxury' })));
    expect(find(diffs, 'description').defaultSelected).toBe(false);
  });
});

describe('applyIdentityProposal', () => {
  it('applies exactly what the preview said it would', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const edited = markManualFieldEdits(created, { description: 'My personal Kyoto food journey.' });
    const changed = kyotoProfile({ budgetTier: 'luxury', moods: ['romantic'], styles: ['shopping'] });

    const proposal = proposalFor(edited, changed);
    const diffs = diffIdentityProposal(edited, proposal);
    const previewed = defaultProposalSelection(diffs);

    const result = applyIdentityProposal(edited, changed, proposal, previewed);

    expect(result.ok).toBe(true);
    expect(result.applied).toEqual(previewed);

    for (const diff of diffs) {
      const after = diffIdentityProposal(result.itinerary, proposal).find((entry) => entry.field === diff.field);
      if (previewed.includes(diff.field)) {
        expect(after?.current).toBe(diff.proposed);
      } else {
        expect(after?.current).toBe(diff.current);
      }
    }

    expect(result.itinerary.description).toBe('My personal Kyoto food journey.');
    expect(result.itinerary.fieldSources?.description?.source).toBe('manual');
  });

  it('leaves manual and unknown copy untouched by default', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const edited = markManualFieldEdits(created, { name: 'Kyoto, my way' });
    const legacyMix: Itinerary = {
      ...edited,
      coverHeadline: 'A cover line from an older version.',
      fieldSources: { ...edited.fieldSources, coverHeadline: undefined },
    };

    const changed = kyotoProfile({ budgetTier: 'luxury', tripTypes: ['photography'] });
    const proposal = proposalFor(legacyMix, changed);
    const result = applyIdentityProposal(legacyMix, changed, proposal);

    expect(result.itinerary.name).toBe('Kyoto, my way');
    expect(result.itinerary.coverHeadline).toBe('A cover line from an older version.');
    expect(result.applied).not.toContain('name');
    expect(result.applied).not.toContain('coverHeadline');
  });

  it('overwrites a protected field when it is explicitly selected, then owns it again', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const edited = markManualFieldEdits(created, { description: 'My personal Kyoto food journey.' });
    const changed = kyotoProfile({ budgetTier: 'luxury', styles: ['shopping', 'nightlife'] });

    const proposal = proposalFor(edited, changed);
    const result = applyIdentityProposal(edited, changed, proposal, ['description']);

    expect(result.ok).toBe(true);
    expect(result.itinerary.description).toBe(proposal.fields.description);
    expect(result.itinerary.fieldSources?.description?.source).toBe('generated');
    expect(effectiveFieldSource(result.itinerary, 'description')).toBe('generated');
  });

  it('refuses a proposal whose profile changed after the preview was built', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const proposal = proposalFor(created, kyotoProfile());
    const result = applyIdentityProposal(created, kyotoProfile({ budgetTier: 'luxury' }), proposal);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('profile-changed');
    expect(result.itinerary).toBe(created);
  });

  it('refuses a proposal built for a different trip', () => {
    const profile = kyotoProfile();
    const created = createItineraryFromProfile(profile, 'trip-1');
    const other = createItineraryFromProfile(profile, 'trip-2');
    const result = applyIdentityProposal(other, profile, proposalFor(created, profile));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('itinerary-mismatch');
  });

  it('writes value and provenance together', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const changed = kyotoProfile({ styles: ['shopping'], moods: ['festive'] });
    const proposal = proposalFor(created, changed);
    const result = applyIdentityProposal(created, changed, proposal);

    for (const field of result.applied) {
      expect(result.itinerary.fieldSources?.[field]?.generatedValue).toBe(proposal.fields[field]);
      expect(result.itinerary.fieldSources?.[field]?.generatedAt).toBe(proposal.generatedAt);
    }
  });
});

describe('markManualFieldEdits', () => {
  it('only marks fields whose text actually changed', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const saved = markManualFieldEdits(created, {
      name: created.name,
      description: 'Rewritten by hand.',
    });

    expect(saved.fieldSources?.name?.source).toBe('generated');
    expect(saved.fieldSources?.description?.source).toBe('manual');
  });

  it('returns the field to generated when the generated wording is typed back', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const generated = created.description;
    const edited = markManualFieldEdits(created, { description: 'Rewritten by hand.' });
    const restored = markManualFieldEdits(edited, { description: generated });

    expect(restored.fieldSources?.description?.source).toBe('generated');
  });

  it('tracks marquee lists as one field', () => {
    const created = createItineraryFromProfile(kyotoProfile(), 'trip-1');
    const edited = markManualFieldEdits(created, { marquee: 'Kyoto\nRamen\nTrains' });

    expect(edited.marqueeItems).toEqual(['Kyoto', 'Ramen', 'Trains']);
    expect(edited.fieldSources?.marquee?.source).toBe('manual');
  });
});

describe('sanitizeFieldSources', () => {
  it('drops unknown keys and downgrades unrecognised sources', () => {
    const sources = sanitizeFieldSources({
      name: { source: 'manual' },
      notAField: { source: 'generated' },
      description: { source: 'nonsense' },
    });

    expect(sources?.name?.source).toBe('manual');
    expect(sources?.description?.source).toBe('unknown');
    expect(sources && 'notAField' in sources).toBe(false);
  });

  it('returns undefined for junk', () => {
    expect(sanitizeFieldSources(null)).toBeUndefined();
    expect(sanitizeFieldSources('nope')).toBeUndefined();
  });
});

describe('profileRevision', () => {
  it('is stable for equal profiles and changes with content', () => {
    expect(profileRevision(kyotoProfile())).toBe(profileRevision(kyotoProfile()));
    expect(profileRevision(kyotoProfile())).not.toBe(profileRevision(kyotoProfile({ budgetTier: 'luxury' })));
  });
});
