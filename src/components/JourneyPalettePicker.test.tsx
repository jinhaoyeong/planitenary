// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsPanel } from './AppSettingsPanel';
import { JOURNEY_PALETTE_STORAGE_KEY, loadJourneyPalette } from '../lib/journeyPalette';

vi.mock('./CurrencySelector', () => ({ CurrencyPairSettings: () => null }));
vi.mock('./TripIdentityPanel', () => ({ TripIdentityPanel: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-journey-palette');
  document.documentElement.removeAttribute('data-theme');
});

const renderPanel = () =>
  render(<AppSettingsPanel showPets={false} onTogglePets={vi.fn()} />);

describe('choosing a colour palette from settings', () => {
  it('offers every palette as a radio, with the shipped one selected', () => {
    renderPanel();

    const group = screen.getByRole('radiogroup', { name: 'Colour palette' });
    expect(group).toBeInTheDocument();

    const green = screen.getByRole('radio', { name: /Journey green/ });
    expect(green).toHaveAttribute('aria-checked', 'true');
    for (const name of [/Warm sand/, /Ink navy/, /Vermilion/, /Planitenary pink/]) {
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByLabelText('Selected colour palette preview')).toHaveTextContent('Your next journey');
  });

  it('applies the chosen palette to the document and remembers it', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Ink navy/ }));

    expect(document.documentElement.getAttribute('data-journey-palette')).toBe('ink-navy');
    expect(window.localStorage.getItem(JOURNEY_PALETTE_STORAGE_KEY)).toBe('ink-navy');
    expect(loadJourneyPalette()).toBe('ink-navy');
    expect(screen.getByRole('radio', { name: /Ink navy/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Journey green/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('opens on the palette already saved on this device', () => {
    window.localStorage.setItem(JOURNEY_PALETTE_STORAGE_KEY, 'vermilion');

    renderPanel();

    expect(screen.getByRole('radio', { name: /Vermilion/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('offers and persists the restored pink palette', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Planitenary pink/ }));

    expect(document.documentElement.getAttribute('data-journey-palette')).toBe('rose-pink');
    expect(loadJourneyPalette()).toBe('rose-pink');
  });

  it('leaves the light/dark choice alone', () => {
    document.documentElement.dataset.theme = 'dark';

    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: /Warm sand/ }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-journey-palette')).toBe('warm-sand');
  });
});
