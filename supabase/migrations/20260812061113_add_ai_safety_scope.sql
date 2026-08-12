/**
 * Authenticated reasoning safety scope.
 *
 * This migration is additive because the two base AI migrations are already
 * part of repository history. Existing spend rows are treated as resolved
 * historical attempts; old candidate-cache rows without a trip are discarded
 * because they cannot be safely attributed to an owner.
 */

/* ------------------------------------------------------------------------- */
/* Upgrade the durable spend ledger.                                         */
/* ------------------------------------------------------------------------- */

alter table public.ai_spend_ledger
  add column if not exists finalized_at timestamptz,
  add column if not exists material_key text,
  add column if not exists reserved_cost_usd numeric(12, 8) not null default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_spend_ledger'
      and column_name = 'trip_id'
      and data_type = 'uuid'
  ) then
    alter table public.ai_spend_ledger
      alter column trip_id type text using trip_id::text;
  end if;
end;
$$;

alter table public.ai_spend_ledger
  add column if not exists attempt_status text;

/* Rows created by the original append-only ledger already represent finished attempts. */
update public.ai_spend_ledger
set attempt_status = 'resolved'
where attempt_status is null;

alter table public.ai_spend_ledger
  alter column attempt_status set default 'reserved',
  alter column attempt_status set not null;

alter table public.ai_spend_ledger
  drop constraint if exists ai_spend_ledger_request_status_check,
  drop constraint if exists ai_spend_ledger_attempt_status_check,
  drop constraint if exists ai_spend_ledger_reserved_cost_usd_check,
  drop constraint if exists ai_spend_ledger_user_id_fkey,
  drop constraint if exists ai_spend_ledger_trip_id_fkey;

alter table public.ai_spend_ledger
  alter column request_status drop not null,
  alter column user_id drop not null;

alter table public.ai_spend_ledger
  add constraint ai_spend_ledger_request_status_check
    check (request_status is null or request_status in (
      'success', 'provider_error', 'network_error', 'timeout', 'invalid_output', 'usage_missing'
    )),
  add constraint ai_spend_ledger_attempt_status_check
    check (attempt_status in ('reserved', 'resolved', 'unresolved')),
  add constraint ai_spend_ledger_reserved_cost_usd_check
    check (reserved_cost_usd >= 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_spend_ledger_user_id_fkey'
      and conrelid = 'public.ai_spend_ledger'::regclass
  ) then
    alter table public.ai_spend_ledger
      add constraint ai_spend_ledger_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete set null not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_spend_ledger_trip_id_fkey'
      and conrelid = 'public.ai_spend_ledger'::regclass
  ) then
    alter table public.ai_spend_ledger
      add constraint ai_spend_ledger_trip_id_fkey
      foreign key (trip_id) references public.trip_registry(id) on delete set null not valid;
  end if;
end;
$$;

create index if not exists ai_spend_ledger_open_idx
  on public.ai_spend_ledger (attempt_status, created_at desc)
  where attempt_status <> 'resolved';

create index if not exists ai_spend_ledger_scope_idx
  on public.ai_spend_ledger (user_id, trip_id, created_at desc);

alter table public.ai_spend_ledger enable row level security;
revoke all on public.ai_spend_ledger from anon, authenticated;
revoke insert, update, delete on public.ai_spend_ledger from service_role;
grant select on public.ai_spend_ledger to service_role;

/* ------------------------------------------------------------------------- */
/* Upgrade and scope the candidate cache.                                    */
/* ------------------------------------------------------------------------- */

alter table public.ai_candidate_intelligence
  add column if not exists trip_id text;

/* A pre-scope cache row has no safe owner. It is cache data, not user data. */
delete from public.ai_candidate_intelligence
where trip_id is null;

alter table public.ai_candidate_intelligence
  alter column trip_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_candidate_intelligence_trip_id_fkey'
      and conrelid = 'public.ai_candidate_intelligence'::regclass
  ) then
    alter table public.ai_candidate_intelligence
      add constraint ai_candidate_intelligence_trip_id_fkey
      foreign key (trip_id) references public.trip_registry(id) on delete cascade not valid;
  end if;
end;
$$;

create index if not exists ai_candidate_intelligence_trip_idx
  on public.ai_candidate_intelligence (trip_id, created_at desc);

create index if not exists ai_candidate_intelligence_profile_idx
  on public.ai_candidate_intelligence (trip_id, profile_revision);

alter table public.ai_candidate_intelligence enable row level security;
revoke all on public.ai_candidate_intelligence from anon, authenticated;
grant select, insert, update, delete on public.ai_candidate_intelligence to service_role;

