// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { emptyItinerary } from '../lib/itinerarySanitize';
import { createEmptyProfile, manualDestination } from '../lib/tripProfile';
import { PlannerPreview } from './PlannerPreview';

vi.mock('./DestinationDiscoveryPanel', () => ({
  DestinationDiscoveryPanel: () => <div data-testid="discovery-stub" />,
}));

const profile = () => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
});

const phoneMatchMedia = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 639px'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
};

const builtItinerary = (): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-organise-test',
  name: 'Osaka test trip',
  cities: ['Osaka'],
  discoveryState: {
    city: 'Osaka',
    mode: 'fixture',
    candidateIds: ['osm-n1'],
    decisions: { 'osm-n1': 'must-do' },
    discoveredAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    stage: 'itinerary-built',
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PlannerPreview organise header', () => {
  it('starts folded on a phone with the title in the centered toggle row', () => {
    phoneMatchMedia();
    render(<PlannerPreview itinerary={emptyItinerary} profile={profile()} onItineraryChange={vi.fn()} />);

    const panel = document.querySelector('.planner-organise-panel');
    expect(panel?.classList.contains('is-collapsed')).toBe(true);
    expect(document.querySelector('.planner-organise-toggle')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Organise places' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Organise places/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens from the folded header without leaving the page', () => {
    phoneMatchMedia();
    render(<PlannerPreview itinerary={emptyItinerary} profile={profile()} onItineraryChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Organise places/ }));
    const panel = document.querySelector('.planner-organise-panel');
    expect(panel?.classList.contains('is-open')).toBe(true);
    expect(screen.getByRole('button', { name: /Organise places/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('names the section Improve plan after discovery has built an itinerary', () => {
    render(<PlannerPreview itinerary={builtItinerary()} profile={profile()} onItineraryChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Improve plan' })).toBeInTheDocument();
    expect(document.querySelector('.planner-organise-toggle')).not.toBeNull();
  });
});
