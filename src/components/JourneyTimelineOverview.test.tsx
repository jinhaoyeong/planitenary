// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { createEmptyProfile } from '../lib/tripProfile';
import { JourneyTimelineOverview } from './JourneyTimelineOverview';

const trip = (): Itinerary => ({
  id: 'legacy-route',
  name: 'Kansai route',
  cities: ['Tokyo', 'Kyoto', 'Osaka'],
  description: 'A legacy trip whose days predate stay-city semantics.',
  tripProfile: {
    ...createEmptyProfile(),
    dayCount: 5,
    cityStays: [
      { city: 'Tokyo', days: 2 },
      { city: 'Kyoto', days: 2 },
      { city: 'Osaka', days: 1 },
    ],
    cityStayDayCount: 5,
  },
  days: Array.from({ length: 5 }, (_, index) => ({
    day: index + 1,
    date: `Aug ${12 + index}`,
    stayCity: '',
    activityCities: [],
    city: '',
    title: `Day ${index + 1}`,
    activities: [],
  })),
});

describe('JourneyTimelineOverview', () => {
  it('uses the saved city-stay plan when legacy days have no base city', () => {
    const onSelectDay = vi.fn();
    render(<JourneyTimelineOverview itinerary={trip()} onSelectDay={onSelectDay} />);

    expect(screen.getByRole('button', { name: /Tokyo.*Days 1–2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kyoto.*Days 3–4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Osaka.*Days 5–5/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Day 3/ }));
    expect(onSelectDay).toHaveBeenCalledWith(3);
  });

  it('keeps route-city navigation in the overview and only opens a day row', () => {
    const onSelectDay = vi.fn();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<JourneyTimelineOverview itinerary={trip()} onSelectDay={onSelectDay} />);

    const kyoto = screen.getByRole('button', { name: /^2Kyoto/ });
    fireEvent.click(kyoto);

    expect(scrollIntoView).toHaveBeenCalled();
    expect(kyoto).toHaveAttribute('aria-current', 'location');
    expect(onSelectDay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Day 3/ }));
    expect(onSelectDay).toHaveBeenCalledWith(3);
  });

  it('labels blank day previews with the destination instead of unrelated artwork', () => {
    render(<JourneyTimelineOverview itinerary={trip()} onSelectDay={vi.fn()} />);

    expect(screen.getAllByText('Going to')).toHaveLength(5);
    expect(screen.getAllByText('Tokyo').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Kyoto').length).toBeGreaterThan(1);
  });

  /**
   * The planner card used to render last on the page, below markup the
   * stylesheet hides, where nothing led the eye to it. Its position is the
   * point of the slot, so the order is asserted rather than its presence.
   */
  it('places the planner between the route and the days it acts on', () => {
    const { container } = render(
      <JourneyTimelineOverview
        itinerary={trip()}
        onSelectDay={vi.fn()}
        planner={<div data-testid="planner-slot">Build a Kyoto itinerary</div>}
      />,
    );

    const overview = container.querySelector('.journey-itinerary-overview');
    expect(overview).not.toBeNull();

    const position = (selector: string) => Array.from(overview!.children).findIndex((child) => child.matches(selector));
    const route = position('.journey-route-row');
    const slot = position('[data-testid="planner-slot"]');
    const timeline = position('.journey-stay-timeline');

    expect(route).toBeGreaterThanOrEqual(0);
    expect(slot).toBeGreaterThan(route);
    expect(timeline).toBeGreaterThan(slot);
  });

  it('renders nothing extra when no planner is supplied', () => {
    const { container } = render(<JourneyTimelineOverview itinerary={trip()} onSelectDay={vi.fn()} />);

    expect(container.querySelector('.journey-stay-timeline')).not.toBeNull();
    expect(screen.queryByTestId('planner-slot')).toBeNull();
  });
});