/* ------------------------------------------------------------------------- */
/* Per-user/per-trip daily usage and exact live-batch claims.                 */
/* ------------------------------------------------------------------------- */

create table if not exists public.ai_reasoning_usage (
  dimension text not null check (dimension in ('user', 'trip')),
  dimension_key text not null,
  usage_date date not null,
  calls integer not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (dimension, dimension_key, usage_date)
);

create index if not exists ai_reasoning_usage_date_idx
  on public.ai_reasoning_usage (usage_date, dimension);

alter table public.ai_reasoning_usage enable row level security;
revoke all on public.ai_reasoning_usage from anon, authenticated;
grant select, insert, update, delete on public.ai_reasoning_usage to service_role;

create table if not exists public.ai_candidate_intelligence_claims (
  claim_key text primary key,
  user_id uuid not null references auth.users on delete cascade,
  trip_id text not null references public.trip_registry(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists ai_candidate_intelligence_claims_expiry_idx
  on public.ai_candidate_intelligence_claims (expires_at);

alter table public.ai_candidate_intelligence_claims enable row level security;
revoke all on public.ai_candidate_intelligence_claims from anon, authenticated;
grant select, insert, update, delete on public.ai_candidate_intelligence_claims to service_role;

/* ------------------------------------------------------------------------- */
/* Atomic pre-provider accounting reservation.                               */
/* ------------------------------------------------------------------------- */

create or replace function public.reserve_ai_reasoning_attempt(
  p_user_id uuid,
  p_trip_id text,
  p_provider text,
  p_model text,
  p_operation text,
  p_material_key text,
  p_reserved_cost_usd numeric,
  p_budget_usd numeric,
  p_budget_since timestamptz,
  p_global_limit integer,
  p_user_limit integer,
  p_trip_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_global_calls integer;
  v_user_calls integer;
  v_trip_calls integer := 0;
  v_spend numeric;
  v_attempt_id bigint;
begin
  if p_user_id is null
    or coalesce(nullif(trim(p_provider), ''), '') = ''
    or coalesce(nullif(trim(p_model), ''), '') = ''
    or coalesce(nullif(trim(p_operation), ''), '') = ''
    or p_reserved_cost_usd is null or p_reserved_cost_usd <= 0
    or p_budget_usd is null or p_budget_usd <= 0
    or p_global_limit is null or p_global_limit <= 0
    or p_user_limit is null or p_user_limit <= 0
    or (p_trip_id is not null and (p_trip_limit is null or p_trip_limit <= 0)) then
    return jsonb_build_object('allowed', false, 'reason', 'accounting-failed');
  end if;

  /* Serialize budget reservations across all callers before taking row locks. */
  perform pg_advisory_xact_lock(4815162342);

  /* Shared with the older evidence path so all paid reasoning uses one global cap. */
  insert into public.provider_usage (provider, usage_date, calls, units)
  values ('ai-reasoning', v_today, 0, 0)
  on conflict (provider, usage_date) do nothing;

  select calls into v_global_calls
  from public.provider_usage
  where provider = 'ai-reasoning' and usage_date = v_today
  for update;

  insert into public.ai_reasoning_usage (dimension, dimension_key, usage_date, calls)
  values ('user', p_user_id::text, v_today, 0)
  on conflict (dimension, dimension_key, usage_date) do nothing;

  select calls into v_user_calls
  from public.ai_reasoning_usage
  where dimension = 'user' and dimension_key = p_user_id::text and usage_date = v_today
  for update;

  if p_trip_id is not null then
    insert into public.ai_reasoning_usage (dimension, dimension_key, usage_date, calls)
    values ('trip', p_trip_id, v_today, 0)
    on conflict (dimension, dimension_key, usage_date) do nothing;

    select calls into v_trip_calls
    from public.ai_reasoning_usage
    where dimension = 'trip' and dimension_key = p_trip_id and usage_date = v_today
    for update;
  end if;

  if v_global_calls + 1 > p_global_limit
    or v_user_calls + 1 > p_user_limit
    or (p_trip_id is not null and v_trip_calls + 1 > p_trip_limit) then
    return jsonb_build_object('allowed', false, 'reason', 'quota-exhausted');
  end if;

  select coalesce(sum(
    case
      when attempt_status = 'resolved' and cost_status = 'known'
        then coalesce(estimated_cost_usd, 0)
      when attempt_status in ('reserved', 'unresolved')
        then reserved_cost_usd
      else 0
    end
  ), 0)
  into v_spend
  from public.ai_spend_ledger
  where p_budget_since is null or created_at >= p_budget_since;

  if v_spend + p_reserved_cost_usd > p_budget_usd then
    return jsonb_build_object('allowed', false, 'reason', 'budget-reached');
  end if;

  insert into public.ai_spend_ledger (
    provider, model_requested, operation, material_key,
    reserved_cost_usd, cost_status, attempt_status, user_id, trip_id
  ) values (
    p_provider, p_model, p_operation, p_material_key,
    p_reserved_cost_usd, 'unknown', 'reserved', p_user_id, p_trip_id
  ) returning id into v_attempt_id;

  update public.provider_usage
  set calls = calls + 1, units = units + 1, updated_at = now()
  where provider = 'ai-reasoning' and usage_date = v_today;

  update public.ai_reasoning_usage
  set calls = calls + 1, updated_at = now()
  where dimension = 'user' and dimension_key = p_user_id::text and usage_date = v_today;

  if p_trip_id is not null then
    update public.ai_reasoning_usage
    set calls = calls + 1, updated_at = now()
    where dimension = 'trip' and dimension_key = p_trip_id and usage_date = v_today;
  end if;

  return jsonb_build_object('allowed', true, 'attempt_id', v_attempt_id);
end;
$$;

/* Finalise only the reserved row for this attempt; unknown cost stays unresolved. */
create or replace function public.finalize_ai_spend_attempt(
  p_attempt_id bigint,
  p_provider_request_id text,
  p_model_resolved text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_reasoning_tokens integer,
  p_total_tokens integer,
  p_estimated_cost_usd numeric,
  p_cost_status text,
  p_request_status text,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case when p_cost_status = 'known' and p_estimated_cost_usd is not null then 'resolved' else 'unresolved' end;
begin
  if p_attempt_id is null
    or p_cost_status is null
    or p_cost_status not in ('known', 'unknown')
    or p_request_status is null
    or p_request_status not in ('success', 'provider_error', 'network_error', 'timeout', 'invalid_output', 'usage_missing')
    or (p_estimated_cost_usd is not null and p_estimated_cost_usd < 0)
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_cached_input_tokens is not null and p_cached_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0)
    or (p_reasoning_tokens is not null and p_reasoning_tokens < 0)
    or (p_total_tokens is not null and p_total_tokens < 0) then
    return false;
  end if;

  update public.ai_spend_ledger
  set provider_request_id = p_provider_request_id,
      model_resolved = p_model_resolved,
      input_tokens = p_input_tokens,
      cached_input_tokens = p_cached_input_tokens,
      output_tokens = p_output_tokens,
      reasoning_tokens = p_reasoning_tokens,
      total_tokens = p_total_tokens,
      estimated_cost_usd = case when v_status = 'resolved' then p_estimated_cost_usd else null end,
      cost_status = case when v_status = 'resolved' then 'known' else 'unknown' end,
      request_status = p_request_status,
      error_code = p_error_code,
      attempt_status = v_status,
      finalized_at = now()
  where id = p_attempt_id and attempt_status = 'reserved';

  return found;
end;
$$;

/* ------------------------------------------------------------------------- */
/* Exact live-batch claims.                                                  */
/* ------------------------------------------------------------------------- */

create or replace function public.claim_candidate_intelligence(
  p_claim_key text,
  p_user_id uuid,
  p_trip_id text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(nullif(trim(p_claim_key), ''), '') = ''
    or p_user_id is null
    or coalesce(nullif(trim(p_trip_id), ''), '') = ''
    or p_expires_at is null then
    return false;
  end if;

  delete from public.ai_candidate_intelligence_claims
  where expires_at <= now();

  insert into public.ai_candidate_intelligence_claims (claim_key, user_id, trip_id, expires_at)
  values (p_claim_key, p_user_id, p_trip_id, p_expires_at)
  on conflict (claim_key) do nothing;
  return found;
end;
$$;

create or replace function public.release_candidate_intelligence(p_claim_key text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_candidate_intelligence_claims where claim_key = p_claim_key;
  return found;
end;
$$;

revoke all on function public.reserve_ai_reasoning_attempt(uuid, text, text, text, text, text, numeric, numeric, timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_ai_spend_attempt(bigint, text, text, integer, integer, integer, integer, integer, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_candidate_intelligence(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_candidate_intelligence(text) from public, anon, authenticated;

grant execute on function public.reserve_ai_reasoning_attempt(uuid, text, text, text, text, text, numeric, numeric, timestamptz, integer, integer, integer) to service_role;
grant execute on function public.finalize_ai_spend_attempt(bigint, text, text, integer, integer, integer, integer, integer, numeric, text, text, text) to service_role;
grant execute on function public.claim_candidate_intelligence(text, uuid, text, timestamptz) to service_role;
grant execute on function public.release_candidate_intelligence(text) to service_role;
