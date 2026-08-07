// @vitest-environment jsdom
/**
 * The details panel — the screen a traveller told us was useless.
 *
 * > "the cost is unknown… i dont get the opening hour… why it rank here feels
 * > hardcoded as well… generic and surface default hardcode style answer"
 *
 * Until now nothing tested what this rendered at all. `DeckCard.test.tsx`
 * covers flip mechanics and decision routing and asserts nothing about the
 * content, which is how a panel that printed `09:00–17:00 · high confidence`
 * and `Cost unknown` on nearly every card stayed green through every run.
 *
 * The candidates here are real fixtures ranked by the real ranker, not
 * hand-built literals: a shape that drifts from what the ranker produces would
 * test something nothing renders.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CandidateDetails } from './DestinationDiscoveryPanel';
import { OSAKA_PLACE_FIXTURE } from '../lib/destinationFixtures';
import { rankWithIntelligence } from '../lib/destinationPlanner';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import type { PlaceCandidate, RankedCandidate } from '../lib/destinationIntelligence';

/** A trip that spans a Monday — 2027-04-12 — so a weekly closure can land on it. */
const osakaProfile = (): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2027-04-10',
  endDate: '2027-04-17',
  dayCount: 8,
  styles: ['temples', 'history', 'museums'],
});

const rankedFor = (name: string): RankedCandidate => {
  const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, osakaProfile());
  const found = ranked.find((entry) => entry.candidate.name === name);
  if (!found) throw new Error(`fixture "${name}" is gone; the test needs updating, not deleting`);
  return found;
};

/** Swap one field on a real ranked candidate, keeping everything else honest. */
const withCandidate = (base: RankedCandidate, over: Partial<PlaceCandidate>): RankedCandidate => ({
  ...base,
  candidate: { ...base.candidate, ...over },
});

const FIXED_NOW = new Date('2027-04-13T04:00:00Z'); // Tuesday, 13:00 in Tokyo

const show = (ranked: RankedCandidate, context: Record<string, unknown> = {}) => {
  render(<CandidateDetails ranked={ranked} context={{ now: FIXED_NOW, ...context } as never} />);
};

const body = () => document.body.textContent ?? '';

describe('the string that started it', () => {
  it('never says "Cost unknown", whatever the place', () => {
    for (const candidate of OSAKA_PLACE_FIXTURE.slice(0, 12)) {
      const ranked = rankedFor(candidate.name);
      const { unmount } = render(<CandidateDetails ranked={ranked} context={{ now: FIXED_NOW } as never} />);
      expect(document.body.textContent).not.toMatch(/cost unknown/i);
      expect(document.body.textContent).not.toMatch(/price level/i);
      unmount();
    }
  });

  it('never prints the raw confidence enum beside the hours', () => {
    // `09:00–17:00 · high confidence` named a rating instead of a reason.
    show(rankedFor('Osaka Castle Museum'));
    expect(body()).not.toMatch(/·\s*(high|medium|low)\s+confidence/i);
  });
});

describe('cost, above the fold', () => {
  it('shows the exact fare and currency when a source published one', () => {
    show(rankedFor('Osaka Castle Museum'));
    expect(screen.getByText('Cost')).toBeTruthy();
    expect(body()).toMatch(/600/);
    expect(body()).toMatch(/adult ticket/i);
  });

  it('lists the other fares rather than hiding them behind the headline', () => {
    show(rankedFor('Nakanoshima Museum of Art, Osaka'));
    expect(body()).toMatch(/1,?500/);
    expect(screen.getByText('Student')).toBeTruthy();
    // A zero child fare is free entry for children, not "¥0".
    expect(within(screen.getByText('Child').closest('div')!).getByText('Free')).toBeTruthy();
  });

  it('says free entry plainly', () => {
    show(rankedFor('Osaka Castle Park'));
    expect(body()).toMatch(/free entry/i);
  });

  it('says a ticket is required when we know that and nothing more', () => {
    const base = rankedFor('Osaka Castle Museum');
    const feeYes = withCandidate(base, {
      admission: { class: 'ticketed', fares: [], source: 'osm-tag', confidence: 'medium' },
    });
    show(feeYes);
    expect(body()).toMatch(/Ticket required/);
    expect(body()).toMatch(/no price published/);
  });

  it('separates admission from spending for an unpriced market', () => {
    // The traveller's own distinction: for a marketplace, vague is fine —
    // what you spend is up to you. Implying an entry fee is not.
    show(rankedFor('Kuromon Ichiba Market'));
    expect(body()).toMatch(/No admission price published/);
    expect(body()).toMatch(/spending happens inside/);
  });

  it('hedges a museum with no published price differently from a park', () => {
    const base = rankedFor('Osaka Castle Museum');
    show(withCandidate(base, { admission: undefined, categories: ['museum'] }));
    expect(body()).toMatch(/usually needs a ticket/i);
  });

  it('shows a home-currency figure only as an approximation, after the real one', () => {
    show(rankedFor('Osaka Castle Museum'), {
      toHomeCurrency: (amount: number) => `RM ${Math.round(amount / 33)}`,
    });
    expect(body()).toMatch(/600/);
    expect(body()).toMatch(/≈ RM 18/);
  });
});

