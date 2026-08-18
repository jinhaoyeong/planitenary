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

interface TripIntelligenceUiValue {
  envelope: IntelligenceUiEnvelope;
  report: (patch: Partial<IntelligenceUiEnvelope>) => void;
  openAsk: () => void;
  askNonce: number;
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

  const value = useMemo<TripIntelligenceUiValue>(() => ({
    envelope,
    report,
    openAsk: () => setAskNonce((current) => current + 1),
    askNonce,
  }), [envelope, report, askNonce]);

  return (
    <TripIntelligenceUiContext.Provider value={value}>
      {children}
    </TripIntelligenceUiContext.Provider>
  );
}

export function useTripIntelligenceUi(): TripIntelligenceUiValue | null {
  return useContext(TripIntelligenceUiContext);
}
