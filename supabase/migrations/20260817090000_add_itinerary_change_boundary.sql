-- Phase 2B: the itinerary write boundary.
--
-- `itinerary_proposal_cache` stays what it has always been — a cache of Phase 2A
-- previews, keyed by planning material. A cache row is not permission to modify
-- anything, and nothing here reads one as though it were.
--
-- These two tables are the authorisation and the record:
--
--   itinerary_change_proposals  one immutable, base-bound result awaiting an
--                               explicit confirmation
--   itinerary_change_history    what was actually written, with the snapshot
--                               needed to take it back
--
-- Neither is reachable from a browser role. Every state transition happens
-- inside a locking SECURITY DEFINER function so that a confirm, a concurrent
-- autosave, and a duplicate retry cannot interleave into a half-applied trip.

-- ---------------------------------------------------------------------------
-- Canonical state hash
-- ---------------------------------------------------------------------------

-- `jsonb` has one normalised text form per value — keys ordered, whitespace
-- fixed — so a digest of it describes the value rather than how it was written.
-- Computing this in SQL is deliberate: the base-revision check has to compare
-- against what the locked row actually holds, not against something a caller
-- computed a moment earlier from a copy.
create or replace function public.itinerary_state_hash(p_data jsonb)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select encode(sha256(convert_to(coalesce(p_data, 'null'::jsonb)::text, 'UTF8')), 'hex');
$$;

