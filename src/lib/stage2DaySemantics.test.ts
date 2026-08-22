/** Stage 2: planners may move activities, never the overnight base by accident. */
import { describe, expect, it, vi } from 'vitest';
import {
  applyProposalToItinerary,
  validateStagedChange,
} from '../../supabase/functions/_shared/itineraryChange';
import {
  buildPlanningMaterial,
  runItineraryProposalEngine,
  validateItineraryProposal,
  type ModelItineraryComposition,
  type RouteMatrixLeg,
} from '../../supabase/functions/_shared/itineraryProposal';
import { activityCitiesFrom } from '../../supabase/functions/_shared/dayCitySemantics';
import { applyItineraryProposal, optimiseTrip } from './tripIntelligence';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import { createEmptyProfile, manualDestination } from './tripProfile';

const points: Record<string, [number, number]> = {
  Osaka: [34.6687, 135.5013],
  Kyoto: [34.9671, 135.7727],
  Kobe: [34.6901, 135.1955],
};

const place = (id: string, city?: string) => ({
  id,
  kind: 'place',
  time: '09:00',
  durationMinutes: 60,
  name: `${city ?? 'Unknown'} ${id}`,
  description: 'Provider-backed place',
  type: 'sight',
  city,
  location: city ? `${city} central` : 'Recorded area',
  provider: 'osm',
  providerPlaceId: id,
  coordinates: city ? points[city] : [34.7, 135.5],
  openingHoursWeek: [{ opensAt: '08:00', closesAt: '22:00', days: [0, 1, 2, 3, 4, 5, 6] }],
  lockedFields: [],
});

const transport = {
  id: 'osaka-kyoto-transfer',
  kind: 'transport',
  time: '14:00',
  durationMinutes: 150,
  name: 'Osaka to Kyoto',
  description: 'Saved Shinkansen transfer',
  type: 'travel',
};

const day = (number: number, stayCity: string, activities: unknown[]) => ({
  day: number,
  date: `2026-08-${String(10 + number).padStart(2, '0')}`,
  stayCity,
  activityCities: [],
  city: stayCity,
  title: `Day ${number}`,
  activities,
});

const itinerary = (days: unknown[]) => sanitizeItinerary({
  ...emptyItinerary,
  id: 'stage-2-trip',
  name: 'Kansai',
  cities: ['Osaka', 'Kyoto', 'Kobe'],
  revision: 4,
  tripProfile: {
    destinations: [
      { city: 'Osaka', countryCode: 'JP' },
      { city: 'Kyoto', countryCode: 'JP' },
      { city: 'Kobe', countryCode: 'JP' },
    ],
    styles: [],
    transport: ['public-transport'],
  },
  days,
}, emptyItinerary);

const matrix = (ids: string[]): RouteMatrixLeg[] => ids.flatMap((from) => ids.flatMap((to) => from === to ? [] : [{
  fromPlaceId: from,
  toPlaceId: to,
  status: 'ok' as const,
  durationMinutes: 30,
  distanceMeters: 35_000,
  mode: 'public-transport' as const,
  source: 'provider' as const,
}]));

const propose = async (source: ReturnType<typeof itinerary>, composition: ModelItineraryComposition) => {
  const material = await buildPlanningMaterial(source.id, source);
  const proposal = await runItineraryProposalEngine(material, {
    chooseComposition: vi.fn().mockResolvedValue(composition),
    getRouteMatrix: vi.fn().mockResolvedValue(matrix(material.places.map((entry) => entry.id))),
    now: () => '2026-08-10T08:00:00.000Z',
  });
  return { material, proposal };
};

