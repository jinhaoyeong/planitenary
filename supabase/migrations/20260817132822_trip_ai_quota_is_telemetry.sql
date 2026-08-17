/**
 * Trip AI usage remains recorded. It is no longer a refusal boundary.
 *
 * A day of candidate-intelligence, Plan my trip, and Ask Planitenary on one
 * itinerary was exhausting a 4-call trip cap while global and user allowance
 * remained. The counters that may still refuse a metered attempt are global
 * daily quota, user daily quota, and the dollar budget. `p_trip_limit` is
 * kept on the signature so existing callers do not break; the value is not
 * read.
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
    or p_user_limit is null or p_user_limit <= 0 then
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

    perform 1
    from public.ai_reasoning_usage
    where dimension = 'trip' and dimension_key = p_trip_id and usage_date = v_today
    for update;
  end if;

  if v_global_calls + 1 > p_global_limit
    or v_user_calls + 1 > p_user_limit then
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
