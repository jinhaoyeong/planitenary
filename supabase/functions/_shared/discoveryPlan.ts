/**
 * Preference-aware discovery planning.
 *
 * This module is deliberately dependency-free so the Edge Function and the
 * client-side fixture path use the same stored travel-style vocabulary and the
 * same preference-first/fallback semantics. The values here are the ids stored
 * by Trip Setup, not a second set of labels shown to travellers.
 */

export const STYLE_TAGS: Record<string, string[]> = {
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

interface QueryGroupTemplate {
  id: string;
  text: string;
  categories: string[];
}

/** Query groups used by every live provider. */
export const DISCOVERY_QUERY_GROUPS: Record<string, QueryGroupTemplate> = {
  food: {
    id: 'food',
    text: 'markets, street food, cafes and local restaurants',
    categories: ['market', 'food', 'cafes', 'food-district'],
  },
  shopping: {
    id: 'shopping',
    text: 'shopping districts, arcades and specialty shops',
    categories: ['shopping', 'market', 'local-character'],
  },
  nature: {
    id: 'nature',
    text: 'parks, gardens, viewpoints and nature walks',
    categories: ['park', 'garden', 'nature', 'view', 'waterfront', 'beaches'],
  },
  heritage: {
    id: 'heritage',
    text: 'historic sites, temples and shrines',
    categories: ['history', 'temple', 'shrine'],
  },
  museums: {
    id: 'museums',
    text: 'museums and galleries',
    categories: ['museum', 'art'],
  },
  architecture: {
    id: 'architecture',
    text: 'architecture, landmarks and city views',
    categories: ['architecture', 'view', 'essential'],
  },
  water: {
    id: 'water',
    text: 'beaches, waterfronts and scenic shores',
    categories: ['beaches', 'waterfront', 'nature'],
  },
  wildlife: {
    id: 'wildlife',
    text: 'zoos, aquariums and wildlife',
    categories: ['wildlife', 'aquarium'],
  },
  scenic: {
    id: 'scenic',
    text: 'scenic train rides and viewpoints',
    categories: ['view', 'waterfront', 'nature'],
  },
  pop: {
    id: 'pop',
    text: 'anime, pop culture and theme parks',
    categories: ['anime', 'theme-park', 'experience'],
  },
  nightlife: {
    id: 'nightlife',
    text: 'nightlife, evening districts and late cafes',
    categories: ['nightlife', 'evening', 'local-character'],
  },
  local: {
    id: 'local',
    text: 'local neighbourhoods, markets and walking districts',
    categories: ['local-character', 'market', 'food-district'],
  },
  general: {
    id: 'general',
    text: 'top attractions and iconic landmarks',
    categories: ['essential', 'view', 'local-character'],
  },
};

const STYLE_QUERY_GROUPS: Record<string, string[]> = {
  cafes: ['food'],
  'street-food': ['food'],
  'night-markets': ['food', 'nightlife'],
  temples: ['heritage'],
  museums: ['museums'],
  history: ['heritage'],
  architecture: ['architecture'],
  shopping: ['shopping'],
  mountains: ['nature'],
  hiking: ['nature'],
  nature: ['nature'],
  beaches: ['water'],
  wildlife: ['wildlife'],
  'scenic-train': ['scenic'],
  anime: ['pop'],
  nightlife: ['nightlife'],
};

const GENERAL_QUERY_GROUPS = ['general', 'food', 'shopping', 'nature', 'heritage', 'museums', 'nightlife'];

export interface PlannedDiscoveryQuery {
  id: string;
  text: string;
  categories: string[];
  matchedStyles: string[];
  isFallback: boolean;
  fallbackReason?: string;
}

export interface DiscoveryQueryPlan {
  selectedStyles: string[];
  mode: 'preference-first' | 'general';
  preferredQueries: PlannedDiscoveryQuery[];
  fallbackQueries: PlannedDiscoveryQuery[];
  /** Maximum normal general fallback share; sparse destinations may exceed it. */
  fallbackLimit: number;
}

export interface DiscoveryCandidateLike {
  id?: string;
  providerPlaceId?: string;
  categories?: readonly string[];
  experienceTags?: readonly string[];
  notability?: number;
  rating?: number;
  reviewCount?: number;
  provider?: string;
  sourceConfidence?: string;
  sourceReferences?: readonly unknown[];
}

export interface DiscoveryTrace {
  /** The stored Trip Setup id that explains this candidate, when matched. */
  matchedStyle?: string;
  matchedQueryGroup: string;
  /** Present only for a general candidate, never shown in the UI. */
  fallbackReason?: string;
}

export interface DiscoveryQueryEntry<T> {
  candidate: T;
  query: PlannedDiscoveryQuery;
}

export interface SelectedDiscoveryCandidate<T> {
  candidate: T;
  trace: DiscoveryTrace;
}

const normaliseStyles = (styles: readonly string[] | undefined): string[] => [...new Set(
  (styles || [])
    .map((style) => style.trim().toLowerCase())
    .filter((style) => Boolean(STYLE_QUERY_GROUPS[style])),
)];

const queryFrom = (
  groupId: string,
  matchedStyles: string[],
  isFallback: boolean,
  fallbackReason?: string,
): PlannedDiscoveryQuery => {
  const group = DISCOVERY_QUERY_GROUPS[groupId];
  if (!group) throw new Error(`Unknown discovery query group: ${groupId}`);
  return {
    id: group.id,
    text: group.text,
    categories: [...group.categories],
    matchedStyles,
    isFallback,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
};

/**
 * Build the ordered query plan. Preferred groups are always emitted before a
 * general query, so providers can stop before asking for irrelevant categories
 * when the validated preferred pool already fills the target.
 */
export function buildDiscoveryQueryPlan(
  styles: readonly string[] = [],
  limit = 60,
  options: { hiddenGems?: boolean } = {},
): DiscoveryQueryPlan {
  const selectedStyles = normaliseStyles(styles);
  if (options.hiddenGems && !selectedStyles.includes('hidden-gems')) selectedStyles.push('hidden-gems');

  const preferredGroupIds: string[] = [];
  for (const style of selectedStyles) {
    const groups = style === 'hidden-gems' ? ['local'] : STYLE_QUERY_GROUPS[style] || [];
    for (const group of groups) {
      if (!preferredGroupIds.includes(group)) preferredGroupIds.push(group);
    }
  }

  const target = Math.max(1, Math.floor(limit));
  const preferenceFirst = selectedStyles.length > 0 && preferredGroupIds.length > 0;
  const preferredQueries = preferenceFirst
    ? preferredGroupIds.map((groupId) => queryFrom(
      groupId,
      selectedStyles.filter((style) => (style === 'hidden-gems' ? groupId === 'local' : STYLE_QUERY_GROUPS[style]?.includes(groupId))),
      false,
    ))
    : [];
  const fallbackQueries = preferenceFirst
    ? [queryFrom('general', [], true, 'general-iconic')]
    : GENERAL_QUERY_GROUPS.map((groupId) => queryFrom(groupId, [], true, 'no-preferences'));

  return {
    selectedStyles,
    mode: preferenceFirst ? 'preference-first' : 'general',
    preferredQueries,
    fallbackQueries,
    fallbackLimit: preferenceFirst ? Math.max(1, Math.ceil(target * 0.2)) : target,
  };
}

const candidateTags = (candidate: DiscoveryCandidateLike): Set<string> => new Set([
  ...(candidate.categories || []),
  ...(candidate.experienceTags || []),
].map((tag) => tag.trim().toLowerCase()).filter(Boolean));

export function matchedStylesForCandidate(
  candidate: DiscoveryCandidateLike,
  selectedStyles: readonly string[],
): string[] {
  const tags = candidateTags(candidate);
  return selectedStyles.filter((style) => (STYLE_TAGS[style] || [style]).some((tag) => tags.has(tag)));
}

export function queryMatchesCandidate(
  candidate: DiscoveryCandidateLike,
  query: Pick<PlannedDiscoveryQuery, 'categories'>,
): boolean {
  const tags = candidateTags(candidate);
  return query.categories.some((category) => tags.has(category));
}

/**
 * General results need stronger evidence than ordinary provider eligibility.
 * This prevents a random place of worship or museum from being admitted just
 * because a provider tagged it as a tourism attraction.
 */
export function isStrongGeneralCandidate(candidate: DiscoveryCandidateLike): boolean {
  if (typeof candidate.notability === 'number' && candidate.notability >= 0.55) return true;
  if (typeof candidate.rating === 'number' && candidate.rating >= 4.5
    && typeof candidate.reviewCount === 'number' && candidate.reviewCount >= 100) return true;
  // Captured official fixtures are already curated, unlike an arbitrary live
  // provider row. This keeps the offline product path useful without weakening
  // the live general-candidate gate.
  return candidate.provider === 'official-tourism'
    && (candidate.sourceReferences?.length || 0) > 0;
}

const candidateKey = (candidate: DiscoveryCandidateLike): string | undefined => (
  candidate.providerPlaceId || candidate.id
);

/** Find the first query group whose category vocabulary explains a candidate. */
export function queryForCandidate<T extends DiscoveryCandidateLike>(
  candidate: T,
  plan: DiscoveryQueryPlan,
): PlannedDiscoveryQuery | undefined {
  return [...plan.preferredQueries, ...plan.fallbackQueries]
    .find((query) => queryMatchesCandidate(candidate, query))
    || plan.fallbackQueries[0];
}

/**
 * Validate, dedupe and apply the bounded fallback rule after provider results
 * arrive. Ranking happens later; irrelevant records never enter that pool.
 */
export function selectDiscoveryEntries<T extends DiscoveryCandidateLike>(
  entries: readonly DiscoveryQueryEntry<T>[],
  plan: DiscoveryQueryPlan,
  limit: number,
): SelectedDiscoveryCandidate<T>[] {
  const preferred: SelectedDiscoveryCandidate<T>[] = [];
  const fallback: SelectedDiscoveryCandidate<T>[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = candidateKey(entry.candidate);
    if (!key || seen.has(key)) continue;

    const matchedStyle = matchedStylesForCandidate(entry.candidate, plan.selectedStyles)[0]
      || entry.query.matchedStyles[0];
    const targetedMatch = Boolean(matchedStyle) && (
      matchedStylesForCandidate(entry.candidate, plan.selectedStyles).length > 0
      || queryMatchesCandidate(entry.candidate, entry.query)
    );

    if (plan.mode === 'preference-first') {
      if (!entry.query.isFallback && targetedMatch) {
        seen.add(key);
        preferred.push({
          candidate: entry.candidate,
          trace: { matchedStyle, matchedQueryGroup: entry.query.id },
        });
      } else if (entry.query.isFallback) {
        if (matchedStyle) {
          seen.add(key);
          preferred.push({
            candidate: entry.candidate,
            trace: { matchedStyle, matchedQueryGroup: entry.query.id },
          });
        } else if (isStrongGeneralCandidate(entry.candidate)) {
          seen.add(key);
          fallback.push({
            candidate: entry.candidate,
            trace: { matchedQueryGroup: entry.query.id },
          });
        }
      }
      continue;
    }

    if (isStrongGeneralCandidate(entry.candidate)) {
      seen.add(key);
      fallback.push({
        candidate: entry.candidate,
        trace: { matchedStyle, matchedQueryGroup: entry.query.id },
      });
    }
  }

  const target = Math.max(1, Math.floor(limit));
  if (plan.mode === 'general') {
    return fallback.slice(0, target).map(({ candidate, trace }) => ({
      candidate,
      trace: { ...trace, fallbackReason: 'no-preferences' },
    }));
  }

  const preferredOutput = preferred.slice(0, target);
  const remaining = Math.max(0, target - preferredOutput.length);
  const sparse = preferredOutput.length < target - plan.fallbackLimit;
  const fallbackCount = sparse ? remaining : Math.min(remaining, plan.fallbackLimit);
  const fallbackReason = sparse ? 'sparse-preference-pool' : 'bounded-general-fallback';
  return [
    ...preferredOutput,
    ...fallback.slice(0, fallbackCount).map(({ candidate, trace }) => ({
      candidate,
      trace: { ...trace, fallbackReason },
    })),
  ];
}
