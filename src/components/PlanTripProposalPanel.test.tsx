// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanTripProposalPanel } from './PlanTripProposalPanel';
import { planTripProposal } from '../lib/planTripProposal';
import {
  applyItineraryChange,
  stageItineraryChange,
  undoItineraryChange,
} from '../lib/itineraryChangeClient';
import { emptyItinerary } from '../lib/itinerarySanitize';
import { GENERATION_DISABLED_DETAIL } from '../../supabase/functions/_shared/itineraryProposalCache';
import type { Itinerary } from '../data';

vi.mock('../lib/planTripProposal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/planTripProposal')>();
  return { ...actual, planTripProposal: vi.fn() };
});

vi.mock('../lib/itineraryChangeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/itineraryChangeClient')>();
  return {
    ...actual,
    stageItineraryChange: vi.fn(),
    applyItineraryChange: vi.fn(),
    undoItineraryChange: vi.fn(),
  };
});

const mockedPlan = vi.mocked(planTripProposal);
const mockedStage = vi.mocked(stageItineraryChange);
const mockedApply = vi.mocked(applyItineraryChange);
const mockedUndo = vi.mocked(undoItineraryChange);

const appliedItinerary: Itinerary = { ...emptyItinerary, id: 'trip-1', name: 'Applied trip', revision: 9 };
const restoredItinerary: Itinerary = { ...emptyItinerary, id: 'trip-1', name: 'Restored trip', revision: 8 };

const stagedOk = {
  ok: true as const,
  staged: {
    proposalId: 'stage-1',
    expiresAt: '2026-08-17T10:00:00.000Z',
    applicable: true,
    blocking: [],
    warnings: ['Opening hours are unknown for Museum.'],
    diff: {
      added: [{ id: 'b', name: 'Museum', day: 1, time: '11:37' }],
      removed: [],
      moved: [{ id: 'a', name: 'Osaka Castle', day: 1, time: '09:15', fromDay: 2, toDay: 1 }],
      retimed: [],
      durationChanged: [],
      travelChanged: [],
      windowsAdded: [],
      windowsRemoved: [],
      dayCounts: [],
      preservedMustDo: [{ id: 'a', name: 'Osaka Castle', day: 1, time: '09:15' }],
      unscheduled: [],
      warnings: [],
      conflicts: [],
      totals: { added: 1, removed: 0, moved: 1, retimed: 0, daysTouched: 2 },
    },
  },
};

