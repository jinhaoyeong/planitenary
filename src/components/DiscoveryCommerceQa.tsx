/**
 * Local-only visual smoke for V2G discovery commerce.
 *
 * Gated behind `qaEnabled` and a query parameter, so it is never reachable as
 * a production URL. The four cases are the same
 * overlays the component tests already use — a real ranked Osaka fixture with
 * `website` swapped — so this board shows what those tests cannot: weight,
 * wrapping, focus, and whether a reseller URL is absent from the painted card.
 */
import { useEffect, useMemo, useState } from 'react';
import { applyJourneyPalette, normalizeJourneyPalette } from '../lib/journeyPalette';
import { OSAKA_PLACE_FIXTURE } from '../lib/destinationFixtures';
import { rankWithIntelligence } from '../lib/destinationPlanner';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import type { PlaceCandidate, RankedCandidate } from '../lib/destinationIntelligence';
import { DeckCard } from './DestinationDiscoveryPanel';

const osakaProfile = (): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2027-04-02',
  endDate: '2027-04-06',
  dayCount: 5,
  styles: ['temples', 'history'],
});

const rankedNamed = (name: string): RankedCandidate => {
  const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, osakaProfile());
  const found = ranked.find((entry) => entry.candidate.name === name);
  if (!found) throw new Error(`fixture "${name}" is gone`);
  return found;
};

const withWebsite = (base: RankedCandidate, website: PlaceCandidate['website']): RankedCandidate => ({
  ...base,
  candidate: { ...base.candidate, website },
});

interface Case {
  id: string;
  title: string;
  expect: string;
  ranked: RankedCandidate;
}

export function DiscoveryCommerceQa() {
  const params = new URLSearchParams(window.location.search);
  const dark = params.get('theme') === 'dark';
  const palette = normalizeJourneyPalette(params.get('palette'));
  const [flipped, setFlipped] = useState(true);
  const mobile = params.get('variant') === 'mobile';
  const variant = mobile ? 'mobile' : 'desktop';

  const cases = useMemo<Case[]>(() => {
    const unpublished = rankedNamed('Dotonbori');
    const priced = rankedNamed('Osaka Castle Museum');
    return [
      {
        id: 'safe-unknown',
        title: 'A+B · safe website, unpublished price',
        expect: 'Admission section with “Website” — never “Official website”, since an OSM tag proves no ownership. Cost does not shout. No “Book now”.',
        ranked: withWebsite(unpublished, 'https://www.osakacastle.net/'),
      },
      {
        id: 'priced-official',
        title: 'priced + official website',
        expect: 'Still “Website”, never “View tickets” — this surface has an unverified site, not a ticket page.',
        ranked: withWebsite(priced, 'https://www.osakacastle.net/'),
      },
      {
        id: 'no-commerce',
        title: 'D · no website',
        expect: 'No Admission section, no “No price data”, no official link.',
        ranked: withWebsite(unpublished, undefined),
      },
      {
        id: 'reseller',
        title: 'G · reseller URL',
        expect: 'Klook must not appear as Official. No tickets link either.',
        ranked: withWebsite(unpublished, 'https://www.klook.com/en-MY/activity/123-osaka-castle/'),
      },
      {
        id: 'unsafe',
        title: 'G · unsafe URL',
        expect: 'localhost must not render as Official.',
        ranked: withWebsite(unpublished, 'http://localhost/admin'),
      },
    ];
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    applyJourneyPalette(palette);
    return () => {
      document.documentElement.classList.remove('dark');
      document.documentElement.removeAttribute('data-theme');
    };
  }, [dark, palette]);

  return (
    <div
      className="min-h-screen"
      data-discovery-commerce-qa="true"
      style={{
        background: 'var(--bg)',
        color: 'var(--ink)',
        padding: '1.5rem 1.25rem 3rem',
        fontFamily: 'var(--font-sans, Instrument Sans, sans-serif)',
      }}
    >
      <header style={{ maxWidth: '40rem', margin: '0 auto 1.5rem' }}>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Local visual smoke · V2G
        </p>
        <h1 style={{ fontFamily: 'var(--font-display, Instrument Serif, serif)', fontSize: '1.8rem', fontWeight: 500, lineHeight: 1.2 }}>
          Discovery commerce on the detail face
        </h1>
        <p style={{ marginTop: '0.4rem', color: 'var(--ink-muted)', fontSize: '0.82rem', lineHeight: 1.45 }}>
          Real DeckCard / CandidateDetails, Osaka fixtures, no provider calls.
          Cards start flipped. Toggle to see the front.
        </p>
        <button
          type="button"
          className="pill-btn pill-ghost"
          style={{ marginTop: '0.75rem' }}
          onClick={() => setFlipped((open) => !open)}
        >
          {flipped ? 'Show front faces' : 'Show detail faces'}
        </button>
      </header>

      <div
        style={{
          display: 'grid',
          gap: '2rem',
          justifyItems: 'center',
        }}
      >
        {cases.map((entry) => (
          <section
            key={entry.id}
            data-qa-case={entry.id}
            style={{ width: mobile ? 'min(100%, 22rem)' : 'min(100%, 34rem)' }}
          >
            <h2 style={{ fontSize: '0.82rem', fontWeight: 750, marginBottom: '0.2rem' }}>{entry.title}</h2>
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', lineHeight: 1.4, marginBottom: '0.7rem' }}>
              {entry.expect}
            </p>
            <div className="destination-discovery-shell destination-discovery-review is-deck-only" style={{ padding: '1rem', border: 'none', boxShadow: 'none' }}>
              <DeckCard
                ranked={entry.ranked}
                onDecision={() => undefined}
                variant={variant}
                flipped={flipped}
                onFlippedChange={setFlipped}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default DiscoveryCommerceQa;