revoke all on function public.itinerary_state_hash(jsonb) from public, anon, authenticated;
grant execute on function public.itinerary_state_hash(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Staged write authorisations
-- ---------------------------------------------------------------------------

create table if not exists public.itinerary_change_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  trip_id text not null references public.trip_registry(id) on delete cascade,

  -- What the plan was made from, and what it was made against.
  -- `source_proposal_id` records the exact Phase 2A proposal the traveller
  -- reviewed. It is written for the audit trail; the authority for the write is
  -- `proposed_itinerary` below, which was already derived from that proposal.
  source_proposal_id text not null,
  material_revision text not null,
  base_itinerary_hash text not null,
  base_itinerary_updated_at timestamptz,

  -- The proposal as reviewed, and the exact itinerary applying it produces.
  -- `proposed_itinerary` is the only thing an apply ever writes; it is fixed
  -- here, before anyone confirms, and never recomputed from client input.
  proposal jsonb not null
    check (proposal->>'kind' = 'itinerary-proposal-v1')
    check (coalesce((proposal->>'applied')::boolean, false) = false),
  proposed_itinerary jsonb not null,
  proposed_itinerary_hash text not null,

  -- The deterministic review material shown before confirmation.
  diff jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  -- False whenever a deterministic conflict blocks the write. Stored rather
  -- than re-derived so the apply path cannot disagree with the preview.
  applicable boolean not null,

  status text not null default 'pending'
    check (status in ('pending', 'applied', 'stale', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  applied_at timestamptz,
  resulting_change_id uuid,

  check (applied_at is null or status = 'applied'),
  check (resulting_change_id is null or status = 'applied')
);

create index if not exists itinerary_change_proposals_trip_idx
  on public.itinerary_change_proposals (trip_id, status, created_at desc);
create index if not exists itinerary_change_proposals_expiry_idx
  on public.itinerary_change_proposals (expires_at) where status = 'pending';

alter table public.itinerary_change_proposals enable row level security;
revoke all on table public.itinerary_change_proposals from public, anon, authenticated;
grant select, insert, update on table public.itinerary_change_proposals to service_role;

-- ---------------------------------------------------------------------------
-- Applied change history
-- ---------------------------------------------------------------------------

create table if not exists public.itinerary_change_history (
  id uuid primary key default gen_random_uuid(),
  -- One history row per proposal, enforced rather than assumed: this is what
  -- makes a retried confirmation impossible to record twice.
  proposal_id uuid not null unique references public.itinerary_change_proposals(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  trip_id text not null references public.trip_registry(id) on delete cascade,

  before_hash text not null,
  after_hash text not null,
  -- The snapshot Undo restores. Bounded by the same limits as any itinerary.
  before_itinerary jsonb not null,
  after_itinerary jsonb not null,

  status text not null default 'applied' check (status in ('applied', 'undone')),
  applied_at timestamptz not null default now(),
  undone_at timestamptz,

  check (undone_at is null or status = 'undone')
);

create index if not exists itinerary_change_history_trip_idx
  on public.itinerary_change_history (trip_id, applied_at desc);

alter table public.itinerary_change_history enable row level security;
revoke all on table public.itinerary_change_history from public, anon, authenticated;
grant select, insert, update on table public.itinerary_change_history to service_role;

alter table public.itinerary_change_proposals
  drop constraint if exists itinerary_change_proposals_resulting_change_fk;
alter table public.itinerary_change_proposals
  add constraint itinerary_change_proposals_resulting_change_fk
  foreign key (resulting_change_id) references public.itinerary_change_history(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Read the base a proposal will be bound to
-- ---------------------------------------------------------------------------

create or replace function public.itinerary_change_base(p_trip_id text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_data jsonb;
  v_updated_at timestamptz;
begin
  -- Queried by trip *and* verified user together, so this cannot become an
  -- existence oracle for somebody else's trip.
  if not exists (
    select 1 from public.trip_registry
    where id = p_trip_id and user_id = p_user_id and status = 'active'
  ) then
    return null;
  end if;

  select i.data, i.updated_at into v_data, v_updated_at
  from public.itineraries i
  where i.id = p_trip_id and i.user_id = p_user_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'itinerary', v_data,
    'baseHash', public.itinerary_state_hash(v_data),
    'baseUpdatedAt', v_updated_at
  );
end;
$$;

revoke all on function public.itinerary_change_base(text, uuid) from public, anon, authenticated;
grant execute on function public.itinerary_change_base(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Stage an immutable, base-bound authorisation
-- ---------------------------------------------------------------------------

create or replace function public.stage_itinerary_change(
  p_trip_id text,
  p_user_id uuid,
  p_source_proposal_id text,
  p_material_revision text,
  p_base_hash text,
  p_proposal jsonb,
  p_proposed_itinerary jsonb,
  p_diff jsonb,
  p_blocking jsonb,
  p_warnings jsonb,
  p_applicable boolean,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_current jsonb;
  v_current_hash text;
  v_updated_at timestamptz;
  v_id uuid;
begin
  -- Read, deliberately without a row lock. Staging writes no itinerary, and
  -- taking one here would invert the lock order that `apply_itinerary_change`
  -- uses (authorisation first, then itinerary), which is how two concurrent
  -- callers would deadlock. The check below narrows the window; the one inside
  -- Apply, under the lock, is the authoritative one.
  select i.data, i.updated_at into v_current, v_updated_at
  from public.itineraries i
  join public.trip_registry r on r.id = i.id and r.user_id = i.user_id
  where i.id = p_trip_id and i.user_id = p_user_id and r.status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'refusal', 'proposal-invalid');
  end if;

  -- Narrow the gap between reading the base and binding to it: if the trip
  -- already moved while the result was being computed, nothing is staged.
  v_current_hash := public.itinerary_state_hash(v_current);
  if v_current_hash is distinct from p_base_hash then
    return jsonb_build_object('ok', false, 'refusal', 'proposal-stale');
  end if;

  -- A newly staged authorisation supersedes any earlier one for this trip.
  update public.itinerary_change_proposals
     set status = 'cancelled'
   where trip_id = p_trip_id and user_id = p_user_id and status = 'pending';

  insert into public.itinerary_change_proposals (
    user_id, trip_id, source_proposal_id, material_revision, base_itinerary_hash, base_itinerary_updated_at,
    proposal, proposed_itinerary, proposed_itinerary_hash,
    diff, blocking_reasons, warnings, applicable, expires_at
  ) values (
    p_user_id, p_trip_id, p_source_proposal_id, p_material_revision, v_current_hash, v_updated_at,
    p_proposal, p_proposed_itinerary, public.itinerary_state_hash(p_proposed_itinerary),
    coalesce(p_diff, '{}'::jsonb), coalesce(p_blocking, '[]'::jsonb), coalesce(p_warnings, '[]'::jsonb),
    coalesce(p_applicable, false), p_expires_at
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'proposalId', v_id,
    'tripId', p_trip_id,
    'materialRevision', p_material_revision,
    'baseHash', v_current_hash,
    'proposedHash', public.itinerary_state_hash(p_proposed_itinerary),
    'status', 'pending',
    'expiresAt', p_expires_at
  );
end;
$$;

revoke all on function public.stage_itinerary_change(text, uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.stage_itinerary_change(text, uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Apply — one transaction, or nothing
-- ---------------------------------------------------------------------------

create or replace function public.apply_itinerary_change(p_proposal_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_proposal public.itinerary_change_proposals%rowtype;
  v_change public.itinerary_change_history%rowtype;
  v_current jsonb;
  v_current_hash text;
  v_after_hash text;
  v_change_id uuid;
begin
  -- Lock the authorisation first. A double-confirm serialises here, so the
  -- second caller sees the finished state rather than racing the first.
  select * into v_proposal
  from public.itinerary_change_proposals
  where id = p_proposal_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'refusal', 'proposal-invalid');
  end if;

  -- A retried network request is not a second logical write.
  if v_proposal.status = 'applied' then
    select * into v_change
    from public.itinerary_change_history
    where proposal_id = v_proposal.id;

    if not found then
      return jsonb_build_object('ok', false, 'refusal', 'proposal-invalid');
    end if;

    return jsonb_build_object(
      'ok', true,
      'alreadyApplied', true,
      'changeId', v_change.id,
      'beforeHash', v_change.before_hash,
      'afterHash', v_change.after_hash,
      'itinerary', v_change.after_itinerary
    );
  end if;

  if v_proposal.status <> 'pending' then
    return jsonb_build_object('ok', false, 'refusal', 'proposal-not-pending');
  end if;

  if v_proposal.expires_at <= now() then
    update public.itinerary_change_proposals set status = 'expired' where id = v_proposal.id;
    return jsonb_build_object('ok', false, 'refusal', 'proposal-expired');
  end if;

  if v_proposal.applicable is not true then
    return jsonb_build_object('ok', false, 'refusal', 'proposal-blocked');
  end if;

  select i.data into v_current
  from public.itineraries i
  where i.id = v_proposal.trip_id and i.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'refusal', 'proposal-invalid');
  end if;

  -- The compare-and-swap. Under the row lock this is the only moment at which
  -- "the trip has not changed" is a fact rather than a recent memory.
  v_current_hash := public.itinerary_state_hash(v_current);
  if v_current_hash is distinct from v_proposal.base_itinerary_hash then
    update public.itinerary_change_proposals set status = 'stale' where id = v_proposal.id;
    return jsonb_build_object('ok', false, 'refusal', 'proposal-stale');
  end if;

  update public.itineraries
     set data = v_proposal.proposed_itinerary,
         updated_at = now()
   where id = v_proposal.trip_id and user_id = p_user_id;

  v_after_hash := public.itinerary_state_hash(v_proposal.proposed_itinerary);

  insert into public.itinerary_change_history (
    proposal_id, user_id, trip_id, before_hash, after_hash, before_itinerary, after_itinerary
  ) values (
    v_proposal.id, p_user_id, v_proposal.trip_id, v_current_hash, v_after_hash, v_current, v_proposal.proposed_itinerary
  )
  returning id into v_change_id;

  update public.itinerary_change_proposals
     set status = 'applied', applied_at = now(), resulting_change_id = v_change_id
   where id = v_proposal.id;

  -- Every other pending authorisation for this trip was bound to the old base.
  update public.itinerary_change_proposals
     set status = 'stale'
   where trip_id = v_proposal.trip_id and user_id = p_user_id
     and status = 'pending' and id <> v_proposal.id;

  -- `jsonb_array_length` raises on a non-array, so the type is checked rather
  -- than assumed: a malformed day list must not turn a valid write into an error.
  update public.trip_registry
     set updated_at = now(),
         day_count = case
           when jsonb_typeof(v_proposal.proposed_itinerary->'days') = 'array'
             then jsonb_array_length(v_proposal.proposed_itinerary->'days')
           else day_count
         end
   where id = v_proposal.trip_id and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyApplied', false,
    'changeId', v_change_id,
    'beforeHash', v_current_hash,
    'afterHash', v_after_hash,
    'itinerary', v_proposal.proposed_itinerary
  );
end;
$$;

revoke all on function public.apply_itinerary_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_itinerary_change(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Undo — only onto the exact state the apply produced
-- ---------------------------------------------------------------------------

create or replace function public.undo_itinerary_change(p_change_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_change public.itinerary_change_history%rowtype;
  v_current jsonb;
  v_current_hash text;
begin
  select * into v_change
  from public.itinerary_change_history
  where id = p_change_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'refusal', 'change-not-undoable');
  end if;

  -- A retried undo returns the first undo's result rather than writing again.
  if v_change.status = 'undone' then
    return jsonb_build_object(
      'ok', true,
      'alreadyUndone', true,
      'changeId', v_change.id,
      'itinerary', v_change.before_itinerary
    );
  end if;

  select i.data into v_current
  from public.itineraries i
  where i.id = v_change.trip_id and i.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'refusal', 'change-not-undoable');
  end if;

  -- Undo is a restore, never a merge. If anything at all has happened since the
  -- apply, the traveller's newer work is what survives.
  v_current_hash := public.itinerary_state_hash(v_current);
  if v_current_hash is distinct from v_change.after_hash then
    return jsonb_build_object('ok', false, 'refusal', 'undo-stale');
  end if;

  update public.itineraries
     set data = v_change.before_itinerary,
         updated_at = now()
   where id = v_change.trip_id and user_id = p_user_id;

  update public.itinerary_change_history
     set status = 'undone', undone_at = now()
   where id = v_change.id;

  update public.trip_registry
     set updated_at = now(),
         day_count = case
           when jsonb_typeof(v_change.before_itinerary->'days') = 'array'
             then jsonb_array_length(v_change.before_itinerary->'days')
           else day_count
         end
   where id = v_change.trip_id and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyUndone', false,
    'changeId', v_change.id,
    'itinerary', v_change.before_itinerary
  );
end;
$$;

revoke all on function public.undo_itinerary_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.undo_itinerary_change(uuid, uuid) to service_role;
