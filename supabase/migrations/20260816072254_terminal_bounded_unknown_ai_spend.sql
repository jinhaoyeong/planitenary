/**
 * Terminal bounded-unknown AI accounting.
 *
 * A provider attempt whose dispatch may have happened but whose trustworthy
 * usage is unavailable is terminal (`attempt_status = 'resolved'`) while its
 * actual cost remains explicitly unknown (`cost_status = 'unknown'`, no
 * estimate). Budget checks retain the full reservation as conservative
 * exposure. This is additive data semantics: no ledger row is deleted and no
 * unknown cost is relabelled as known.
 */

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

  perform pg_advisory_xact_lock(4815162342);

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
      when attempt_status = 'resolved' and cost_status = 'known' and estimated_cost_usd is not null
        then estimated_cost_usd
      else reserved_cost_usd
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

/**
 * Atomically terminalise a reserved attempt, or one legacy unresolved attempt.
 *
 * `resolved + unknown` means terminal bounded-unknown, not known actual cost.
 * Its estimate stays null and the reservation remains the budget exposure.
 * The status predicate makes provider/finalizer races idempotent: exactly one
 * caller can transition the row and no caller releases or charges it twice.
 */
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
begin
  if p_attempt_id is null
    or p_cost_status is null
    or p_cost_status not in ('known', 'unknown')
    or p_request_status is null
    or p_request_status not in ('success', 'provider_error', 'network_error', 'timeout', 'invalid_output', 'usage_missing')
    or (p_cost_status = 'known' and p_estimated_cost_usd is null)
    or (p_cost_status = 'unknown' and p_estimated_cost_usd is not null)
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
      estimated_cost_usd = p_estimated_cost_usd,
      cost_status = p_cost_status,
      request_status = p_request_status,
      error_code = p_error_code,
      attempt_status = 'resolved',
      finalized_at = now()
  where id = p_attempt_id and attempt_status in ('reserved', 'unresolved');

  return found;
end;
$$;

revoke all on function public.reserve_ai_reasoning_attempt(uuid, text, text, text, text, text, numeric, numeric, timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_ai_spend_attempt(bigint, text, text, integer, integer, integer, integer, integer, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_reasoning_attempt(uuid, text, text, text, text, text, numeric, numeric, timestamptz, integer, integer, integer) to service_role;
grant execute on function public.finalize_ai_spend_attempt(bigint, text, text, integer, integer, integer, integer, integer, numeric, text, text, text) to service_role;
