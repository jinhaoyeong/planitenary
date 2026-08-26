// @vitest-environment jsdom

/**
 * The category rail used to be pulled 16.5rem to the left of the content
 * column and widened to match. Inside a `max-w-7xl` page that only fits on a
 * very wide screen: at a 1280px viewport the column starts at x=40, so the
 * rail started at -224px and sat off the left edge entirely. jsdom cannot
 * measure that, so the guard is on the pull itself.
 */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsPanel } from './AppSettingsPanel';
import { emptyItinerary } from '../lib/itinerarySanitize';

vi.mock('./CurrencySelector', () => ({ CurrencyPairSettings: () => null }));
vi.mock('./TripIdentityPanel', () => ({ TripIdentityPanel: () => null }));

beforeEach(() => {
  window.localStorage.clear();
});

const renderPanel = () =>
  render(
    <AppSettingsPanel
      showPets={false}
      onTogglePets={vi.fn()}
      itinerary={emptyItinerary}
      onItineraryChange={vi.fn()}
    />,
  );

describe('the settings category rail', () => {
  it('offers every category as a link to its section', () => {
    renderPanel();

    const rail = screen.getByRole('navigation', { name: 'Settings categories' });
    const links = within(rail).getAllByRole('link');

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Trip planning',
      'Handbook design',
      'Money',
      'Optional extras',
    ]);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^#settings-/);
    }
  });

  it('gives the links one shared shape rather than four sets of utilities', () => {
    renderPanel();

    const rail = screen.getByRole('navigation', { name: 'Settings categories' });
    for (const link of within(rail).getAllByRole('link')) {
      expect(link).toHaveClass('settings-rail-link');
      // The active state is a class now, so the stylesheet owns the colour
      // instead of an inline style overriding it.
      expect(link.getAttribute('style')).toBeNull();
    }
  });

  it('never pulls the rail outside the content column', () => {
    const { container } = renderPanel();
    const layout = container.querySelector('.settings-layout');

    expect(layout).not.toBeNull();
    const className = layout?.className ?? '';
    expect(className).not.toMatch(/-ml-\[/);
    expect(className).not.toMatch(/w-\[calc\(100%\+/);
  });
});