const openPanel = async (props: Partial<Parameters<typeof PlanTripProposalPanel>[0]> = {}) => {
  render(<PlanTripProposalPanel tripId="trip-1" tripName="Osaka days" {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Plan my trip' }));
  await screen.findByText('Proposed itinerary');
};

beforeEach(() => {
  mockedPlan.mockReset();
  mockedStage.mockReset();
  mockedApply.mockReset();
  mockedUndo.mockReset();
  mockedStage.mockResolvedValue(stagedOk);
  mockedApply.mockResolvedValue({
    ok: true,
    changeId: 'change-1',
    itinerary: appliedItinerary,
    alreadyApplied: false,
  });
  mockedUndo.mockResolvedValue({
    ok: true,
    changeId: 'change-1',
    itinerary: restoredItinerary,
    alreadyUndone: false,
  });
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
  it('shows a full proposal and writes nothing on its own', async () => {
    await openPanel();

    expect(screen.getByText('Osaka Castle')).toBeInTheDocument();
    expect(screen.getByText(/27 min Walking from Osaka Castle/)).toBeInTheDocument();
    expect(screen.getByText(/Proposal only · not saved/)).toBeInTheDocument();
    // Opening the panel and generating a plan must never touch the itinerary.
    expect(mockedStage).not.toHaveBeenCalled();
    expect(mockedApply).not.toHaveBeenCalled();
    expect(mockedPlan).toHaveBeenCalledTimes(1);
  });

  it('regenerates only after the traveller asks', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate proposal' }));
    await waitFor(() => expect(mockedPlan).toHaveBeenCalledTimes(2));
  });

  it('requires a second, explicit confirmation before it writes', async () => {
    await openPanel();

    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    expect(await screen.findByText('Apply this plan to your itinerary?')).toBeInTheDocument();
    // Staged, reviewed — and still not written.
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedApply).not.toHaveBeenCalled();
    // Staged by the identity of the plan on screen, never by trip alone.
    expect(mockedStage).toHaveBeenCalledWith('trip-1', { proposalId: 'p1', materialRevision: 'r1' });

    fireEvent.click(screen.getByRole('button', { name: 'Apply to my itinerary' }));
    await screen.findByText('Applied to your itinerary');
    expect(mockedApply).toHaveBeenCalledWith('stage-1', expect.anything());
  });

  it('shows the structured changes before asking for confirmation', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    await screen.findByText('Apply this plan to your itinerary?');

    expect(screen.getByText(/Moves Osaka Castle from day 2 to day 1/)).toBeInTheDocument();
    expect(screen.getByText(/Adds Museum to your days/)).toBeInTheDocument();
    expect(screen.getByText(/Keeps every Must do: Osaka Castle/)).toBeInTheDocument();
    expect(screen.getByText('Opening hours are unknown for Museum.')).toBeInTheDocument();
  });

  it('backs out of the confirmation without writing', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    await screen.findByText('Apply this plan to your itinerary?');

    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));

    await waitFor(() => expect(screen.queryByText('Apply this plan to your itinerary?')).not.toBeInTheDocument());
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it('hands the written itinerary back to the app', async () => {
    const onApplied = vi.fn();
    await openPanel({ onApplied });

    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to my itinerary' }));
    await screen.findByText('Applied to your itinerary');

    expect(onApplied).toHaveBeenCalledWith(appliedItinerary);
  });

  it('cannot be confirmed twice by double-clicking', async () => {
    let release: (value: Awaited<ReturnType<typeof applyItineraryChange>>) => void = () => {};
    mockedApply.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    const confirm = await screen.findByRole('button', { name: 'Apply to my itinerary' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mockedApply).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Applying to your itinerary/)).toBeInTheDocument();
    release({ ok: true, changeId: 'change-1', itinerary: appliedItinerary, alreadyApplied: false });
    await screen.findByText('Applied to your itinerary');
  });

  it('offers Undo only as a deliberate action, and restores through the app', async () => {
    const onApplied = vi.fn();
    await openPanel({ onApplied });
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to my itinerary' }));
    await screen.findByText('Applied to your itinerary');

    expect(mockedUndo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo this change' }));

    await screen.findByText(/Change undone/);
    expect(mockedUndo).toHaveBeenCalledWith('change-1', expect.anything());
    expect(onApplied).toHaveBeenLastCalledWith(restoredItinerary);
  });

  it('explains a stale plan and offers a fresh one instead of writing', async () => {
    mockedStage.mockResolvedValue({
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made.',
    });
    await openPanel();
    expect(mockedPlan).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your itinerary changed since this plan was created.');
    expect(alert).toHaveTextContent('Create a fresh plan so it matches your latest itinerary.');
    expect(alert).not.toHaveTextContent(/material revision|source proposal|409/i);
    expect(within(alert).getByRole('button', { name: 'Create fresh plan' })).toBeInTheDocument();
    expect(screen.getByText('Osaka Castle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate proposal' })).not.toBeInTheDocument();
    expect(mockedApply).not.toHaveBeenCalled();
    expect(mockedPlan).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Apply this plan to your itinerary?')).not.toBeInTheDocument();
  });

  it('does not regenerate until the traveller asks for a fresh stale plan', async () => {
    mockedStage.mockResolvedValue({
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made.',
    });
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    const alert = await screen.findByRole('alert');

    fireEvent.click(within(alert).getByRole('button', { name: 'Create fresh plan' }));
    await waitFor(() => expect(mockedPlan).toHaveBeenCalledTimes(2));
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it('lets an explicit fresh-plan request reuse an exact cached proposal', async () => {
    mockedStage.mockResolvedValue({
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made.',
    });
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    await screen.findByRole('alert');

    mockedPlan.mockResolvedValue({
      status: 'answered',
      proposal: {
        kind: 'itinerary-proposal-v1', id: 'p-cached', tripId: 'trip-1', materialRevision: 'r2',
        createdAt: '2026-08-16T09:00:00Z', status: 'valid', applied: false, pace: 'balanced',
        days: [{
          day: 1, city: 'Osaka', startTime: '09:15', endTime: '21:30', warnings: [],
          metrics: { placeCount: 1, travelMinutes: 0, freeMinutes: 90, clusterChanges: 0 },
          items: [
            { id: 'c', placeId: 'c', type: 'place', name: 'Cached Dotonbori plan', arrivalTime: '09:15', startTime: '09:15', endTime: '10:45', visitDurationMinutes: 90, bufferMinutes: 0, rationale: 'Cached', warnings: [], evidence: [], priority: 'must-do' },
          ],
        }],
        conflicts: [], warnings: [], omittedPlaceIds: [],
        routeSummary: { matrixCalls: 0, confirmedLegs: 0, unavailableLegs: 0, allDurationsProviderDerived: true },
        repairIterations: 0,
      },
    });

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Create fresh plan' }));
    expect(await screen.findByText('Cached Dotonbori plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply plan/ })).toBeEnabled();
    expect(mockedPlan).toHaveBeenCalledTimes(2);
    expect(mockedStage).toHaveBeenCalledTimes(1);
  });

  it('does not bypass the generation kill switch when recovering from stale', async () => {
    mockedStage.mockResolvedValue({
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made.',
    });
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    await screen.findByRole('alert');

    mockedPlan.mockResolvedValue({
      status: 'refused',
      detail: GENERATION_DISABLED_DETAIL,
    });

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Create fresh plan' }));
    expect(await screen.findByText('No proposal was generated')).toBeInTheDocument();
    expect(screen.getByText(GENERATION_DISABLED_DETAIL)).toBeInTheDocument();
    expect(mockedPlan).toHaveBeenCalledTimes(2);
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it('closes a stale panel without writing', async () => {
    mockedStage.mockResolvedValue({
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made.',
    });
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Close Plan my trip' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockedPlan).toHaveBeenCalledTimes(1);
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedApply).not.toHaveBeenCalled();
    expect(mockedUndo).not.toHaveBeenCalled();
  });

  it('explains an unavailable source proposal and still offers a fresh plan', async () => {
    mockedStage.mockResolvedValue({
      ok: false,
      refusal: 'proposal-invalid',
      detail: 'A reviewed plan is required.',
    });
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This plan is no longer available.');
    expect(alert).toHaveTextContent('Generate a fresh plan based on your current trip.');
    expect(within(alert).getByRole('button', { name: 'Create fresh plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply plan/ })).not.toBeInTheDocument();
    expect(mockedApply).not.toHaveBeenCalled();
    expect(mockedPlan).toHaveBeenCalledTimes(1);
  });

  it('requires another explicit review after a staged confirmation expires', async () => {
    mockedApply.mockResolvedValue({
      ok: false,
      refusal: 'proposal-expired',
      detail: 'This plan has expired. Generate it again to apply it.',
    });
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to my itinerary' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This confirmation expired.');
    expect(alert).toHaveTextContent('Review the latest plan again before applying it.');
    expect(screen.queryByText('Apply this plan to your itinerary?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply plan/ })).not.toBeInTheDocument();
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedApply).toHaveBeenCalledTimes(1);

    fireEvent.click(within(alert).getByRole('button', { name: 'Review this plan again' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply plan/ })).toBeEnabled();
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedApply).toHaveBeenCalledTimes(1);
    expect(mockedPlan).toHaveBeenCalledTimes(1);
  });

  it('does not silently restage when the itinerary changes after confirmation', async () => {
    mockedApply.mockResolvedValue({
      ok: false,
      refusal: 'proposal-stale',
      detail: 'Your itinerary changed after this plan was prepared. Review a fresh proposal before applying.',
    });
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to my itinerary' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your itinerary changed since this plan was created.');
    expect(within(alert).getByRole('button', { name: 'Create fresh plan' })).toBeInTheDocument();
    expect(screen.queryByText('Apply this plan to your itinerary?')).not.toBeInTheDocument();
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedApply).toHaveBeenCalledTimes(1);
    expect(mockedPlan).toHaveBeenCalledTimes(1);
  });

  it('refuses to open the confirmation for a plan the server says is blocked', async () => {
    mockedStage.mockResolvedValue({
      ok: true,
      staged: { ...stagedOk.staged, applicable: false, blocking: ['Glico Man Sign is a Must do and was left out.'] },
    });
    await openPanel();

    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This plan can't be applied yet.");
    expect(alert).toHaveTextContent('Glico Man Sign is a Must do and was left out.');
    expect(screen.queryByRole('button', { name: /Apply plan/ })).not.toBeInTheDocument();
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it('keeps the itinerary and stays undoable when Undo is refused as stale', async () => {
    mockedUndo.mockResolvedValue({
      ok: false,
      refusal: 'undo-stale',
      detail: 'Your itinerary changed after this plan was applied.',
    });
    const onApplied = vi.fn();
    await openPanel({ onApplied });
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to my itinerary' }));
    await screen.findByText('Applied to your itinerary');
    onApplied.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Undo this change' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your itinerary changed after this plan was applied.');
    // Nothing was written back over the newer itinerary.
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo this change' })).toBeInTheDocument();
  });

  it('stages whichever plan is on screen after a regeneration', async () => {
    await openPanel();
    mockedPlan.mockResolvedValue({
      status: 'answered',
      proposal: {
        kind: 'itinerary-proposal-v1', id: 'p2-regenerated', tripId: 'trip-1', materialRevision: 'r1',
        createdAt: '2026-08-16T09:00:00Z', status: 'valid', applied: false, pace: 'balanced',
        days: [], conflicts: [], warnings: [], omittedPlaceIds: [],
        routeSummary: { matrixCalls: 1, confirmedLegs: 0, unavailableLegs: 0, allDurationsProviderDerived: true },
        repairIterations: 0,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate proposal' }));
    await waitFor(() => expect(mockedPlan).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /Apply plan/ }));

    // The panel follows what it is displaying, not the first plan it ever saw.
    await waitFor(() => expect(mockedStage)
      .toHaveBeenCalledWith('trip-1', { proposalId: 'p2-regenerated', materialRevision: 'r1' }));
  });

  it('does not offer Apply while the proposal has conflicts to resolve', async () => {
    mockedPlan.mockResolvedValue({
      status: 'partial',
      proposal: {
        kind: 'itinerary-proposal-v1', id: 'p2', tripId: 'trip-1', materialRevision: 'r1',
        createdAt: '2026-08-16T08:00:00Z', status: 'needs-review', applied: false, pace: 'balanced',
        days: [],
        conflicts: [{ code: 'must-do-omitted', severity: 'error', message: 'A Must do was left out.' }],
        warnings: [], omittedPlaceIds: [],
        routeSummary: { matrixCalls: 1, confirmedLegs: 0, unavailableLegs: 0, allDurationsProviderDerived: true },
        repairIterations: 2,
      },
    });
    await openPanel();

    expect(screen.getByRole('button', { name: /Apply plan/ })).toBeDisabled();
    expect(mockedStage).not.toHaveBeenCalled();
  });
});
