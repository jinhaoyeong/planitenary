import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const handler = readFileSync(
  new URL('../../supabase/functions/planitenary-agent/index.ts', import.meta.url),
  'utf8',
);
const cache = readFileSync(
  new URL('../../supabase/functions/_shared/cache.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../supabase/migrations/20260816081502_add_itinerary_proposal_cache.sql', import.meta.url),
  'utf8',
);

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
    expect(cache).toContain("proposal.applied === false");
    expect(cache).toContain("onConflict: 'trip_id,material_revision'");
  });

  it('adds a server-only, RLS-protected preview cache without destructive SQL', () => {
    expect(migration).toContain('create table if not exists public.itinerary_proposal_cache');
    expect(migration).toContain('alter table public.itinerary_proposal_cache enable row level security');
    expect(migration).toContain('revoke all on table public.itinerary_proposal_cache from public, anon, authenticated');
    expect(migration).toContain('references public.trip_registry(id) on delete cascade');
    expect(migration).not.toMatch(/\bdrop\s+(?:table|column)\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });
});
