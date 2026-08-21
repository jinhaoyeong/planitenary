/**
 * Read current admission evidence for identities already established by the
 * server.
 *
 * This module deliberately accepts a provider place id, not a website. The
 * website is re-read from `canonical_places` through its provider link, then
 * passed to the existing official-page reader. That keeps browser text,
 * conversation text and model arguments out of the authority chain.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readCanonicalOfficialSources,
  readEvidenceCache,
  readEvidenceProbes,
  writeEvidenceCache,
  writeEvidenceProbes,
  type CachedEvidence,
} from './cache.ts';
import { probeKey } from './cacheKeys.ts';
import { officialEvidence } from './evidenceSources.ts';
import { isLikelyResellerUrl, isSafePublicUrl } from './officialSource.ts';
import { admissionFromOfficialClaims, type PlaceAdmission } from './placeCost.ts';

/** Fares change more quickly than the general review evidence cache. */
export const OFFICIAL_ADMISSION_TTL_MS = 24 * 60 * 60 * 1_000;
export const OFFICIAL_ADMISSION_PROBE = 'official-admission';

export interface OfficialAdmissionTarget {
  id: string;
  name: string;
  provider?: string;
  providerPlaceId?: string;
}

export interface OfficialAdmissionLookup {
  id: string;
  name: string;
  canonicalPlaceId?: string;
  status: 'verified' | 'no-price' | 'unavailable' | 'rejected-source';
  admission?: PlaceAdmission;
  sourceUrl?: string;
  retrievedAt?: string;
  note: string;
}

const authorityKey = (provider: string | undefined, providerPlaceId: string | undefined): string | undefined =>
  provider && providerPlaceId ? `${provider}|${providerPlaceId}` : undefined;

const authorityForTarget = (
  authorities: ReadonlyMap<string, { canonicalPlaceId: string; providerPlaceId: string; name: string; website?: string; countryCode?: string }>,
  target: OfficialAdmissionTarget,
) => {
  const exact = authorityKey(target.provider, target.providerPlaceId);
  if (exact) {
    const match = authorities.get(exact);
    if (match) return match;
  }
  if (!target.providerPlaceId) return undefined;
  const matches = [...authorities.values()].filter((authority) => authority.providerPlaceId === target.providerPlaceId);
  return matches.length === 1 ? matches[0] : undefined;
};

const isFreshRetrievedAt = (value: string | undefined, now: number): boolean => {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= OFFICIAL_ADMISSION_TTL_MS;
};

const cachedOfficialDocuments = (
  entries: CachedEvidence[] | undefined,
  now: number,
): CachedEvidence[] => (entries || []).filter((entry) =>
  entry.source === 'official-website' && isFreshRetrievedAt(entry.retrievedAt, now));

const lookupFromAdmission = (
  target: OfficialAdmissionTarget,
  authority: { canonicalPlaceId: string; name: string },
  admission: PlaceAdmission | undefined,
  fallbackNote: string,
): OfficialAdmissionLookup => {
  const hasFare = Boolean(admission?.class === 'free' || admission?.fares?.length);
  return {
    id: target.id,
    name: authority.name,
    canonicalPlaceId: authority.canonicalPlaceId,
    status: hasFare ? 'verified' : 'no-price',
    admission,
    sourceUrl: admission?.sourceUrl,
    retrievedAt: admission?.retrievedAt,
    note: hasFare
      ? 'Admission evidence was read from the operator source.'
      : fallbackNote,
  };
};

const cachedDocumentsForWrite = (
  documents: unknown[],
  canonicalPlaceId: string,
): CachedEvidence[] => documents.flatMap((value): CachedEvidence[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  const sourceUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl : '';
  const retrievedAt = typeof row.retrievedAt === 'string' ? row.retrievedAt : '';
  const claims = Array.isArray(row.claims) ? row.claims : [];
  if (!sourceUrl || !retrievedAt) return [];
  return [{
    canonicalPlaceId,
    source: 'official-website',
    sourceUrl,
    sourceItemId: typeof row.sourceItemId === 'string' ? row.sourceItemId : undefined,
    publishedAt: typeof row.publishedAt === 'string' ? row.publishedAt : undefined,
    retrievedAt,
    authorType: 'official',
    disclosure: 'organic',
    confidence: typeof row.confidence === 'number' ? row.confidence : 0.9,
    claims: claims.flatMap((claim): CachedEvidence['claims'] => {
      if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return [];
      const item = claim as Record<string, unknown>;
      return [{
        type: typeof item.type === 'string' ? item.type : 'price',
        summary: typeof item.summary === 'string' ? item.summary : '',
        value: typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : undefined,
        unit: typeof item.unit === 'string' ? item.unit : undefined,
        appliesTo: item.appliesTo && typeof item.appliesTo === 'object' && !Array.isArray(item.appliesTo)
          ? item.appliesTo as CachedEvidence['claims'][number]['appliesTo']
          : undefined,
        strength: typeof item.strength === 'number' && Number.isFinite(item.strength) ? item.strength : 1,
        excerpt: typeof item.excerpt === 'string' ? item.excerpt : undefined,
      }];
    }),
  }];
});

