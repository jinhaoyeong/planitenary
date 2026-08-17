import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const handler = readFileSync(
  new URL('../../supabase/functions/planitenary-agent/index.ts', import.meta.url),
  'utf8',
);
const cache = readFileSync(
  new URL('../../supabase/functions/_shared/cache.ts', import.meta.url),
  'utf8',
);
const cacheGate = readFileSync(
  new URL('../../supabase/functions/_shared/itineraryProposalCache.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../supabase/migrations/20260816081502_add_itinerary_proposal_cache.sql', import.meta.url),
  'utf8',
);
const routeFunction = readFileSync(
  new URL('../../supabase/functions/travel-route-matrix/index.ts', import.meta.url),
  'utf8',
);
const providers = readFileSync(
  new URL('../../supabase/functions/_shared/providers.ts', import.meta.url),
  'utf8',
);

const sourceFiles = (url: URL): URL[] => readdirSync(url, { withFileTypes: true }).flatMap((entry) => {
  const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, url);
  if (entry.isDirectory()) return sourceFiles(child);
  return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [child] : [];
});

describe('Phase 2A server boundary', () => {
  it('meters build-itinerary through the one existing provider door', () => {
    expect(handler).toContain("if (operation === 'build-itinerary')");
    expect(handler).toContain('const outcome = await callOneRound({');
    expect(handler).toContain('reserveAiReasoningAttempt(cache');
    expect(handler).toContain('finalizeAiSpendAttempt(cache');
    expect(handler.match(/\bcallModel\(/g)).toHaveLength(1);
  });

  it('contains no itinerary persistence path or save tool', () => {
    expect(handler).not.toMatch(/\.from\(['"]itineraries['"]\)/);
    expect(handler).not.toContain('save_itinerary');
    expect(handler).not.toContain('update_activity');
    expect(handler).toContain('applied: false');
  });

  it('reuses a proposal only for the exact trip and material revision', () => {
    expect(cache).toContain(".eq('trip_id', tripId)");
    expect(cache).toContain(".eq('material_revision', materialRevision)");
    expect(cache).toContain("onConflict: 'trip_id,material_revision'");
    expect(cacheGate).toContain('value.tripId === tripId');
    expect(cacheGate).toContain('value.materialRevision === materialRevision');
    expect(cacheGate).toContain('value.applied === false');
  });

  it('looks up an exact cached proposal after ownership and before any model gate', () => {
    const authenticated = handler.indexOf('authenticateRequest(request)');
    const owned = handler.indexOf('readOwnedTrip(cache, tripId, authentication.caller.userId)');
    const cacheLookup = handler.indexOf('lookupExactItineraryProposalCache({');
    const cacheRead = handler.indexOf('readItineraryProposalCache(cache, ownedTripId, materialRevision)');
    const modelGate = handler.indexOf('resolveAgentReasoning(operation)');
    const reserve = handler.indexOf('reserveAiReasoningAttempt(cache');
    const provider = handler.indexOf('const outcome = await callOneRound({');

    expect(authenticated).toBeGreaterThan(-1);
    expect(owned).toBeGreaterThan(authenticated);
    expect(cacheLookup).toBeGreaterThan(owned);
    expect(cacheRead).toBeGreaterThan(cacheLookup);
    expect(modelGate).toBeGreaterThan(cacheLookup);
    expect(reserve).toBeGreaterThan(modelGate);
    expect(provider).toBeGreaterThan(reserve);
    expect(handler).toContain('cachedItineraryProposalEnvelope(lookup.proposal, limits)');
    expect(handler).toContain('generationDisabledRefusal(trip.tripId)');
  });

  it('adds a server-only, RLS-protected preview cache without destructive SQL', () => {
    expect(migration).toContain('create table if not exists public.itinerary_proposal_cache');
    expect(migration).toContain('alter table public.itinerary_proposal_cache enable row level security');
    expect(migration).toContain('revoke all on table public.itinerary_proposal_cache from public, anon, authenticated');
    expect(migration).toContain('references public.trip_registry(id) on delete cascade');
    expect(migration).not.toMatch(/\bdrop\s+(?:table|column)\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });

  it('uses the current HeiGIT ORS endpoint and keeps its credential server-only', () => {
    expect(routeFunction).toContain('https://api.heigit.org/openrouteservice/v2/matrix/');
    expect(routeFunction).not.toContain('api.openrouteservice.org');
    expect(providers).toContain("env('OPENROUTESERVICE_API_KEY')");

    const publicSources = sourceFiles(new URL('../', import.meta.url));
    for (const file of publicSources) {
      expect(readFileSync(file, 'utf8'), file.pathname).not.toContain('OPENROUTESERVICE_API_KEY');
    }
  });

  it('does not use matching array indexes as route identity', () => {
    expect(routeFunction).not.toContain('if (originIndex === destinationIndex)');
    expect(routeFunction).toContain('sameRoutingPoint(origins[originIndex], destinations[destinationIndex])');
  });
});
