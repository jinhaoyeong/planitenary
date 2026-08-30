/**
 * Tests for what an attraction's URLs are allowed to claim.
 *
 * Two strengths, deliberately kept in different places. `website` is a
 * community map tag that has only been checked for safety; `officialLinks`
 * carries authority and may be labelled official. The first version of this put
 * both under `officialLinks`, which was a lie the type told — a field name
 * outvotes any doc comment when the next surface decides what to print.
 */
import { describe, expect, it } from 'vitest';
import { attractionLinksFrom, sanitizeOfficialLinks, sanitizeWebsite } from './officialLinks';
import { candidateToActivity, type PlaceCandidate } from './destinationIntelligence';
import { sanitizeActivity } from './itinerarySanitize';
import type { Activity } from '../data';
import type { PlaceAdmission } from '../../supabase/functions/_shared/placeCost';

const WEBSITE = 'https://www.osakacastle.net/';
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

describe('separating a plausible URL from an authoritative one', () => {
  it('keeps a safe map-tag site as an unverified website', () => {
    expect(attractionLinksFrom({ website: WEBSITE })).toEqual({ website: WEBSITE });
  });

  it('never files an unverified website under official links', () => {
    // The guardrail: nothing reaches `officialLinks` without earning it, so no
    // future surface can read a community tag and print "Official".
    const links = attractionLinksFrom({ website: WEBSITE });
    expect(links.officialLinks).toBeUndefined();
    expect(JSON.stringify(links)).not.toContain('homepage');
  });

  it('keeps a ticket page the venue itself published a fare on', () => {
    expect(attractionLinksFrom({
      website: WEBSITE,
      admissionSource: 'official-website',
      admissionSourceUrl: TICKETS,
    })).toEqual({ website: WEBSITE, officialLinks: { tickets: TICKETS } });
  });

  it('never turns a website into a ticket desk', () => {
    // Charging admission is not evidence of somewhere to buy a ticket.
    expect(attractionLinksFrom({ website: WEBSITE }).officialLinks).toBeUndefined();
    // Nor is the fare having been published on that same page.
    expect(attractionLinksFrom({
      website: WEBSITE,
      admissionSource: 'official-website',
      admissionSourceUrl: WEBSITE,
    })).toEqual({ website: WEBSITE });
    // Including when only a trailing slash or fragment separates them.
    expect(attractionLinksFrom({
      website: WEBSITE,
      admissionSource: 'official-website',
      admissionSourceUrl: 'https://www.osakacastle.net#admission',
    })).toEqual({ website: WEBSITE });
  });

  it('lets only the venue’s own site nominate a ticket page', () => {
    for (const source of ['osm-tag', 'wikivoyage', 'provider', 'category'] as const) {
      expect(attractionLinksFrom({
        website: WEBSITE,
        admissionSource: source,
        admissionSourceUrl: TICKETS,
      })).toEqual({ website: WEBSITE });
    }
  });

  it('allows a ticket host that differs from the website host', () => {
    // Legitimate venues do run tickets.example.com; the evidence for the ticket
    // URL is the admission record, not host equality.
    const ticketsHost = 'https://tickets.osakacastle.net/en/';
    expect(attractionLinksFrom({
      website: WEBSITE,
      admissionSource: 'official-website',
      admissionSourceUrl: ticketsHost,
    })).toEqual({ website: WEBSITE, officialLinks: { tickets: ticketsHost } });
  });

  it('refuses a marketplace in either place', () => {
    for (const reseller of RESELLERS) {
      expect(attractionLinksFrom({ website: reseller })).toEqual({});
      expect(attractionLinksFrom({
        website: reseller,
        admissionSource: 'official-website',
        admissionSourceUrl: reseller,
      })).toEqual({});
      expect(sanitizeWebsite(reseller)).toBeUndefined();
      expect(sanitizeOfficialLinks({ tickets: reseller })).toBeUndefined();
    }
  });

  it('refuses anything unsafe to open', () => {
    for (const unsafe of UNSAFE) {
      expect(attractionLinksFrom({ website: unsafe })).toEqual({});
      expect(sanitizeWebsite(unsafe)).toBeUndefined();
      expect(sanitizeOfficialLinks({ tickets: unsafe })).toBeUndefined();
    }
  });

  it('ignores a stored homepage key rather than promoting it', () => {
    // The shape this correction removed. Re-admitting it would quietly restore
    // the overstatement, so the key is dropped rather than migrated.
    expect(sanitizeOfficialLinks({ homepage: WEBSITE })).toBeUndefined();
    expect(sanitizeOfficialLinks({ homepage: WEBSITE, tickets: TICKETS })).toEqual({ tickets: TICKETS });
  });

  it('stores absence as absence, never an empty object', () => {
    expect(attractionLinksFrom({})).toEqual({});
    expect(sanitizeOfficialLinks({})).toBeUndefined();
    expect(sanitizeOfficialLinks({ tickets: '   ' })).toBeUndefined();
    expect(sanitizeOfficialLinks(undefined)).toBeUndefined();
    expect(sanitizeOfficialLinks(WEBSITE)).toBeUndefined();
    expect(sanitizeWebsite('')).toBeUndefined();
    expect(sanitizeWebsite(undefined)).toBeUndefined();
  });
});