describe('Stage 2 day-trip production', () => {
  it('keeps an Osaka stay while recording Kyoto activities through Apply and reload', async () => {
    const source = itinerary([day(1, 'Osaka', [place('fushimi', 'Kyoto'), place('gion', 'Kyoto')])]);
    const { proposal } = await propose(source, { days: [{ day: 1, placeIds: ['fushimi', 'gion'] }] });
    const proposed = proposal.days[0];

    expect(proposed).toMatchObject({ stayCity: 'Osaka', city: 'Osaka', activityCities: ['Kyoto'] });
    expect(proposed.transfer).toBeUndefined();

    const applied = applyProposalToItinerary(source, proposal);
    expect(validateStagedChange(proposal, applied).ok).toBe(true);
    const reloaded = sanitizeItinerary(applied.itinerary, source);
    expect(reloaded.days[0]).toMatchObject({ stayCity: 'Osaka', city: 'Osaka', activityCities: ['Kyoto'] });
  });

  it('records a Kobe day trip from Kyoto and leaves same-city days compact', async () => {
    const crossCity = itinerary([day(1, 'Kyoto', [place('harbor', 'Kobe')])]);
    const sameCity = itinerary([day(1, 'Osaka', [place('castle', 'Osaka')])]);
    const crossProposal = (await propose(crossCity, { days: [{ day: 1, placeIds: ['harbor'] }] })).proposal;
    const sameProposal = (await propose(sameCity, { days: [{ day: 1, placeIds: ['castle'] }] })).proposal;

    expect(crossProposal.days[0]).toMatchObject({ stayCity: 'Kyoto', city: 'Kyoto', activityCities: ['Kobe'] });
    expect(sameProposal.days[0]).toMatchObject({ stayCity: 'Osaka', city: 'Osaka', activityCities: [] });
  });

  it('does not fabricate an unknown activity city from the stay', async () => {
    const source = itinerary([day(1, 'Osaka', [place('mystery')])]);
    const { material, proposal } = await propose(source, { days: [{ day: 1, placeIds: ['mystery'] }] });

    expect(material.places[0]?.city).toBe('');
    expect(proposal.days[0]?.activityCities).toEqual([]);
    expect(proposal.days[0]?.items[0]?.activityCity).toBeUndefined();
  });

  it('rejects activity-city claims that do not match scheduled place evidence', async () => {
    const source = itinerary([day(1, 'Osaka', [place('fushimi', 'Kyoto')])]);
    const { material, proposal } = await propose(source, { days: [{ day: 1, placeIds: ['fushimi'] }] });
    const unsafe = structuredClone(proposal.days);
    unsafe[0].activityCities = ['Osaka'];

    expect(validateItineraryProposal(unsafe, material)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'activity-city-mismatch', day: 1, severity: 'error' }),
    ]));
  });

  it('deduplicates activity cities deterministically without collapsing a mixed day', () => {
    expect(activityCitiesFrom(['Osaka', 'kyoto', 'Kyoto', ' Osaka '], 'Osaka'))
      .toEqual(['Osaka', 'kyoto']);
  });
});

