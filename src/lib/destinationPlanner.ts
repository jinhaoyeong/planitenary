import type { Activity, DayPlan, Itinerary } from '../data';
import type { TripProfile } from './tripProfile';
import {
  candidateToActivity,
  type CandidateDecision,
  type CandidateScoreBreakdown,
  type PlaceCandidate,
  type RankedCandidate,
} from './destinationIntelligence';

const STYLE_TAGS: Record<string, string[]> = {
  cafes: ['cafes', 'food'],
  'street-food': ['street-food', 'food', 'market', 'food-district'],
  'night-markets': ['market', 'evening', 'nightlife'],
  temples: ['temples', 'temple', 'shrine', 'history'],
  museums: ['museums', 'museum', 'art'],
  history: ['history', 'temple', 'shrine'],
  architecture: ['architecture', 'view'],
  shopping: ['shopping', 'market'],
  mountains: ['nature', 'hiking', 'view'],
  hiking: ['hiking', 'walk', 'nature'],
  nature: ['nature', 'park', 'garden'],
  beaches: ['waterfront', 'nature'],
  wildlife: ['wildlife', 'aquarium'],
  'scenic-train': ['view', 'waterfront'],
  anime: ['anime', 'theme-park'],
  nightlife: ['nightlife', 'evening', 'view'],
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const dataCompleteness = (candidate: PlaceCandidate) => {
  const checks = [
    candidate.providerPlaceId,
    candidate.coordinates,
    candidate.neighbourhood,
    candidate.openingHours,
    candidate.sourceReferences.length > 0,
    candidate.lastVerifiedAt,
  ];
  return checks.filter(Boolean).length / checks.length;
};

const budgetFit = (candidate: PlaceCandidate, profile: TripProfile) => {
  const price = candidate.priceLevel ?? 2;
  if (profile.budgetTier === 'budget') return clamp01(1 - Math.max(0, price - 1) * 0.25);
  if (profile.budgetTier === 'luxury') return price >= 2 ? 1 : 0.75;
  return price <= 3 ? 1 : 0.7;
};

export function rankDestinationCandidates(candidates: PlaceCandidate[], profile: TripProfile): RankedCandidate[] {
  const requestedTags = new Set(profile.styles.flatMap((style) => STYLE_TAGS[style] || [style]));
  const neighbourhoodCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.neighbourhood) neighbourhoodCounts.set(candidate.neighbourhood, (neighbourhoodCounts.get(candidate.neighbourhood) || 0) + 1);
  }

  return candidates.map((candidate) => {
    const tags = new Set([...candidate.categories, ...candidate.experienceTags]);
    const matches = [...requestedTags].filter((tag) => tags.has(tag));
    const interestFit = requestedTags.size === 0 ? 0.65 : clamp01(0.35 + matches.length * 0.22);
    const localSignificance = candidate.categories.includes('essential') ? 1 : candidate.categories.includes('local-character') ? 0.9 : 0.7;
    const neighbourhoodFit = clamp01(0.55 + ((neighbourhoodCounts.get(candidate.neighbourhood || '') || 0) - 1) * 0.1);
    const completeness = dataCompleteness(candidate);
    const costFit = budgetFit(candidate, profile);
    const openingHoursFit = candidate.openingHours ? 1 : 0.45;
    const routeCompatibility = candidate.neighbourhood ? 0.85 : 0.5;
    const diversityContribution = candidate.categories.length >= 2 ? 0.85 : 0.65;
    const breakdown: CandidateScoreBreakdown = {
      interestFit,
      localSignificance,
      neighbourhoodFit,
      dataCompleteness: completeness,
      budgetFit: costFit,
      openingHoursFit,
      routeCompatibility,
      diversityContribution,
    };
    const score = Math.round(100 * (
      interestFit * 0.24
      + localSignificance * 0.18
      + neighbourhoodFit * 0.13
      + completeness * 0.15
      + costFit * 0.08
      + openingHoursFit * 0.08
      + routeCompatibility * 0.09
      + diversityContribution * 0.05
    ));
    const reasons = [
      matches.length > 0 ? `Matches ${matches.slice(0, 2).join(' and ')}` : 'Adds destination variety',
      candidate.neighbourhood ? `Fits a ${candidate.neighbourhood} cluster` : 'Can anchor a flexible day',
      candidate.openingHours ? 'Hours captured in fixture' : 'Hours still need live verification',
    ];
    return { candidate, score, breakdown, reasons };
  }).sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
}