describe('carrying them into a saved plan', () => {
  it('populates both when a candidate becomes an activity', () => {
    const activity = candidateToActivity(candidate({ website: WEBSITE, admission: admission() }));
    expect(activity.website).toBe(WEBSITE);
    expect(activity.officialLinks).toEqual({ tickets: TICKETS });
  });

  it('leaves officialLinks absent when only a website is known', () => {
    const activity = candidateToActivity(candidate({ website: WEBSITE }));
    expect(activity.website).toBe(WEBSITE);
    expect(activity.officialLinks).toBeUndefined();
  });

  it('survives the persistence boundary unchanged', () => {
    const activity = candidateToActivity(candidate({ website: WEBSITE, admission: admission() }));
    const saved = sanitizeActivity(JSON.parse(JSON.stringify(activity)), activity, 0);
    expect(saved.website).toBe(WEBSITE);
    expect(saved.officialLinks).toEqual({ tickets: TICKETS });

    // Idempotent, because the realtime sync compares serialised output.
    const again = sanitizeActivity(JSON.parse(JSON.stringify(saved)), saved, 0);
    expect(again.website).toBe(saved.website);
    expect(again.officialLinks).toEqual(saved.officialLinks);
  });

  it('re-checks stored links rather than trusting them', () => {
    // A saved trip is editable and restorable, so storage has no more standing
    // than the network.
    const tampered = {
      ...candidateToActivity(candidate({ website: WEBSITE })),
      website: RESELLERS[2],
      officialLinks: { tickets: 'http://localhost/x' },
    };
    const saved = sanitizeActivity(JSON.parse(JSON.stringify(tampered)), tampered as Activity, 0);
    expect(saved.website).toBeUndefined();
    expect(saved.officialLinks).toBeUndefined();
  });

  it('drops the link, never the attraction', () => {
    const withBadLink = {
      ...candidateToActivity(candidate({ website: WEBSITE })),
      website: 'javascript:alert(1)',
    };
    const saved = sanitizeActivity(JSON.parse(JSON.stringify(withBadLink)), withBadLink as Activity, 0);
    expect(saved.website).toBeUndefined();
    expect(saved.name).toBe('Osaka Castle');
    expect(saved.durationMinutes).toBe(120);
  });

  it('leaves an older activity with no links perfectly valid', () => {
    const legacy = candidateToActivity(candidate());
    expect(legacy.website).toBeUndefined();
    expect(legacy.officialLinks).toBeUndefined();

    const saved = sanitizeActivity(JSON.parse(JSON.stringify(legacy)), legacy, 0);
    const serialised = JSON.parse(JSON.stringify(saved));
    expect('website' in serialised).toBe(false);
    expect('officialLinks' in serialised).toBe(false);
    expect(saved.name).toBe('Osaka Castle');
  });

  it('does not touch attraction identity', () => {
    // Same place, different links: still the same attraction. A URL that could
    // rename or re-key a place would make losing one create a new activity.
    const bare = candidateToActivity(candidate());
    const linked = candidateToActivity(candidate({ website: WEBSITE, admission: admission() }));
    expect(linked.id).toBe(bare.id);
    expect(linked.placeRef).toEqual(bare.placeRef);
    expect(linked.name).toBe(bare.name);

    const stripped = { ...linked, website: undefined, officialLinks: undefined };
    expect(stripped.id).toBe(linked.id);
  });
});
