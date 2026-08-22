// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DayPlan } from '../data';
import { getDaySemanticModel } from '../lib/daySemanticsPresentation';
import { DaySemantics } from './DaySemantics';

const day = (overrides: Partial<Pick<DayPlan, 'stayCity' | 'activityCities' | 'transfer'>> = {}): Pick<DayPlan, 'stayCity' | 'activityCities' | 'transfer'> => ({
  stayCity: 'Osaka',
  activityCities: [],
  transfer: undefined,
  ...overrides,
});

describe('Stage 3 day semantics presentation', () => {
  it('shows a single authoritative activity city as a day trip without moving the stay', () => {
    const model = getDaySemanticModel(day({ activityCities: ['Kyoto'] }));

    expect(model).toMatchObject({ kind: 'day-trip', stayCity: 'Osaka', activityCities: ['Kyoto'] });
    expect(model?.transfer).toBeUndefined();

    render(<DaySemantics day={day({ activityCities: ['Kyoto'] })} />);
    expect(screen.getByRole('note', { name: 'Kyoto day trip. Staying in Osaka.' })).toHaveTextContent('Kyoto day trip');
    expect(screen.getByRole('note')).toHaveTextContent('Staying in Osaka');
  });

  it('keeps same-city days visually quiet', () => {
    expect(getDaySemanticModel(day({ activityCities: ['osaka'] }))).toBeNull();
    render(<DaySemantics day={day({ activityCities: ['Osaka'] })} />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows every recorded activity city on a mixed activity day', () => {
    const model = getDaySemanticModel(day({ activityCities: ['Osaka', 'Kyoto'] }));

    expect(model).toMatchObject({ kind: 'activity-cities', stayCity: 'Osaka', activityCities: ['Osaka', 'Kyoto'] });
    render(<DaySemantics day={day({ activityCities: ['Osaka', 'Kyoto'] })} />);
    expect(screen.getByRole('note')).toHaveTextContent('Activities in Osaka · Kyoto');
    expect(screen.getByRole('note')).toHaveTextContent('Staying in Osaka');
  });

  it('renders an explicit transfer and keeps the final overnight base visible', () => {
    const transfer = { from: 'Osaka', to: 'Kyoto' };
    const model = getDaySemanticModel(day({ stayCity: 'Kyoto', activityCities: ['Osaka', 'Kyoto'], transfer }));

    expect(model).toMatchObject({ kind: 'transfer', stayCity: 'Kyoto', transfer });
    render(<DaySemantics day={day({ stayCity: 'Kyoto', activityCities: ['Osaka', 'Kyoto'], transfer })} mode="detail" />);
    expect(screen.getByRole('note', { name: 'Transfer day from Osaka to Kyoto. Staying in Kyoto tonight.' })).toHaveTextContent('OsakaKyoto');
    expect(screen.getByRole('note')).toHaveTextContent('Transfer day');
    expect(screen.getByRole('note')).toHaveTextContent('Staying in Kyoto tonight');
    expect(screen.getByRole('note')).toHaveTextContent('Activities: Osaka · Kyoto');
  });

  it('does not invent a presentation from unrelated activity data', () => {
    const model = getDaySemanticModel(day());

    expect(model).toBeNull();
    render(<DaySemantics day={day()} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
