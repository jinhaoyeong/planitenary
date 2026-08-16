-- Phase 2A proposal previews, keyed by the complete bounded planning material.
-- A proposal is safe to reuse only while the exact material revision matches:
-- dates, place decisions, pace, hotel/base, trip edges, and fixed constraints
-- all participate in that revision. This table stores previews, never the
-- authoritative itinerary and never an applied mutation.
create table if not exists public.itinerary_proposal_cache (
  trip_id text not null references public.trip_registry(id) on delete cascade,
  material_revision text not null,
  proposal jsonb not null
    check (proposal->>'kind' = 'itinerary-proposal-v1')
    check (coalesce((proposal->>'applied')::boolean, false) = false),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (trip_id, material_revision)
);

create index if not exists itinerary_proposal_cache_expiry_idx
  on public.itinerary_proposal_cache (expires_at);

alter table public.itinerary_proposal_cache enable row level security;

-- Ownership is already proven before the service-role planner reads this
-- cache. No browser role can read or write proposal material directly.
revoke all on table public.itinerary_proposal_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.itinerary_proposal_cache to service_role;
