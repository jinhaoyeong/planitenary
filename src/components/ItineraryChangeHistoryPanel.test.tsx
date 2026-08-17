// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItineraryChangeHistoryPanel } from './ItineraryChangeHistoryPanel';
import { listItineraryChangeHistory } from '../lib/itineraryChangeClient';
import type { ItineraryHistoryItem } from '../lib/itineraryChangeClient';
import { sanitizeHistoryDiff } from '../../supabase/functions/_shared/itineraryChangeHistory';

vi.mock('../lib/itineraryChangeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/itineraryChangeClient')>();
  return { ...actual, listItineraryChangeHistory: vi.fn() };
});

const mockedList = vi.mocked(listItineraryChangeHistory);

const applied: ItineraryHistoryItem = {
  id: '8f3c1a2b-1111-2222-3333-444444444444',
  appliedAt: '2026-08-17T11:42:00.000Z',
  undoneAt: null,
  status: 'applied',
  title: 'AI plan applied',
  summary: '2 places moved · 1 meal window added',
  diff: sanitizeHistoryDiff({
    moved: [{ name: 'Kuromon Ichiba Market', fromDay: 1, toDay: 2 }],
    retimed: [{ name: 'Kuromon Ichiba Market', fromTime: '14:48', toTime: '10:30' }],
    windowsAdded: [{ kind: 'meal-window', name: 'Lunch window', day: 1, time: '12:00' }],
  }),
};

const undone: ItineraryHistoryItem = {
  id: '9a4d2b3c-5555-6666-7777-888888888888',
  appliedAt: '2026-08-17T19:42:00',
  undoneAt: '2026-08-17T20:14:00',
  status: 'undone',
  title: 'AI plan applied',
  summary: '1 place retimed · 1 travel leg updated',
  diff: sanitizeHistoryDiff({
    retimed: [{ name: 'Glico Man Sign', fromTime: '10:25', toTime: '11:00' }],
    travelChanged: [{ name: 'Travel', toMinutes: 11 }],
    preservedMustDo: [{ name: 'Glico Man Sign' }],
  }),
};

const longName = 'Kuromon Ichiba Market — the very long covered food hall next to Namba that travellers always want to linger in';

const longNamed: ItineraryHistoryItem = {
  ...applied,
  id: 'aa000000-0000-0000-0000-000000000001',
  summary: `${longName} retimed`,
  diff: sanitizeHistoryDiff({
    retimed: [{ name: longName, fromTime: '10:25', toTime: '11:00' }],
  }),
};

const openHistory = async () => {
  const user = userEvent.setup();
  render(<ItineraryChangeHistoryPanel tripId="trip-1" tripName="Osaka days" />);
  await user.click(screen.getByRole('button', { name: 'Plan changes' }));
  return user;
};

beforeEach(() => {
  mockedList.mockReset();
  mockedList.mockResolvedValue({ ok: true, changes: [undone, applied] });
});

describe('Plan changes panel', () => {
  it('renders an applied item without implementation details', async () => {
    await openHistory();
    expect(await screen.findByText('2 places moved · 1 meal window added')).toBeInTheDocument();
    const appliedRow = screen.getByText('2 places moved · 1 meal window added').closest('button');
    expect(appliedRow?.querySelector('.is-applied')).toHaveTextContent('Applied');
    expect(appliedRow).toHaveTextContent('AI plan applied');
    expect(screen.queryByText(applied.id)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^undo$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Restore/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/re-apply/i)).not.toBeInTheDocument();
  });

  it('renders an undone item with its apply time and status', async () => {
    await openHistory();
    expect(await screen.findByText('1 place retimed · 1 travel leg updated')).toBeInTheDocument();
    const undoneRow = screen.getByText('1 place retimed · 1 travel leg updated').closest('button');
    expect(undoneRow?.querySelector('.is-undone')).toHaveTextContent('Undone');
    expect(undoneRow?.querySelector('.is-applied')).toBeNull();
    expect(undoneRow).toHaveTextContent('Undone at');
  });

  it('opens a deterministic diff and hides empty categories', async () => {
    const user = await openHistory();
    await user.click(screen.getByText('1 place retimed · 1 travel leg updated'));
    expect(await screen.findByRole('heading', { name: 'Changes' })).toBeInTheDocument();
    expect(screen.getAllByText('Glico Man Sign').length).toBeGreaterThan(0);
    expect(screen.getByText('10:25 → 11:00')).toBeInTheDocument();
    expect(screen.getByText('updated to 11 min')).toBeInTheDocument();
    expect(screen.getByText('preserved')).toBeInTheDocument();
    expect(screen.getByText('Times changed')).toBeInTheDocument();
    expect(screen.getByText('Must do')).toBeInTheDocument();
    expect(screen.queryByText('Places added')).not.toBeInTheDocument();
    expect(screen.queryByText('Places removed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('shows the empty state for a trip with no plan changes', async () => {
    mockedList.mockResolvedValue({ ok: true, changes: [] });
    await openHistory();
    expect(await screen.findByText('No itinerary changes yet.')).toBeInTheDocument();
    expect(screen.getByText('Changes you apply from Plan my trip will appear here.')).toBeInTheDocument();
  });

  it('shows a loading state then a friendly retry on error', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof listItineraryChangeHistory>>) => void;
    mockedList.mockImplementation(() => new Promise((next) => {
      resolve = next;
    }));
    fireEvent.click(render(<ItineraryChangeHistoryPanel tripId="trip-1" />).getByRole('button', { name: 'Plan changes' }));
    expect(await screen.findByLabelText('Loading plan changes')).toBeInTheDocument();

    resolve({ ok: false, refusal: 'unavailable', detail: 'Invalid JWT: PGRST301' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan changes could not be loaded. Try again.');
    expect(screen.queryByText(/JWT|PGRST|supabase/i)).not.toBeInTheDocument();

    mockedList.mockResolvedValue({ ok: true, changes: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No itinerary changes yet.')).toBeInTheDocument();
  });

  it('wraps long names on a phone-width panel without restore controls', async () => {
    mockedList.mockResolvedValue({ ok: true, changes: [longNamed] });
    const user = userEvent.setup();
    const { container } = render(
      <div style={{ width: 390, overflow: 'hidden' }}>
        <ItineraryChangeHistoryPanel tripId="trip-1" tripName="Osaka days" />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Plan changes' }));
    await user.click(await screen.findByText(`${longName} retimed`));
    expect(screen.getByText(longName)).toHaveClass('plan-changes-name');
    expect(document.querySelector('.plan-changes-panel')).not.toBeNull();
    expect(container.querySelector('.plan-changes-panel') ?? document.querySelector('.plan-changes-panel'))
      .toHaveClass('plan-changes-panel');
    expect(screen.queryByText(/restore this version/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close plan changes' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
