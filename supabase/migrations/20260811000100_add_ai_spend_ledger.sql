/**
 * What the model tier has actually spent.
 *
 * Every other guard on this tier bounds a call *before* it happens: which
 * model may run, how much input may be sent, how many output tokens may come
 * back, how many requests a day. None of them knows what any of it cost. This
 * table is the other half — the record that makes a spending ceiling
 * enforceable rather than aspirational.
 *
 * The distinction it exists to preserve is between **a call that cost nothing**
 * and **a call whose cost we could not determine**. Those are different facts,
 * and collapsing them is how a budget drains while the accounting insists
 * nothing happened — which is the shape of the original billing incident, one
 * layer up. Hence every token column is nullable and `cost_status` is
 * explicit: a failed or unpriced call stores nulls, never zeros.
 */

create table if not exists public.ai_spend_ledger (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  provider text not null,
  /**
   * The provider's own request id, where it returns one. Nullable because not
   * every response carries it, and it is the only handle for reconciling this
   * ledger against the provider's invoice when the two disagree.
   */
  provider_request_id text,
  /** What we asked for. */
  model_requested text not null,
  /**
   * What actually answered, where the provider says so. An alias can resolve
   * to a dated snapshot, and cost follows what ran rather than what was asked
   * for — so both are kept, because a silent divergence between them is worth
   * being able to see after the fact.
   */
  model_resolved text,
  operation text not null,

  /**
   * Token counts, every one nullable.
   *
   * A failure records nulls rather than zeros. Zeros would average into "our
   * calls are getting cheaper" when what actually happened is that they
   * stopped working, and that reading is worse than having no data at all.
   */
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  total_tokens integer,

  /**
   * Estimated cost, and whether it is an estimate at all.
   *
   * `numeric`, not a float: this column is summed to decide whether to keep
   * spending, and binary floating point accumulates error across thousands of
   * very small values in exactly the direction nobody notices.
   */
  estimated_cost_usd numeric(12, 8),
  cost_status text not null check (cost_status in ('known', 'unknown')),

  request_status text not null
    check (request_status in ('success', 'provider_error', 'timeout', 'invalid_output')),

  /**
   * Attribution, reserved and deliberately unpopulated.
   *
   * The deployment-wide ceiling does not need to know who spent the money, and
   * threading identity through would pull the authentication work into a task
   * that is about billing safety. The columns exist now so that adding
   * attribution later is a write-site change rather than a migration against a
   * table that already holds live spending history.
   */
  trip_id uuid,
  user_id uuid,

  error_code text
);

/**
 * The ledger is read by summing a time window, which is the only query it
 * serves and the one on the path of every metered call.
 */
create index if not exists ai_spend_ledger_created_idx
  on public.ai_spend_ledger (created_at desc);

/** Per-operation reporting, for the diagnostics summary. */
create index if not exists ai_spend_ledger_operation_idx
  on public.ai_spend_ledger (operation, created_at desc);

alter table public.ai_spend_ledger enable row level security;

/**
 * Server-only, and more strictly than the caches beside it.
 *
 * No policy is defined for `anon` or `authenticated`, so with RLS enabled
 * neither can read or write a row. That matters more here than for a cache: a
 * client able to insert rows could exhaust the spending ceiling and switch the
 * model tier off for everyone, and a client able to *delete* them could hide
 * spending from the guard that is supposed to stop it. The accounting a budget
 * depends on must not be writable by the thing being budgeted.
 */
grant select, insert on public.ai_spend_ledger to service_role;

/**
 * Deliberately no update or delete grant, even for the service role.
 *
 * A ledger is append-only by nature; nothing in the application has a reason
 * to revise a spending record after the fact, and the absence of the grant
 * means a bug cannot quietly do it either. Pruning old rows is an operator
 * action, taken deliberately, not something a function can reach.
 */
