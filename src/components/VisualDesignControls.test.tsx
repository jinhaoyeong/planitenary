// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';
import { createEmptyProfile, manualDestination } from '../lib/tripProfile';
import { withVisualDesign } from '../lib/visualIdentity';
import { VisualDesignControls } from './VisualDesignControls';

describe('VisualDesignControls preview', () => {
  it('inherits the user palette while previewing the selected recipe geometry', () => {
    const profile = withVisualDesign({
      ...createEmptyProfile(),
      destinations: [manualDestination('Chongqing', 'China')],
    }, {
      intensity: 'immersive',
      recipeOverride: 'nature-expedition',
    });

    render(
      <ThemeProvider>
        <VisualDesignControls profile={profile} onChange={vi.fn()} />
      </ThemeProvider>,
    );

    const preview = screen.getByText('Live preview').closest('section');
    expect(preview).not.toBeNull();
    expect(preview).toHaveStyle({ '--card-radius': '0.35rem' });
    expect((preview as HTMLElement).style.getPropertyValue('--accent')).toBe('');
    expect(screen.getByText('Your palette')).toBeInTheDocument();
  });
});
