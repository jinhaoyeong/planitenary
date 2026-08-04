import type { CanonicalPlace, SourceEvidence, TravelClaim } from './travelEvidence';

export interface EvidenceDocument {
  id: string;
  sourceUrl: string;
  text: string;
  source: SourceEvidence['source'];
  canonicalPlaceId?: string;
}

export interface PlaceEvidenceSummary {
  canonicalPlaceId: string;
  summary: string;
  claims: TravelClaim[];
  limitations: string[];
}

export interface PromotionAssessment {
  label: 'organic' | 'sponsored' | 'possible-promotion' | 'unknown';
  confidence: number;
  explanation: string;
}

export interface PlannerObjective {
  kind: 'reduce-travel' | 'relax-pace' | 'local-food' | 'avoid-crowds' | 'lower-cost' | 'rainy-day' | 'unknown';
  instruction: string;
}

export interface StructuredItineraryPlan {
  days: Array<{ day: number; activities: Array<{ name: string; time: string; sourceIds?: string[] }> }>;
}

export interface PlanExplanation {
  summary: string;
  reasons: Array<{ activity: string; explanation: string; sourceIds: string[] }>;
  limitations: string[];
}

/** Server-backed interpretation boundary. It must receive source-backed input. */
export interface TravelReasoningProvider {
  extractClaims(input: EvidenceDocument[]): Promise<TravelClaim[]>;
  summarisePlaceEvidence(place: CanonicalPlace, evidence: SourceEvidence[]): Promise<PlaceEvidenceSummary>;
  classifyPromotionRisk(evidence: SourceEvidence): Promise<PromotionAssessment>;
  parseImprovementRequest(input: string): Promise<PlannerObjective[]>;
  explainPlan(plan: StructuredItineraryPlan): Promise<PlanExplanation>;
}