describe('hours a traveller can act on', () => {
  it('answers about today first', () => {
    show(rankedFor('Osaka Castle Museum'));
    expect(screen.getByText('Today')).toBeTruthy();
    // 13:00 in Tokyo, open 09:00–18:00.
    expect(body()).toMatch(/Open now until 18:00/);
  });

  it('names the closed weekday instead of showing another day’s hours', () => {
    // The bug in one line: a museum published `Tu-Su` used to render Tuesday's
    // window with nothing to say it shuts on Mondays.
    show(rankedFor('Nakanoshima Museum of Art, Osaka'));
    expect(body()).toMatch(/Closed Monday/);
    expect(body()).toMatch(/Tue–Sun/);
  });

  it('flags a closure that lands inside the traveller’s own trip', () => {
    show(rankedFor('Nakanoshima Museum of Art, Osaka'), {
      tripStart: '2027-04-10',
      tripEnd: '2027-04-17',
    });
    expect(body()).toMatch(/a day of your trip/i);
    expect(body()).toMatch(/Monday 12 Apr/);
  });

  it('says nothing about the trip when the closure misses it', () => {
    show(rankedFor('Nakanoshima Museum of Art, Osaka'), {
      tripStart: '2027-04-13',
      tripEnd: '2027-04-16',
    });
    expect(body()).not.toMatch(/a day of your trip/i);
  });

  it('shows both windows of a place that shuts for lunch', () => {
    // `periods[0]` dropped the afternoon — most of the visiting day.
    show(rankedFor('Shitennoji Temple'));
    expect(body()).toMatch(/08:30–12:00/);
    expect(body()).toMatch(/13:00–16:30/);
  });

  it('states the gaps rather than leaving a confident-looking schedule', () => {
    const base = rankedFor('Osaka Castle Museum');
    const withCaveats = withCandidate(base, {
      openingHours: {
        ...base.candidate.openingHours!,
        caveats: ['Holiday hours are published for this place but are not read here.'],
      },
    });
    show(withCaveats);
    expect(body()).toMatch(/Holiday hours are published/);
  });

  it('omits the section entirely when no source published hours', () => {
    const base = rankedFor('Osaka Castle Museum');
    show(withCandidate(base, { openingHours: undefined }));
    expect(screen.queryByText('Opening hours')).toBeNull();
    // And says so where the traveller is looking for it.
    expect(body()).toMatch(/no source published them/i);
  });
});

describe('why it ranks here', () => {
  it('names the position, because that is the question being asked', () => {
    show(rankedFor('Osaka Castle Museum'), { position: 3 });
    expect(screen.getByText('Why it is #3 for you')).toBeTruthy();
  });

  it('falls back to a heading that claims no position', () => {
    show(rankedFor('Osaka Castle Museum'));
    expect(screen.getByText('Why it is on your list')).toBeTruthy();
  });

  /**
   * Caught in a browser, not here: a live Osaka card read "Why it is #1 for
   * you" directly above "Nothing stands out on paper — it is here for
   * variety". Each half is defensible; together the heading makes a promise
   * the next line breaks. The fallback point is the signal that there is no
   * ranking reason to give, so the heading must stop claiming one.
   */
  it('does not promise a ranking reason it is about to deny', () => {
    const base = rankedFor('Osaka Castle Museum');
    const unremarkable: RankedCandidate = {
      ...base,
      rationale: [{ id: 'variety', kind: 'evidence', text: 'Nothing stands out on paper — it is here for variety', basis: 'no dimension cleared the notable threshold', comparative: false }],
    } as RankedCandidate;

    show(unremarkable, { position: 1 });

    expect(screen.queryByText('Why it is #1 for you')).toBeNull();
    expect(screen.getByText('Why it is on your list')).toBeTruthy();
  });

  it('quotes the traveller’s own words back rather than a stock sentence', () => {
    show(rankedFor('Shitennoji Temple'));
    expect(body()).toMatch(/You asked for/);
    expect(body()).not.toMatch(/Matches what you said you like/);
  });

  it('does not give two places on one shortlist the same explanation', () => {
    const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, osakaProfile());
    const first = render(<CandidateDetails ranked={ranked[0]} context={{ now: FIXED_NOW } as never} />);
    const firstText = document.body.textContent ?? '';
    first.unmount();
    render(<CandidateDetails ranked={ranked[1]} context={{ now: FIXED_NOW } as never} />);
    expect(document.body.textContent).not.toBe(firstText);
  });
});

