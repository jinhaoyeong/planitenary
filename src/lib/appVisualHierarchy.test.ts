import { describe, expect, it } from 'vitest';
import { appShellVisualMode, mapEmptyStateCopy } from './appVisualHierarchy';

describe('app visual hierarchy', () => {
  it('keeps the full editorial cover for the trip-entry itinerary chapter', () => {
    expect(appShellVisualMode('itinerary')).toBe('full-hero');
  });

  it.each(['maps', 'draft', 'budget', 'checklist', 'documents', 'photos', 'settings', 'profile'])(
    'uses a compact chapter prelude for %s',
    (section) => {
      expect(appShellVisualMode(section)).toBe('compact-chapter');
    },
  );
});

describe('map empty-state semantics', () => {
  it('explains how to add the first saved place', () => {
    expect(mapEmptyStateCopy(0)).toEqual({
      title: 'No saved places yet.',
      detail: 'Add a located activity or search above to place the first pin on this trip.',
    });
  });

  it('mentions filters only when saved places exist', () => {
    expect(mapEmptyStateCopy(3)).toEqual({
      title: 'No places match these filters.',
      detail: 'Choose All Cities and All Locations to see every saved place.',
    });
  });
});
