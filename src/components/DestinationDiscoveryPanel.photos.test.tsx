// @vitest-environment jsdom

/**
 * The last hop of the photograph path: a real image arriving from
 * `travel-images` and reaching an `<img>` on a card.
 *
 * Every other link in that chain has a test — the leads on the discovery
 * payload, the licence gate, the cache, the validator. This one had none,
 * because the panel's other component tests leave `invokeTravelFunction`
 * rejecting, which puts the deck on the fixture path and skips the image
 * effect entirely. A deck that silently shows placards for places whose
 * photographs resolved fine is exactly what that gap hides.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { CurrencyProvider } from '../contexts/CurrencyContext';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import type { PlaceCandidate } from '../lib/destinationIntelligence';
import { resetProviderRuntimeCache } from '../lib/discoveryRuntime';
import { DestinationDiscoveryPanel, PlaceMedia } from './DestinationDiscoveryPanel';

const mocks = vi.hoisted(() => ({
  invokeTravelFunction: vi.fn(),
  invokeTravelReasoning: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true),
}));

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase')>()),
  invokeTravelFunction: mocks.invokeTravelFunction,
  invokeTravelReasoning: mocks.invokeTravelReasoning,
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

const PHOTO_URL = 'https://upload.wikimedia.org/wikipedia/commons/9/93/Acrosfukuoka02.jpg';
const FULL_PHOTO_URL = 'https://upload.wikimedia.org/wikipedia/commons/full-deck.jpg';
const THUMB_PHOTO_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb-browse.jpg';

const candidateFor = (index: number): PlaceCandidate => ({
  id: `osm-n${index}`,
  provider: 'osm',
  providerPlaceId: `n${index}`,
  name: `Documented place ${index}`,
  countryCode: 'JP',
  city: 'Fukuoka',
  neighbourhood: 'Tenjin',
  coordinates: [33.59 + index / 1000, 130.4 + index / 1000],
  categories: ['essential'],
  experienceTags: ['temples'],
  notability: 0.8,
  sourceReferences: [],
  sourceConfidence: 'high',
  lastVerifiedAt: '2027-01-01T00:00:00.000Z',
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'outdoor',
  reservationStatus: 'not-needed',
  imageLeads: [{ kind: 'commons-file', value: 'File:Acrosfukuoka02.jpg', origin: 'osm-tag' }],
});

const CANDIDATES = Array.from({ length: 8 }, (_, index) => candidateFor(index + 1));

const imagesPayloadFor = (
  placeIds: string[],
  renditions: { url?: string; thumbnailUrl?: string } = {},
) => ({
  images: Object.fromEntries(placeIds.map((placeId) => [placeId, [{
    url: renditions.url ?? PHOTO_URL,
    thumbnailUrl: renditions.thumbnailUrl ?? renditions.url ?? PHOTO_URL,
    width: 1200,
    height: 800,
    source: 'wikimedia-commons',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Acrosfukuoka02.jpg',
    author: 'Pontafon',
    licence: 'CC BY-SA 3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
    attribution: 'Pontafon · CC BY-SA 3.0 · Wikimedia Commons',
    lead: 'commons-file',
  }]])),
  expiresAt: '2027-01-01T00:00:00.000Z',
  complete: true,
  rejected: [],
});

const profileFor = (): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Fukuoka', 'Japan')],
  startDate: '2027-04-02',
  endDate: '2027-04-06',
  dayCount: 5,
  styles: ['temples'],
});

const itineraryFor = (profile: TripProfile): Itinerary => ({
  id: 'place-photo-test',
  name: 'Fukuoka test trip',
  cities: ['Fukuoka'],
  description: 'A test trip.',
  tripProfile: profile,
  days: [],
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

let evidenceGate: Deferred<unknown>;
let imagesGate: Deferred<unknown>;
let imageRequests: Array<{ placeIds: string[] }>;

beforeEach(() => {
  localStorage.clear();
  resetProviderRuntimeCache();
  evidenceGate = deferred<unknown>();
  imagesGate = deferred<unknown>();
  imageRequests = [];
  mocks.isSupabaseConfigured.mockReturnValue(true);
  mocks.invokeTravelReasoning.mockReset();
  mocks.invokeTravelReasoning.mockResolvedValue({ results: [] });
  mocks.invokeTravelFunction.mockReset();
  mocks.invokeTravelFunction.mockImplementation(async (name: string, body: unknown) => {
    if (name === 'travel-capabilities') return { osm: true };
    if (name === 'travel-discover') return structuredClone(CANDIDATES);
    if (name === 'travel-evidence') return evidenceGate.promise;
    if (name === 'travel-images') {
      imageRequests.push({ placeIds: (body as { placeIds: string[] }).placeIds });
      return imagesGate.promise;
    }
    throw new Error(`Unexpected function ${name}`);
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ rates: { MYR: 1, JPY: 33 }, date: '2027-04-02' }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const startReview = async () => {
  const profile = profileFor();
  render(
    <CurrencyProvider>
      <DestinationDiscoveryPanel
        itinerary={itineraryFor(profile)}
        profile={profile}
        onItineraryChange={vi.fn()}
      />
    </CurrencyProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: /^Start$/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
  await waitFor(() => expect(imageRequests.length).toBeGreaterThan(0));
};

describe('real photographs reach the deck', () => {
  it('shows the photograph the image service resolved', async () => {
    await startReview();

    await act(async () => {
      imagesGate.resolve(imagesPayloadFor(imageRequests[0].placeIds));
      await imagesGate.promise;
    });

    await waitFor(() => {
      const photo = document.querySelector('.destination-place-media img');
      expect(photo).not.toBeNull();
      expect(photo?.getAttribute('src')).toBe(PHOTO_URL);
    });
  });

  it('keeps the same enriched candidate in the deck and Browse All', async () => {
    await startReview();

    const firstProviderPlaceId = imageRequests[0].placeIds[0];
    const expectedCandidateId = CANDIDATES.find((candidate) => candidate.providerPlaceId === firstProviderPlaceId)?.id;
    expect(expectedCandidateId).toBeTruthy();

    await act(async () => {
      imagesGate.resolve(imagesPayloadFor(imageRequests[0].placeIds, {
        url: FULL_PHOTO_URL,
        thumbnailUrl: THUMB_PHOTO_URL,
      }));
      await imagesGate.promise;
    });

    await waitFor(() => {
      const deck = document.querySelector('.destination-deck-card');
      expect(deck?.getAttribute('data-candidate-id')).toBe(expectedCandidateId);
      expect(deck?.querySelector('.destination-deck-photo img')?.getAttribute('src')).toBe(FULL_PHOTO_URL);
    });

    fireEvent.click(screen.getByRole('button', { name: /Browse all/i }));

    await waitFor(() => {
      const browse = document.querySelector(`.destination-candidate[data-candidate-id="${expectedCandidateId}"]`);
      expect(browse).not.toBeNull();
      expect(browse?.querySelector('.destination-candidate-photo img')?.getAttribute('src')).toBe(THUMB_PHOTO_URL);
    });
  });

  it('keeps the photograph when evidence lands while the image request is still in flight', async () => {
    await startReview();

    // Evidence arriving first is the ordinary case in production: it re-ranks
    // the deck, which rebuilds the very list the image effect depends on.
    await act(async () => {
      evidenceGate.resolve({ results: [] });
      await evidenceGate.promise;
    });
    await act(async () => {
      imagesGate.resolve(imagesPayloadFor(imageRequests[0].placeIds));
      await imagesGate.promise;
    });

    await waitFor(() => {
      const photo = document.querySelector('.destination-place-media img');
      expect(photo).not.toBeNull();
      expect(photo?.getAttribute('src')).toBe(PHOTO_URL);
    });
  });

  it('carries the credit the licence requires', async () => {
    await startReview();

    await act(async () => {
      imagesGate.resolve(imagesPayloadFor(imageRequests[0].placeIds));
      await imagesGate.promise;
    });

    // CC BY and CC BY-SA both require the author be named, so the credit is
    // part of the permission to show the photograph — not a caption.
    const credit = await screen.findByText('Pontafon · CC BY-SA 3.0 · Wikimedia Commons');
    expect(credit.getAttribute('href')).toBe('https://commons.wikimedia.org/wiki/File:Acrosfukuoka02.jpg');
  });

  it('keeps evidence that lands after a photograph has already re-rendered the deck', async () => {
    await startReview();

    // The mirror of the case above, and the more expensive one: evidence is
    // metered, and the same ledger that stops a second image request stops a
    // second evidence request.
    await act(async () => {
      imagesGate.resolve(imagesPayloadFor(imageRequests[0].placeIds));
      await imagesGate.promise;
    });
    await act(async () => {
      evidenceGate.resolve({
        documents: [],
        admissions: Object.fromEntries(imageRequests[0].placeIds.map((placeId) => [placeId, {
          class: 'ticketed',
          fares: [{ audience: 'adult', currency: 'JPY', amount: 600 }],
          source: 'official-website',
          confidence: 'high',
        }])),
      });
      await evidenceGate.promise;
    });

    await waitFor(() => {
      expect(screen.getAllByText(/600/).length).toBeGreaterThan(0);
    });
    const evidenceCalls = mocks.invokeTravelFunction.mock.calls.filter(([name]) => name === 'travel-evidence');
    expect(evidenceCalls).toHaveLength(1);
  });
});

describe('PlaceMedia browse/deck contract', () => {
  const source = (overrides: Partial<PlaceCandidate> = {}) => ({
    ...candidateFor(99),
    ...overrides,
  });

  it('uses the thumbnail in Browse All and the full image in the deck', () => {
    const candidate = source({
      photoUrl: 'https://upload.wikimedia.org/full.jpg',
      photoThumbnailUrl: 'https://upload.wikimedia.org/thumb.jpg',
      photoAttribution: 'Author · CC BY-SA 3.0 · Wikimedia Commons',
      photoSourcePage: 'https://commons.wikimedia.org/wiki/File:full.jpg',
    });
    const { rerender } = render(<PlaceMedia candidate={candidate} size="thumb" />);

    expect(document.querySelector('.destination-place-media img')?.getAttribute('src')).toBe(candidate.photoThumbnailUrl);

    rerender(<PlaceMedia candidate={candidate} size="full" />);
    expect(document.querySelector('.destination-place-media img')?.getAttribute('src')).toBe(candidate.photoUrl);
  });

  it.each([
    { label: 'thumbnail only', photoThumbnailUrl: 'https://upload.wikimedia.org/thumb-only.jpg', expected: 'https://upload.wikimedia.org/thumb-only.jpg' },
    { label: 'full image only', photoUrl: 'https://upload.wikimedia.org/full-only.jpg', expected: 'https://upload.wikimedia.org/full-only.jpg' },
  ])('uses any verified image in both modes when $label', ({ photoUrl, photoThumbnailUrl, expected }) => {
    const candidate = source({ photoUrl, photoThumbnailUrl });
    const { rerender } = render(<PlaceMedia candidate={candidate} size="thumb" />);

    expect(document.querySelector('.destination-place-media img')?.getAttribute('src')).toBe(expected);

    rerender(<PlaceMedia candidate={candidate} size="full" />);
    expect(document.querySelector('.destination-place-media img')?.getAttribute('src')).toBe(expected);
  });

  it('shows the labelled placeholder only when neither verified image exists', () => {
    const candidate = source();
    const { rerender } = render(<PlaceMedia candidate={candidate} size="thumb" />);

    expect(document.querySelector('.destination-place-media img')).toBeNull();
    expect(document.querySelector('.destination-place-media')?.getAttribute('data-has-photo')).toBe('false');

    rerender(<PlaceMedia candidate={candidate} size="full" />);
    expect(document.querySelector('.destination-place-media img')).toBeNull();
    expect(document.querySelector('.destination-place-media')?.getAttribute('data-has-photo')).toBe('false');
  });
});
