/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { IntelligenceSurface, IntelligenceUiEnvelope } from '../../supabase/functions/_shared/intelligenceContext';
import type { PlannerCapabilityId } from './plannerCapabilities';

/**
 * A capability one surface asked for and another performs.
 *
 * Smart Plan knows what the traveller chose; only the itinerary page holds
 * the planner and the itinerary setter that can act on it. Rather than lift
 * the planner into a shared parent or duplicate it, the request travels: the
 * nonce makes the same capability requestable twice in a row, which a bare id
 * could not express.
 */
export interface PlannerCapabilityRequest {
  id: PlannerCapabilityId;
  nonce: number;
}

interface TripIntelligenceUiValue {
  envelope: IntelligenceUiEnvelope;
  report: (patch: Partial<IntelligenceUiEnvelope>) => void;
  /**
   * Open Ask, optionally with the composer pre-typed.
   *
   * Pre-typed, never sent. A traveller who taps a suggestion has chosen a
   * topic, not authorised a metered request, and the difference is the whole
   * reason this carries text instead of asking the question itself.
   */
  openAsk: (prefill?: string) => void;
  askNonce: number;
  askPrefill: string | null;
  /** Ask the itinerary planner to open a deterministic proposal for review. */
  requestPlannerCapability: (id: PlannerCapabilityId) => void;
  plannerRequest: PlannerCapabilityRequest | null;
  /** Called by whoever handled the request, so it cannot be replayed. */
  clearPlannerRequest: () => void;
}

const TripIntelligenceUiContext = createContext<TripIntelligenceUiValue | null>(null);

export function TripIntelligenceUiProvider({
  tripId,
  surface,
  children,
}: {
  tripId: string;
  surface: IntelligenceSurface;
  children: ReactNode;
}) {
  const [patch, setPatch] = useState<Partial<IntelligenceUiEnvelope>>({});
  const [askNonce, setAskNonce] = useState(0);
  const [askPrefill, setAskPrefill] = useState<string | null>(null);
  const [plannerRequest, setPlannerRequest] = useState<PlannerCapabilityRequest | null>(null);

  const report = useCallback((next: Partial<IntelligenceUiEnvelope>) => {
    setPatch((current) => {
      const merged = { ...current, ...next };
      const keys = new Set([...Object.keys(current), ...Object.keys(merged)]) as Set<keyof IntelligenceUiEnvelope>;
      for (const key of keys) {
        if (JSON.stringify(current[key]) !== JSON.stringify(merged[key])) return merged;
      }
      return current;
    });
  }, []);

  const envelope = useMemo<IntelligenceUiEnvelope>(() => ({
    tripId,
    surface,
    dayNumber: patch.dayNumber,
    selectedActivityId: patch.selectedActivityId,
    selectedPlaceId: patch.selectedPlaceId,
    selectedDocumentId: surface === 'documents' ? patch.selectedDocumentId : undefined,
    selectedMapPoint: surface === 'map' ? patch.selectedMapPoint : undefined,
  }), [tripId, surface, patch]);

  const openAsk = useCallback((prefill?: string) => {
    setAskPrefill(prefill ?? null);
    setAskNonce((current) => current + 1);
  }, []);

  const requestPlannerCapability = useCallback((id: PlannerCapabilityId) => {
    setPlannerRequest((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const clearPlannerRequest = useCallback(() => setPlannerRequest(null), []);

  const value = useMemo<TripIntelligenceUiValue>(() => ({
    envelope,
    report,
    openAsk,
    askNonce,
    askPrefill,
    requestPlannerCapability,
    plannerRequest,
    clearPlannerRequest,
  }), [
    envelope,
    report,
    openAsk,
    askNonce,
    askPrefill,
    requestPlannerCapability,
    plannerRequest,
    clearPlannerRequest,
  ]);

  return (
    <TripIntelligenceUiContext.Provider value={value}>
      {children}
    </TripIntelligenceUiContext.Provider>
  );
}

export function useTripIntelligenceUi(): TripIntelligenceUiValue | null {
  return useContext(TripIntelligenceUiContext);
}
