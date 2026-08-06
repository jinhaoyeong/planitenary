-- Application-side quota accounting.
--
-- Some provider quotas are small enough that hitting them breaks the product
-- for the rest of the day rather than merely costing money. YouTube's Data API
-- allows 100 `search.list` calls per day; at one search per place, that is 100
-- places. Running out at lunchtime means every discovery for the rest of the
-- day silently loses its video evidence.
--
-- So usage is counted here and capped below the provider's own limit, leaving a
-- margin. A counter in function memory would not work: Edge Functions run as
-- many short-lived instances, so the count has to be shared.

create table if not exists public.provider_usage (
  provider text not null,
  -- The provider's own reset day, not ours. See `consume_provider_quota`.
  usage_date date not null,
  /** Billable calls made. This is what the cap is enforced against. */
  calls integer not null default 0,
  /** Quota units consumed, where a provider prices calls differently. */
  units integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, usage_date)
);

create index if not exists provider_usage_date_idx on public.provider_usage (usage_date);

alter table public.provider_usage enable row level security;

-- Usage is operational data, not reference data a traveller needs. No read
-- policy is defined, so only the service role sees it.

/**
 * Reserve quota for one provider call, atomically.
 *
 * Returns true when the call is within budget and the usage has been recorded,
 * false when it would exceed the cap and nothing has been recorded.
 *
 * The check and the increment happen in one statement so two concurrent
 * requests cannot both read "99 used" and both proceed. `ON CONFLICT DO UPDATE`
 * takes a row lock, which serialises callers on the counter for that day.
 *
 * `p_reset_timezone` matters: YouTube's quota resets at midnight Pacific, not
 * UTC. Counting on the wrong day would either lock the app out early or reset
 * it up to eight hours before the provider does.
 */
create or replace function public.consume_provider_quota(
  p_provider text,
  p_calls integer,
  p_units integer,
  p_call_limit integer,
  p_reset_timezone text default 'UTC'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone p_reset_timezone)::date;
  allowed integer;
begin
  -- The first call of the day inserts rather than conflicts, so it never meets
  -- the ON CONFLICT guard below. Checking the reservation against the cap up
  -- front is what stops an oversized request slipping through on a fresh row.
  if p_calls <= 0 or p_call_limit <= 0 or p_calls > p_call_limit then
    return false;
  end if;

  insert into provider_usage as usage (provider, usage_date, calls, units)
  values (p_provider, today, p_calls, p_units)
  on conflict (provider, usage_date) do update
    set calls = usage.calls + excluded.calls,
        units = usage.units + excluded.units,
        updated_at = now()
    where usage.calls + excluded.calls <= p_call_limit
  returning usage.calls into allowed;

  -- Nothing returned means the guard rejected the update: today is spent.
  return allowed is not null;
end;
$$;

revoke all on function public.consume_provider_quota(text, integer, integer, integer, text) from public;

grant select, insert, update, delete on public.provider_usage to service_role;
grant execute on function public.consume_provider_quota(text, integer, integer, integer, text) to service_role;