/**
 * Research up to six already-known places. A cache hit performs no fetch and
 * no model call. An unavailable source is returned as a fact, not converted
 * into a planning estimate.
 */
export async function researchOfficialAdmissions(
  client: SupabaseClient | null,
  targets: OfficialAdmissionTarget[],
): Promise<OfficialAdmissionLookup[]> {
  const bounded = targets.slice(0, 6);
  if (bounded.length === 0) return [];
  if (!client) {
    return bounded.map((target) => ({
      id: target.id,
      name: target.name,
      status: 'unavailable' as const,
      note: 'The official admission cache is not configured.',
    }));
  }

  const authorities = await readCanonicalOfficialSources(client, bounded.map((target) => ({
    provider: target.provider,
    providerPlaceId: target.providerPlaceId,
  })));
  const canonicalIds = [...new Set([...authorities.values()].map((authority) => authority.canonicalPlaceId))];
  const cachedByCanonical = await readEvidenceCache(client, canonicalIds);
  const freshProbes = await readEvidenceProbes(client, canonicalIds);
  const now = Date.now();
  const results: OfficialAdmissionLookup[] = [];

  for (const target of bounded) {
    const authority = authorityForTarget(authorities, target);
    if (!authority) {
      results.push({
        id: target.id,
        name: target.name,
        status: 'unavailable',
        note: 'No unambiguous canonical place record is available for this attraction.',
      });
      continue;
    }
    if (!authority.website || !isSafePublicUrl(authority.website)) {
      results.push({
        id: target.id,
        name: authority.name,
        canonicalPlaceId: authority.canonicalPlaceId,
        status: 'unavailable',
        note: 'No safe official website is stored for this attraction.',
      });
      continue;
    }
    if (isLikelyResellerUrl(authority.website)) {
      results.push({
        id: target.id,
        name: authority.name,
        canonicalPlaceId: authority.canonicalPlaceId,
        status: 'rejected-source',
        note: 'The stored website is a map, guide or reseller domain, not an operator source.',
      });
      continue;
    }

    const cachedEntries = cachedOfficialDocuments(cachedByCanonical.get(authority.canonicalPlaceId), now);
    if (cachedEntries.length > 0) {
      const first = cachedEntries[0];
      const admission = admissionFromOfficialClaims(
        cachedEntries.flatMap((entry) => entry.claims),
        first.sourceUrl,
        first.retrievedAt,
      );
      results.push(lookupFromAdmission(target, authority, admission, 'The current official page was checked but did not publish a machine-readable fare.'));
      continue;
    }
    if (freshProbes.has(probeKey(authority.canonicalPlaceId, OFFICIAL_ADMISSION_PROBE))) {
      results.push({
        id: target.id,
        name: authority.name,
        canonicalPlaceId: authority.canonicalPlaceId,
        status: 'no-price',
        note: 'The official source was checked within the freshness window but no verified fare was found.',
      });
      continue;
    }

    const evidence = await officialEvidence(authority.website, authority.canonicalPlaceId, authority.countryCode);
    const documents = cachedDocumentsForWrite(evidence.documents, authority.canonicalPlaceId);
    const expiresAt = new Date(Date.now() + OFFICIAL_ADMISSION_TTL_MS).toISOString();
    if (documents.length > 0) await writeEvidenceCache(client, documents, expiresAt);
    // A network failure is not evidence that the operator publishes no fare.
    // Do not suppress a retry for the entire freshness window in that case.
    if (evidence.fetched) {
      await writeEvidenceProbes(client, [{ canonicalPlaceId: authority.canonicalPlaceId, source: OFFICIAL_ADMISSION_PROBE }], expiresAt);
    }
    results.push(lookupFromAdmission(
      target,
      authority,
      evidence.admission,
      evidence.admission?.class === 'ticketed'
        ? 'The official source confirms admission is ticketed but did not publish a verified fare.'
        : 'The current official fare could not be verified from the operator source.',
    ));
  }
  return results;
}