export function defaultDiscoveryDecisions(ranked: RankedCandidate[]): Record<string, CandidateDecision> {
  const decisions: Record<string, CandidateDecision> = {};
  ranked.slice(0, 2).forEach(({ candidate }) => { decisions[candidate.id] = 'must-do'; });
  ranked.slice(2, 29).forEach(({ candidate }) => { decisions[candidate.id] = 'interested'; });
  return decisions;
}

interface ThemeDefinition {
  title: string;
  cities: string[];
  neighbourhoods: string[];
  maxPlaces: number;
}

const OSAKA_THEMES: ThemeDefinition[] = [
  { title: 'Arrival and Minami after dark', cities: ['Osaka'], neighbourhoods: ['Namba', 'Minami'], maxPlaces: 2 },
  { title: 'Historic Osaka', cities: ['Osaka'], neighbourhoods: ['Osaka Castle'], maxPlaces: 3 },
  { title: 'Markets and local food', cities: ['Osaka'], neighbourhoods: ['Minami'], maxPlaces: 3 },
  { title: 'Retro Osaka', cities: ['Osaka'], neighbourhoods: ['Tennoji', 'Shinsekai'], maxPlaces: 3 },
  { title: 'Osaka Bay', cities: ['Osaka'], neighbourhoods: ['Osaka Bay'], maxPlaces: 3 },
  { title: 'Art, river and skyline', cities: ['Osaka'], neighbourhoods: ['Nakanoshima', 'Umeda'], maxPlaces: 3 },
  { title: 'Tenma and everyday Osaka', cities: ['Osaka'], neighbourhoods: ['Tenma', 'Umeda'], maxPlaces: 3 },
  { title: 'Northern Osaka breathing room', cities: ['Osaka'], neighbourhoods: ['Ikeda', 'Suita', 'Minoh', 'Nagai', 'Sumiyoshi'], maxPlaces: 3 },
  { title: 'Nara heritage day trip', cities: ['Nara'], neighbourhoods: ['Central Nara'], maxPlaces: 3 },
  { title: 'Kyoto heritage day trip', cities: ['Kyoto'], neighbourhoods: ['Fushimi', 'Higashiyama'], maxPlaces: 3 },
  { title: 'Kobe waterfront day trip', cities: ['Kobe'], neighbourhoods: ['Kobe Waterfront', 'Shin-Kobe'], maxPlaces: 3 },
];

