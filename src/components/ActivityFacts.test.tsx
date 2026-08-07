// @vitest-environment jsdom
/**
 * The itinerary day card's facts row, and the contract it shares with the
 * discovery card.
 *
 * The point of these tests is the *round trip*. It is not enough that a fare
 * renders from an in-memory object: the interesting question is whether what
 * discovery found still renders after it has been through
 * `candidateToActivity`, `sanitizeItinerary`, `JSON.stringify`, and back. That
 * is the path where `indoorOutdoor` and four of seven providers were lost
 * before, silently, with the suite green.
 *
 * So each case builds a real candidate, converts it, saves it, reloads it, and
 * only then asks what the traveller sees.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { admissionChip, admissionLine, describeAdmission } from '../lib/admissionCopy';
import { activityHoursToDateAware, describeOpeningHours } from '../lib/openingHours';
import { candidateToActivity, admissionFor } from '../lib/destinationIntelligence';
import { emptyItinerary, sanitizeItinerary } from '../lib/itinerarySanitize';
import { OSAKA_PLACE_FIXTURE } from '../lib/destinationFixtures';
import type { Activity, Itinerary } from '../data';
import type { PlaceCandidate } from '../lib/destinationIntelligence';

const fixture = (name: string): PlaceCandidate => {
  const found = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === name);
  if (!found) throw new Error(`fixture "${name}" is gone; the test needs updating, not deleting`);
  return found;
};

const tripWith = (activities: Activity[]): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-1',
  days: [{ day: 1, date: '12 Apr', city: 'Osaka', title: 'Day one', activities }],
});

/** Discovery → activity → save → JSON → reload. The whole path, every time. */
const savedAndReloaded = (name: string): Activity => {
  const activity = candidateToActivity(fixture(name));
  const saved = sanitizeItinerary(tripWith([activity]), emptyItinerary);
  const reloaded = sanitizeItinerary(JSON.parse(JSON.stringify(saved)), emptyItinerary);
  return reloaded.days[0].activities[0];
};

describe('a fare still reads correctly after a reload', () => {
  it('survives as an exact amount in the currency it was published in', () => {
    const place = savedAndReloaded('Osaka Castle Museum');
    expect(admissionChip(place.admission)).toMatch(/600/);
  });

  it('keeps every fare, so the details view can still list them', () => {
    const place = savedAndReloaded('Nakanoshima Museum of Art, Osaka');
    const display = describeAdmission(place.admission);
    expect(display.headline).toMatch(/1,?500/);
    expect(display.fares.map((fare) => fare.label)).toEqual(['Student', 'Child']);
  });

  it('keeps free entry as a stated fact rather than a missing one', () => {
    const place = savedAndReloaded('Osaka Castle Park');
    expect(admissionChip(place.admission)).toBe('Free entry');
    expect(describeAdmission(place.admission).sourced).toBe(true);
  });

  it('keeps a market’s hedge without turning it into a price', () => {
    const place = savedAndReloaded('Kuromon Ichiba Market');
    expect(admissionChip(place.admission)).toBe('Pay inside');
    expect(admissionLine(place.admission)).toBe('No admission price published · spending happens inside');
    expect(describeAdmission(place.admission).sourced).toBe(false);
  });

  it('never renders the glyph the old card hardcoded', () => {
    // `¥ {activity.cost}` put a yen sign in front of every price in the world.
    for (const name of ['Osaka Castle Park', 'Kuromon Ichiba Market', 'Shitennoji Temple']) {
      const place = savedAndReloaded(name);
      const chip = admissionChip(place.admission) ?? '';
      expect(chip).not.toMatch(/^¥\s/);
    }
  });
});

