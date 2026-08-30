/**
 * Tests for what an attraction's URLs are allowed to claim.
 *
 * The failure being defended against is the one just fixed for prices: a
 * single `website` field would make every surface guess whether it holds an
 * operator's homepage, their ticket desk, or a marketplace — and a button
 * saying "Tickets" is honest for exactly one of those.
 */
import { describe, expect, it } from 'vitest';
import { officialLinksFrom, sanitizeOfficialLinks } from './officialLinks';
import { candidateToActivity, type PlaceCandidate } from './destinationIntelligence';
import { sanitizeActivity } from './itinerarySanitize';
import type { Activity } from '../data';
import type { PlaceAdmission } from '../../supabase/functions/_shared/placeCost';

const HOMEPAGE = 'https://www.osakacastle.net/';
const TICKETS = 'https://www.osakacastle.net/tickets/';

const RESELLERS = [
  'https://www.viator.com/tours/Osaka/x/d123',
  'https://www.getyourguide.com/osaka-l123/x',
  'https://www.klook.com/en-MY/activity/123-osaka/',
  'https://www.tiqets.com/en/osaka-x/',
  'https://www.headout.com/osaka-x/',
];

const UNSAFE = [
  'http://localhost/admin',
  'https://192.168.1.1/tickets',
  'https://10.0.0.5/',
  'https://169.254.169.254/latest/meta-data/',
  'javascript:alert(1)',
  'ftp://example.org/',
  'not a url at all',
];

const admission = (over: Partial<PlaceAdmission> = {}): PlaceAdmission => ({
  class: 'ticketed',
  source: 'official-website',
  sourceUrl: TICKETS,
  fares: [{ audience: 'adult', amount: 600, currency: 'JPY' }],
  ...over,
} as PlaceAdmission);

const candidate = (over: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  id: 'osaka-castle',
  provider: 'osm',
  // candidateToActivity refuses a candidate it cannot schedule, so the fixture
  // carries the factual minimum: a provider id, coordinates and a category.
  providerPlaceId: 'osm:node/123',
  coordinates: [34.687, 135.526] as [number, number],
  name: 'Osaka Castle',
  countryCode: 'JP',
  city: 'Osaka',
  categories: ['castle'],
  experienceTags: ['history'],
  estimatedVisitMinutes: 120,
  indoorOutdoor: 'mixed',
  reservationStatus: 'not-needed',
  sourceConfidence: 'high',
  sourceReferences: [],
  lastVerifiedAt: '2027-01-20T00:00:00Z',
  ...over,
});

describe('classifying an attraction’s own URLs', () => {
  it('keeps a safe operator site as a homepage', () => {
    expect(officialLinksFrom({ website: HOMEPAGE })).toEqual({ homepage: HOMEPAGE });
  });

  it('keeps a ticket page the venue itself published a fare on', () => {
    expect(officialLinksFrom({
      website: HOMEPAGE,
      admissionSource: 'official-website',
      admissionSourceUrl: TICKETS,
    })).toEqual({ homepage: HOMEPAGE, tickets: TICKETS });
  });

  it('never turns a homepage into a ticket desk', () => {
    // Charging admission is not evidence of somewhere to buy a ticket.
    expect(officialLinksFrom({ website: HOMEPAGE })).toEqual({ homepage: HOMEPAGE });
    // Nor is the fare having been published on the homepage itself.
    expect(officialLinksFrom({
      website: HOMEPAGE,
      admissionSource: 'official-website',
      admissionSourceUrl: HOMEPAGE,
    })).toEqual({ homepage: HOMEPAGE });
    // Including when only a trailing slash or fragment separates them.
    expect(officialLinksFrom({
      website: HOMEPAGE,
      admissionSource: 'official-website',
      admissionSourceUrl: 'https://www.osakacastle.net#admission',
    })).toEqual({ homepage: HOMEPAGE });
  });

  it('lets only the venue’s own site nominate a ticket page', () => {
    for (const source of ['osm-tag', 'wikivoyage', 'provider', 'category'] as const) {
      expect(officialLinksFrom({
        website: HOMEPAGE,
        admissionSource: source,
        admissionSourceUrl: TICKETS,
      })).toEqual({ homepage: HOMEPAGE });
    }
  });

  it('refuses a marketplace in either field', () => {
    for (const reseller of RESELLERS) {
      expect(officialLinksFrom({ website: reseller })).toBeUndefined();
      expect(officialLinksFrom({
        website: reseller,
        admissionSource: 'official-website',
        admissionSourceUrl: reseller,
      })).toBeUndefined();
      expect(sanitizeOfficialLinks({ homepage: reseller, tickets: reseller })).toBeUndefined();
    }
  });

  it('refuses anything unsafe to open', () => {
    for (const unsafe of UNSAFE) {
      expect(officialLinksFrom({ website: unsafe })).toBeUndefined();
      expect(sanitizeOfficialLinks({ homepage: unsafe })).toBeUndefined();
    }
  });

  it('drops only the bad half of a pair', () => {
    expect(sanitizeOfficialLinks({ homepage: HOMEPAGE, tickets: RESELLERS[0] }))
      .toEqual({ homepage: HOMEPAGE });
    expect(sanitizeOfficialLinks({ homepage: 'http://localhost/', tickets: TICKETS }))
      .toEqual({ tickets: TICKETS });
  });

  it('stores absence as absence, never an empty object', () => {
    expect(officialLinksFrom({})).toBeUndefined();
    expect(sanitizeOfficialLinks({})).toBeUndefined();
    expect(sanitizeOfficialLinks({ homepage: '', tickets: '   ' })).toBeUndefined();
    expect(sanitizeOfficialLinks(undefined)).toBeUndefined();
    expect(sanitizeOfficialLinks('https://www.osakacastle.net/')).toBeUndefined();
  });

  it('allows a ticket host that differs from the homepage host', () => {
    // Legitimate venues do run tickets.example.com; the evidence for the
    // ticket URL is the admission record, not host equality.
    const ticketsHost = 'https://tickets.osakacastle.net/en/';
    expect(officialLinksFrom({
      website: HOMEPAGE,
      admissionSource: 'official-website',
      admissionSourceUrl: ticketsHost,
    })).toEqual({ homepage: HOMEPAGE, tickets: ticketsHost });
  });
});