const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const distanceKm = (a: [number, number], b: [number, number]) => {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b[0] - a[0]);
  const dLng = radians(b[1] - a[1]);
  const lat1 = radians(a[0]);
  const lat2 = radians(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const fallbackTransitMinutes = (from: PlaceCandidate, to: PlaceCandidate) => {
  if (!from.coordinates || !to.coordinates) return undefined;
  return Math.max(8, Math.round((distanceKm(from.coordinates, to.coordinates) / 20) * 60 + 8));
};

const createMealWindow = (day: number, time: string, neighbourhood: string): Activity => ({
  id: `discovery-meal-${day}`,
  kind: 'meal-window',
  time,
  durationMinutes: 60,
  name: 'Meal window — venue not selected',
  description: `Keep this hour flexible around ${neighbourhood}.`,
  type: 'food',
  location: neighbourhood,
  source: 'generated',
  lockedFields: [],
  generatedMetadata: { source: 'generated', generatedAt: new Date().toISOString(), reason: 'Schedule constraint, not a discovered attraction.', confidence: 'high' },
});

export interface DestinationBuildResult {
  days: DayPlan[];
  scheduledCandidates: PlaceCandidate[];
  unscheduledCandidates: PlaceCandidate[];
  warnings: string[];
  routeMode: 'offline-straight-line';
}

export function buildDestinationItinerary(
  itinerary: Itinerary,
  profile: TripProfile,
  ranked: RankedCandidate[],
  decisions: Record<string, CandidateDecision>,
): DestinationBuildResult {
  const accepted = ranked
    .filter(({ candidate }) => decisions[candidate.id] === 'must-do' || decisions[candidate.id] === 'interested')
    .map(({ candidate }) => candidate);
  const remaining = new Map(accepted.map((candidate) => [candidate.id, candidate]));
  const dayCount = Math.max(1, itinerary.days.length || profile.dayCount || 1);
  const primaryCity = profile.destinations[0]?.city || itinerary.cities[0] || accepted[0]?.city || '';
  const genericThemes = Array.from(new Set(accepted.map((candidate) => `${candidate.city}|${candidate.neighbourhood || candidate.city}`)))
    .map((key): ThemeDefinition => {
      const [city, neighbourhood] = key.split('|');
      return { title: `${neighbourhood} highlights`, cities: [city], neighbourhoods: [neighbourhood], maxPlaces: 3 };
    });
  const themes = primaryCity.toLowerCase() === 'osaka'
    ? OSAKA_THEMES.slice(0, dayCount)
    : genericThemes.slice(0, dayCount);
  const days: DayPlan[] = [];

  for (let index = 0; index < dayCount; index += 1) {
    const existing = itinerary.days[index];
    const theme = themes[index] || { title: `Flexible Osaka day ${index + 1}`, cities: ['Osaka'], neighbourhoods: [], maxPlaces: 3 };
    const protectedActivities = (existing?.activities || []).filter((activity) => activity.locked || activity.lockedFields?.includes('all') || activity.lockedFields?.includes('schedule'));
    const matching = [...remaining.values()]
      .filter((candidate) => theme.cities.includes(candidate.city) && (theme.neighbourhoods.length === 0 || theme.neighbourhoods.includes(candidate.neighbourhood || '')))
      .slice(0, Math.max(0, theme.maxPlaces - protectedActivities.length));
    matching.forEach((candidate) => remaining.delete(candidate.id));
    let clock = index === 0 ? 15 * 60 : 9 * 60 + 30;
    const discoveredActivities: Activity[] = [];
    matching.forEach((candidate, candidateIndex) => {
      const previous = matching[candidateIndex - 1];
      if (previous) clock += fallbackTransitMinutes(previous, candidate) || 20;
      if (candidateIndex === 1 && clock < 13 * 60) {
        discoveredActivities.push(createMealWindow(index + 1, minutesToTime(Math.max(clock, 12 * 60 + 30)), candidate.neighbourhood || candidate.city));
        clock = Math.max(clock, 13 * 60 + 30);
      }
      const activity = candidateToActivity(candidate);
      activity.time = minutesToTime(clock);
      activity.transportMinutes = previous ? fallbackTransitMinutes(previous, candidate) : undefined;
      activity.transportMode = profile.transport.includes('public-transport') ? 'public transport' : 'walking / public transport';
      activity.travelEstimateSource = previous ? 'offline-straight-line' : 'unknown';
      activity.generatedMetadata = {
        source: 'imported',
        generatedAt: new Date().toISOString(),
        reason: `${candidate.neighbourhood || candidate.city} cluster · ${candidate.categories.slice(0, 2).join(' and ')}`,
        confidence: candidate.openingHours ? 'medium' : 'low',
      };
      discoveredActivities.push(activity);
      clock += candidate.estimatedVisitMinutes;
    });
    days.push({
      day: existing?.day || index + 1,
      date: existing?.date || '',
      city: matching[0]?.city || existing?.city || 'Osaka',
      title: matching.length > 0 ? theme.title : existing?.title || `Flexible day ${index + 1}`,
      activities: [...protectedActivities, ...discoveredActivities].sort((a, b) => a.time.localeCompare(b.time)),
      photos: existing?.photos,
    });
  }

  return {
    days,
    scheduledCandidates: accepted.filter((candidate) => !remaining.has(candidate.id)),
    unscheduledCandidates: [...remaining.values()],
    warnings: [
      'Fixture mode uses captured official-tourism place records.',
      'Travel times are clearly labelled straight-line fallbacks until a server route provider is connected.',
      'Opening hours with low or medium source confidence must be rechecked before travel.',
    ],
    routeMode: 'offline-straight-line',
  };
}