describe('the whole week of hours still reads after a reload', () => {
  const hoursFor = (name: string, onDate: string) => {
    const place = savedAndReloaded(name);
    return describeOpeningHours(
      activityHoursToDateAware(place.openingHoursWeek, 'medium', 'Asia/Tokyo'),
      { onDate, timezone: 'Asia/Tokyo' },
    );
  };

  it('answers about the day the traveller will actually be there', () => {
    // 2027-04-12 is a Monday; the museum is published Tue–Sun.
    expect(hoursFor('Nakanoshima Museum of Art, Osaka', '2027-04-12').closedToday).toBe(true);
    expect(hoursFor('Nakanoshima Museum of Art, Osaka', '2027-04-13').closedToday).toBe(false);
  });

  it('keeps both windows of a place that shuts for lunch', () => {
    // `periods[0]` alone would have lost the afternoon on the way to storage.
    const summary = hoursFor('Shitennoji Temple', '2027-04-13');
    expect(summary.weekly[0].windows).toEqual(['08:30–12:00', '13:00–16:30']);
  });

  it('says nothing at all when no hours were ever published', () => {
    const summary = hoursFor('Osaka Castle Park', '2027-04-13');
    expect(summary.unknown).toBe(true);
  });
});

describe('the two surfaces agree', () => {
  it('describes the same place the same way before and after it is planned', () => {
    // A place that says one thing while you are choosing it and another once
    // it is in the plan is the bug this shared module exists to prevent.
    for (const name of ['Osaka Castle Museum', 'Osaka Castle Park', 'Kuromon Ichiba Market']) {
      const beforePlanning = describeAdmission(admissionFor(fixture(name)));
      const afterReload = describeAdmission(savedAndReloaded(name).admission);
      expect(afterReload.headline).toBe(beforePlanning.headline);
      expect(afterReload.note).toBe(beforePlanning.note);
      expect(afterReload.sourced).toBe(beforePlanning.sourced);
    }
  });
});

/**
 * A stand-in for the day card's chip row. `ActivityItem` is 700 lines with a
 * currency context, drag handles and a media recorder; rendering it here would
 * test jsdom's tolerance for `MediaRecorder` rather than the facts row. The
 * chips themselves are pure functions of a reloaded activity, so they are
 * rendered directly against exactly the values the real card computes.
 */
function FactsRow({ activity, dayDate }: { activity: Activity; dayDate: string }) {
  const cost = admissionChip(activity.admission) ?? activity.cost?.trim();
  const hours = describeOpeningHours(
    activityHoursToDateAware(
      activity.openingHoursWeek ?? (activity.openingHours ? [activity.openingHours] : []),
      'medium',
      'Asia/Tokyo',
    ),
    { onDate: dayDate, timezone: 'Asia/Tokyo' },
  );
  const hoursChip = hours.unknown ? undefined : hours.closedToday ? 'Closed this day' : hours.todayLine?.replace(/^Open /, '');
  return (
    <div>
      {cost && <span data-testid="cost">{cost}</span>}
      {hoursChip && <span data-testid="hours">{hoursChip}</span>}
    </div>
  );
}

describe('the rendered row', () => {
  it('shows a price and that day’s hours side by side', () => {
    render(<FactsRow activity={savedAndReloaded('Osaka Castle Museum')} dayDate="2027-04-13" />);
    expect(screen.getByTestId('cost').textContent).toMatch(/600/);
    expect(screen.getByTestId('hours').textContent).toBe('09:00–18:00');
  });

  it('warns when the place is shut on the planned day', () => {
    render(<FactsRow activity={savedAndReloaded('Nakanoshima Museum of Art, Osaka')} dayDate="2027-04-12" />);
    expect(screen.getByTestId('hours').textContent).toBe('Closed this day');
  });

  it('omits the hours chip rather than filling it with a shrug', () => {
    render(<FactsRow activity={savedAndReloaded('Osaka Castle Park')} dayDate="2027-04-13" />);
    expect(screen.queryByTestId('hours')).toBeNull();
    expect(screen.getByTestId('cost').textContent).toBe('Free entry');
  });

  it('still renders a legacy free-text cost from an older record', () => {
    const legacy: Activity = {
      id: 'legacy-1', time: '10:00', name: 'Panda Base', description: '', type: 'sight', cost: '55 RMB',
    };
    const reloaded = sanitizeItinerary(
      JSON.parse(JSON.stringify(sanitizeItinerary(tripWith([legacy]), emptyItinerary))),
      emptyItinerary,
    ).days[0].activities[0];
    render(<FactsRow activity={reloaded} dayDate="2027-04-13" />);
    // As the traveller typed it — no currency glyph bolted on the front.
    expect(screen.getByTestId('cost').textContent).toBe('55 RMB');
  });
});
