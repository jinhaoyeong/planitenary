/**
 * Personalised card intelligence, cached per candidate.
 *
 * Per candidate, not per batch, even though ten candidates may have shared one
 * provider request. Batching is a transport optimisation and must not become a
 * correctness decision: filing the whole batch under one key would mean one
 * candidate's data changing invalidates nine unrelated neighbours, and they
 * would all be paid for again to produce answers that were still correct.
 *
 * The key is every material input — candidate revision, profile revision,
 * planner context, schema version, model. Correctness here is governed by those
 * facts and not by the clock: this answer stops being right when the traveller
 * changes their profile, not when a week passes. Expiry is therefore garbage
 * collection rather than freshness.
 */

create table if not exists public.ai_candidate_intelligence (
  /**
   * The composite material key, assembled by `intelligenceCacheKey`.
   *
   * One text column rather than a wide composite primary key because the parts
   * are opaque to Postgres and will grow: adding a new material input should be
   * a change to one pure function with tests, not a migration against a live
   * table.
   */
  cache_key text primary key,

  /** Kept as columns too, for diagnostics and for targeted invalidation. */
  candidate_id text not null,
  candidate_revision text not null,
  profile_revision text not null,
  planner_context_revision text,
  schema_version text not null,
  model text not null,

  /**
   * Validated atoms, or null.
   *
   * **Null is a real answer and is stored deliberately**: it records that the
   * model was asked about exactly these facts and produced nothing that
   * survived validation. Without it, a place the model had nothing useful to
   * say about is paid for again tomorrow, and the day after, forever.
   *
   * What must NEVER be written here is the other kind of emptiness — the model
   * not running at all, because the budget ceiling was reached or the provider
   * timed out. Those are indistinguishable on the screen and completely
   * different in meaning, and confusing them would let one bad afternoon
   * permanently mark a card as having no personalisation. `IntelligenceOutcome`
   * carries that distinction in its type so this table can only ever receive
   * the first kind.
   */
  intelligence jsonb,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists ai_candidate_intelligence_expiry_idx
  on public.ai_candidate_intelligence (expires_at);

/** Targeted invalidation when a profile changes materially. */
create index if not exists ai_candidate_intelligence_profile_idx
  on public.ai_candidate_intelligence (profile_revision);

alter table public.ai_candidate_intelligence enable row level security;

-- Operational data written by Edge Functions only. No policy is defined for
-- anon or authenticated, so no browser client can read or write it; the
-- function reaches it as the service role, exactly like the caches beside it.

grant select, insert, update, delete on public.ai_candidate_intelligence to service_role;