describe('Stage 2 transfer persistence and stay-base authority', () => {
  it('persists an Osaka to Kyoto base move only when fixed transport authorizes it', async () => {
    const source = itinerary([
      day(1, 'Osaka', [place('castle', 'Osaka'), transport, place('gion', 'Kyoto')]),
      day(2, 'Kyoto', []),
    ]);
    const { material, proposal } = await propose(source, {
      days: [{ day: 1, placeIds: ['castle', 'gion'] }, { day: 2, placeIds: [] }],
    });

    expect(material.days[0]?.windows?.map((window) => window.city)).toEqual(['Osaka', 'Kyoto']);
    expect(proposal.days[0]).toMatchObject({
      stayCity: 'Kyoto',
      city: 'Kyoto',
      activityCities: ['Osaka', 'Kyoto'],
      transfer: { from: 'Osaka', to: 'Kyoto' },
    });

    const applied = applyProposalToItinerary(source, proposal);
    expect(applied.unauthorizedBaseChanges).toEqual([]);
    expect(validateStagedChange(proposal, applied).ok).toBe(true);
    const reloaded = sanitizeItinerary(applied.itinerary, source);
    expect(reloaded.days[0]).toMatchObject({
      stayCity: 'Kyoto',
      city: 'Kyoto',
      transfer: { from: 'Osaka', to: 'Kyoto' },
    });
    const rebuilt = await buildPlanningMaterial(source.id, reloaded);
    expect(rebuilt.days[0]).toMatchObject({
      stayCity: 'Kyoto',
      city: 'Kyoto',
      transfer: { from: 'Osaka', to: 'Kyoto' },
    });
    expect(rebuilt.days[0]?.windows?.map((window) => window.city)).toEqual(['Osaka', 'Kyoto']);
  });

  it('rejects a proposed base change with no transfer authority', async () => {
    const source = itinerary([day(1, 'Osaka', [place('fushimi', 'Kyoto')])]);
    const { proposal } = await propose(source, { days: [{ day: 1, placeIds: ['fushimi'] }] });
    const unsafe = structuredClone(proposal);
    unsafe.days[0].stayCity = 'Kyoto';
    unsafe.days[0].city = 'Kyoto';
    unsafe.days[0].activityCities = [];
    delete unsafe.days[0].transfer;

    const applied = applyProposalToItinerary(source, unsafe);
    expect(applied.unauthorizedBaseChanges).toEqual([{ day: 1, from: 'Osaka', to: 'Kyoto' }]);
    expect(validateStagedChange(unsafe, applied)).toMatchObject({ ok: false });
    expect(validateStagedChange(unsafe, applied).blocking.join(' ')).toMatch(/Day 1.*Osaka.*Kyoto.*authorized transfer/i);
  });

  it('rejects a transfer claim that fixed transport did not authorize', async () => {
    const source = itinerary([day(1, 'Osaka', [place('castle', 'Osaka')])]);
    const { material, proposal } = await propose(source, { days: [{ day: 1, placeIds: ['castle'] }] });
    const unsafe = structuredClone(proposal.days);
    unsafe[0].transfer = { from: 'Osaka', to: 'Kyoto' };

    expect(validateItineraryProposal(unsafe, material)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unauthorized-base-change', day: 1, severity: 'error' }),
    ]));
  });

  it('makes the local Smart Plan boundary reject a silent stay mutation', () => {
    const source = itinerary([day(1, 'Osaka', [place('castle', 'Osaka')])]);
    const profile = {
      ...createEmptyProfile('MYR'),
      destinations: [manualDestination('Osaka', 'Japan'), manualDestination('Kyoto', 'Japan')],
      dayCount: 1,
      transport: ['public-transport' as const],
    };
    const proposal = optimiseTrip(source, profile);
    proposal.afterDays[0].stayCity = 'Kyoto';
    proposal.afterDays[0].city = 'Kyoto';
    delete proposal.afterDays[0].transfer;

    const result = applyItineraryProposal(source, profile, proposal);
    expect(result).toMatchObject({ ok: false, reason: 'unauthorized-base-change', itinerary: source });
  });

  it('keeps the stay and recorded day-trip city through an ordinary Smart Plan rebalance', () => {
    const source = itinerary([{
      ...day(1, 'Osaka', [place('fushimi', 'Kyoto')]),
      activityCities: ['Kyoto'],
    }]);
    const profile = {
      ...createEmptyProfile('MYR'),
      destinations: [manualDestination('Osaka', 'Japan'), manualDestination('Kyoto', 'Japan')],
      dayCount: 1,
      transport: ['public-transport' as const],
    };

    const proposal = optimiseTrip(source, profile);

    expect(proposal.afterDays[0]).toMatchObject({
      stayCity: 'Osaka',
      city: 'Osaka',
      activityCities: ['Kyoto'],
    });
    expect(proposal.afterDays[0].transfer).toBeUndefined();
  });

  it('keeps Smart Plan compatible with a legacy day that has no activityCities field', () => {
    const source = itinerary([day(1, 'Osaka', [place('castle', 'Osaka')])]);
    delete (source.days[0] as Partial<typeof source.days[number]>).activityCities;
    const profile = {
      ...createEmptyProfile('MYR'),
      destinations: [manualDestination('Osaka', 'Japan')],
      dayCount: 1,
      transport: ['public-transport' as const],
    };

    expect(optimiseTrip(source, profile).afterDays[0]).toMatchObject({
      stayCity: 'Osaka',
      city: 'Osaka',
      activityCities: [],
    });
  });
});
