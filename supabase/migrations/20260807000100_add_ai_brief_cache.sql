-- Cache for the one provider that sends a bill.
--
-- The daily cap in `provider_usage` stops runaway spend, but it does not stop
-- waste: without this table a place the model had nothing to say about is
-- asked about again tomorrow, and the day after, forever. The cap would make
-- that cheap rather than free, which is not the same thing.
--
-- So the null answer is stored too. `brief is null` here does not mean "not
-- cached" — it means "we asked, and nothing survived validation". Those are
-- different facts and the schema has to keep them apart, which is why a row's
-- existence is the cache hit and the payload is allowed to be null. This is
-- the same distinction `usageToday` draws between a missing row and an
-- unreachable counter.
--
-- A dedicated table rather than a new `evidence_probes.source` value: a
-- generated description is not a source of evidence, and the probe log is
-- keyed by the sources we retrieved. Reusing it would have meant widening an
-- evidence-source union for something that is not evidence.

create table if not exists public.ai_place_briefs (
  canonical_place_id text not null,
  /** Which model operation produced this: 'place-brief', 'admission-read'. */
  operation text not null,
  /**
   * Fingerprint of the grounding material this answer was derived from.
   *
   * Part of the key, so a place whose evidence has changed is re-asked while
   * one whose evidence is unchanged is not. Without it the cache would either
   * pin a stale description forever or expire on time alone, and neither
   * tracks the thing that actually makes a brief wrong.
   */
  evidence_revision text not null,
  /** Validated sentences, or null meaning "asked, nothing survived". */
  brief jsonb,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (canonical_place_id, operation, evidence_revision)
);

create index if not exists ai_place_briefs_expiry_idx
  on public.ai_place_briefs (expires_at);

alter table public.ai_place_briefs enable row level security;

-- Operational data written by Edge Functions only. No read policy is defined,
-- so no anonymous client can enumerate it; the function reads it as the
-- service role, exactly like the evidence cache beside it.

grant select, insert, update, delete on public.ai_place_briefs to service_role;