describe('provenance reads as a sentence', () => {
  it('says where the hours came from, in words', () => {
    show(rankedFor('Osaka Castle Museum'));
    expect(body()).toMatch(/Hours from the map provider|venue’s own site|Community-maintained/);
  });

  it('says where the price came from, in words', () => {
    show(rankedFor('Osaka Castle Museum'));
    expect(body()).toMatch(/Admission information published on the venue’s own site/);
  });

  it('describes how well-sourced the record is without an enum', () => {
    show(rankedFor('Osaka Castle Museum'));
    expect(body()).toMatch(/corroborated across sources|single reliable source|thinly sourced|authoritative source/);
  });

  /**
   * Also caught in a browser: `1 source · corroborated across sources`. The
   * count and the phrase were picked independently, so nothing stopped them
   * contradicting each other in the same sentence. Corroboration needs two
   * things to corroborate.
   */
  it('never claims corroboration when it names a single source', () => {
    const base = rankedFor('Osaka Castle Museum');
    const lonely = withCandidate(base, {
      sourceConfidence: 'high',
      sourceReferences: [base.candidate.sourceReferences[0]].filter(Boolean),
    });

    show(lonely);

    expect(body()).toMatch(/1 source/);
    expect(body()).not.toMatch(/corroborated across sources/);
  });

  it('still claims corroboration when more than one source backs the record', () => {
    const base = rankedFor('Osaka Castle Museum');
    const corroborated = withCandidate(base, { sourceConfidence: 'high' });

    const evidence = { sourceCount: 3, positiveThemes: [], negativeThemes: [], crowdRisk: 0 };
    render(<CandidateDetails ranked={corroborated} context={{ now: FIXED_NOW, evidence } as never} />);

    expect(body()).toMatch(/3 independent sources · corroborated across sources/);
  });
});

describe('a description the model wrote', () => {
  const brief = {
    sentences: [
      { text: 'The main keep was rebuilt in ferro-concrete.', sourceUrl: 'https://a.example/', excerpt: 'rebuilt in ferro-concrete' },
      { text: 'It houses the castle museum.', sourceUrl: 'https://b.example/', excerpt: 'houses the castle museum' },
    ],
    sourceCount: 2,
  };
  const evidence = { sourceCount: 2, positiveThemes: [], negativeThemes: [], crowdRisk: 0, brief };

  /**
   * The honesty invariant. Every sentence has been checked to quote its
   * source, but grounded is not the same as human-written, and a traveller has
   * to be able to tell before they weigh it.
   */
  it('says plainly that AI wrote it, and how many sources it rests on', () => {
    const base = rankedFor('Osaka Castle Museum');
    render(<CandidateDetails ranked={withCandidate(base, { description: undefined })} context={{ now: FIXED_NOW, evidence } as never} />);
    expect(body()).toMatch(/Description written by AI from 2 sources/);
    expect(body()).toMatch(/rebuilt in ferro-concrete/);
  });

  it('never blends model prose into the same element as a human description', () => {
    const base = rankedFor('Osaka Castle Museum');
    render(<CandidateDetails ranked={base} context={{ now: FIXED_NOW, evidence } as never} />);
    // The fixture has real prose, so the brief must not appear at all.
    expect(body()).not.toMatch(/Description written by AI/);
    expect(body()).not.toMatch(/rebuilt in ferro-concrete/);
  });

  it('shows nothing at all rather than an empty slot when there is no brief', () => {
    const base = rankedFor('Osaka Castle Museum');
    const noBrief = { sourceCount: 1, positiveThemes: [], negativeThemes: [], crowdRisk: 0 };
    render(<CandidateDetails ranked={withCandidate(base, { description: undefined })} context={{ now: FIXED_NOW, evidence: noBrief } as never} />);
    expect(document.querySelector('.destination-detail-brief')).toBeNull();
  });
});

describe('cautions', () => {
  it('are separate items, not one run-on paragraph', () => {
    const base = rankedFor('Osaka Castle Museum');
    const noisy: RankedCandidate = {
      ...base,
      cautions: ['Opening hours are unverified.', 'Recent visitors describe this as overrated.'],
    };
    render(<CandidateDetails ranked={noisy} context={{ now: FIXED_NOW } as never} />);
    const list = document.querySelector('ul.destination-match-caution');
    expect(list).toBeTruthy();
    expect(list!.querySelectorAll('li')).toHaveLength(2);
  });

  it('promote a reported closure into the alert slot', () => {
    const base = rankedFor('Osaka Castle Museum');
    const closed: RankedCandidate = {
      ...base,
      cautions: ['A source reports this place as closed. Check before you go.', 'Opening hours are unverified.'],
    };
    render(<CandidateDetails ranked={closed} context={{ now: FIXED_NOW } as never} />);
    const alert = document.querySelector('.destination-detail-alert');
    expect(alert?.textContent).toMatch(/reports this place as closed/);
    // And it is not repeated below.
    expect(document.querySelectorAll('ul.destination-match-caution li')).toHaveLength(1);
  });
});