describe('carrying them into a saved plan', () => {
  it('populates them when a candidate becomes an activity', () => {
    const activity = candidateToActivity(candidate({ website: HOMEPAGE, admission: admission() }));
    expect(activity.officialLinks).toEqual({ homepage: HOMEPAGE, tickets: TICKETS });
  });

  it('survives the persistence boundary unchanged', () => {
    const activity = candidateToActivity(candidate({ website: HOMEPAGE, admission: admission() }));
    const saved = sanitizeActivity(JSON.parse(JSON.stringify(activity)), activity, 0);
    expect(saved.officialLinks).toEqual({ homepage: HOMEPAGE, tickets: TICKETS });

    // Idempotent, because the realtime sync compares serialised output.
    const again = sanitizeActivity(JSON.parse(JSON.stringify(saved)), saved, 0);
    expect(again.officialLinks).toEqual(saved.officialLinks);
  });

  it('re-checks stored links rather than trusting them', () => {
    // A saved trip is editable and restorable, so storage has no more standing
    // than the network.
    const tampered = {
      ...candidateToActivity(candidate({ website: HOMEPAGE })),
      officialLinks: { homepage: RESELLERS[2], tickets: 'http://localhost/x' },
    };
    const saved = sanitizeActivity(JSON.parse(JSON.stringify(tampered)), tampered as Activity, 0);
    expect(saved.officialLinks).toBeUndefined();
  });

  it('drops the link, never the attraction', () => {
    const withBadLink = {
      ...candidateToActivity(candidate({ website: HOMEPAGE })),
      officialLinks: { homepage: 'javascript:alert(1)' },
    };
    const saved = sanitizeActivity(JSON.parse(JSON.stringify(withBadLink)), withBadLink as Activity, 0);
    expect(saved.officialLinks).toBeUndefined();
    expect(saved.name).toBe('Osaka Castle');
    expect(saved.durationMinutes).toBe(120);
  });

  it('leaves an older activity with no links perfectly valid', () => {
    const legacy = candidateToActivity(candidate());
    expect(legacy.officialLinks).toBeUndefined();
    const saved = sanitizeActivity(JSON.parse(JSON.stringify(legacy)), legacy, 0);
    expect(saved.officialLinks).toBeUndefined();
    expect('officialLinks' in JSON.parse(JSON.stringify(saved))).toBe(false);
    expect(saved.name).toBe('Osaka Castle');
  });

  it('does not touch attraction identity', () => {
    // Same place, different links: still the same attraction. A URL that could
    // rename or re-key a place would make losing one create a new activity.
    const bare = candidateToActivity(candidate());
    const linked = candidateToActivity(candidate({ website: HOMEPAGE, admission: admission() }));
    expect(linked.id).toBe(bare.id);
    expect(linked.placeRef).toEqual(bare.placeRef);
    expect(linked.name).toBe(bare.name);

    const stripped = { ...linked, officialLinks: undefined };
    expect(stripped.id).toBe(linked.id);
  });
});
