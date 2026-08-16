// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanTripProposalPanel } from './PlanTripProposalPanel';
import { planTripProposal } from '../lib/planTripProposal';

vi.mock('../lib/planTripProposal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/planTripProposal')>();
  return { ...actual, planTripProposal: vi.fn() };
});

const mockedPlan = vi.mocked(planTripProposal);

beforeEach(() => {
  mockedPlan.mockReset();
  mockedPlan.mockResolvedValue({
    status: 'answered',
    proposal: {
      kind: 'itinerary-proposal-v1', id: 'p1', tripId: 'trip-1', materialRevision: 'r1',
      createdAt: '2026-08-16T08:00:00Z', status: 'valid', applied: false, pace: 'balanced',
      days: [{
        day: 1, city: 'Osaka', startTime: '09:15', endTime: '21:30', warnings: [],
        metrics: { placeCount: 2, travelMinutes: 27, freeMinutes: 90, clusterChanges: 0 },
        items: [
          { id: 'a', placeId: 'a', type: 'place', name: 'Osaka Castle', arrivalTime: '09:15', startTime: '09:15', endTime: '10:45', visitDurationMinutes: 90, bufferMinutes: 0, rationale: 'Must do', warnings: [], evidence: [], priority: 'must-do' },
          { id: 'b', placeId: 'b', type: 'place', name: 'Museum', arrivalTime: '11:12', startTime: '11:37', endTime: '13:07', visitDurationMinutes: 90, bufferMinutes: 25, rationale: 'Nearby', warnings: [], evidence: [], travelFromPrevious: { fromPlaceId: 'a', fromName: 'Osaka Castle', mode: 'walking', durationMinutes: 27, source: 'provider', status: 'confirmed' } },
        ],
      }],
      conflicts: [], warnings: [], omittedPlaceIds: [],
      routeSummary: { matrixCalls: 1, confirmedLegs: 1, unavailableLegs: 0, allDurationsProviderDerived: true },
      repairIterations: 0,
    },
  });
});

describe('Plan my trip proposal panel', () => {
  it('shows a full proposal without offering an enabled save action', async () => {
    render(<PlanTripProposalPanel tripId="trip-1" tripName="Osaka days" />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan my trip' }));

    expect(await screen.findByText('Proposed itinerary')).toBeInTheDocument();
    expect(screen.getByText('Osaka Castle')).toBeInTheDocument();
    expect(screen.getByText(/27 min Walking from Osaka Castle/)).toBeInTheDocument();
    expect(screen.getByText(/Proposal only · not saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply in Phase 2B/ })).toBeDisabled();
    expect(mockedPlan).toHaveBeenCalledTimes(1);
  });

  it('regenerates only after the traveller asks', async () => {
    render(<PlanTripProposalPanel tripId="trip-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan my trip' }));
    await screen.findByText('Proposed itinerary');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate proposal' }));
    await waitFor(() => expect(mockedPlan).toHaveBeenCalledTimes(2));
  });
});
