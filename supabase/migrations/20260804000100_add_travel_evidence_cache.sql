-- Travel evidence cache.
--
-- Two kinds of data live here, with deliberately different access rules:
--
--   1. Shared reference data (canonical places, provider evidence, route and
--      weather caches). This is not personal — it is the same for everyone —
--      so authenticated users may read it, but only the service role may write
--      it. That keeps one traveller from poisoning another's plan.
--
--   2. Per-user data (shared links, place decisions, plan runs). Row-level
--      security scopes these to the owning user, matching the existing trip
--      tables.

-- ---------------------------------------------------------------------------
-- Canonical places and their cross-provider identities
-- ---------------------------------------------------------------------------
create table if not exists public.canonical_places (
  id uuid primary key default gen_random_uuid(),
  primary_name text not null,
  local_name text,
  city text not null,
  region text,
  country_code text not null,
  neighbourhood text,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  website text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canonical_places_city_idx
  on public.canonical_places (lower(city), country_code);
-- Identity resolution searches by proximity before it ever compares names.
create index if not exists canonical_places_location_idx
  on public.canonical_places (latitude, longitude);

create table if not exists public.place_provider_links (
  canonical_place_id uuid not null references public.canonical_places on delete cascade,
  provider text not null,
  provider_place_id text not null,
  -- 0..1; below the review threshold a link must not influence planning.
  match_confidence real not null default 1,
  matched_by text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (provider, provider_place_id)
);

create index if not exists place_provider_links_place_idx
  on public.place_provider_links (canonical_place_id);

create table if not exists public.place_aliases (
  canonical_place_id uuid not null references public.canonical_places on delete cascade,
  alias text not null,
  language text,
  primary key (canonical_place_id, alias)
);

-- ---------------------------------------------------------------------------
-- Evidence and the claims read out of it
-- ---------------------------------------------------------------------------
create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  canonical_place_id uuid references public.canonical_places on delete cascade,
  source text not null,
  source_url text not null,
  source_item_id text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  language text,
  author_type text not null default 'unknown',
  disclosure text not null default 'unknown',
  engagement jsonb,
  confidence real not null default 0.5,
  -- Past this instant the record must be relabelled stale or refreshed. It is
  -- never silently presented as current.
  expires_at timestamptz,
  unique (source, source_url)
);

create index if not exists source_documents_place_idx
  on public.source_documents (canonical_place_id, published_at desc);
create index if not exists source_documents_expiry_idx
  on public.source_documents (expires_at);

create table if not exists public.travel_claims (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents on delete cascade,
  canonical_place_id uuid references public.canonical_places on delete cascade,
  claim_type text not null,
  summary text not null,
  value numeric,
  unit text,
  applies_to jsonb,
  strength real not null default 0.5,
  excerpt text,
  created_at timestamptz not null default now()
);

create index if not exists travel_claims_place_idx
  on public.travel_claims (canonical_place_id, claim_type);

-- ---------------------------------------------------------------------------
-- Provider response caches, each with its own expiry
-- ---------------------------------------------------------------------------
create table if not exists public.route_cache (
  origin_key text not null,
  destination_key text not null,
  mode text not null,
  duration_minutes integer,
  distance_meters integer,
  transfers integer,
  status text not null default 'ok',
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (origin_key, destination_key, mode)
);

create index if not exists route_cache_expiry_idx on public.route_cache (expires_at);

create table if not exists public.weather_cache (
  location_key text not null,
  forecast_date date not null,
  payload jsonb not null,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (location_key, forecast_date)
);

create table if not exists public.opening_hours_snapshots (
  canonical_place_id uuid not null references public.canonical_places on delete cascade,
  captured_for date not null,
  payload jsonb not null,
  source_confidence text not null default 'medium',
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (canonical_place_id, captured_for)
);

-- ---------------------------------------------------------------------------
-- Per-user data
-- ---------------------------------------------------------------------------
create table if not exists public.user_shared_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  trip_id uuid,
  source text not null,
  source_url text not null,
  source_item_id text,
  -- Null until the traveller (or resolution) says which place it is about.
  canonical_place_id uuid references public.canonical_places on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists user_shared_sources_user_idx
  on public.user_shared_sources (user_id, created_at desc);

create table if not exists public.plan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  trip_id uuid,
  pace text,
  -- Per-day walking, transport, fatigue and confidence, for explainability.
  day_loads jsonb,
  warnings text[] not null default '{}',
  route_mode text,
  created_at timestamptz not null default now()
);

create index if not exists plan_runs_user_idx on public.plan_runs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- Shared reference data: readable by any signed-in user, writable only by the
-- service role (which bypasses RLS). No write policy is defined on purpose.
do $$
declare
  reference_table text;
begin
  foreach reference_table in array array[
    'canonical_places', 'place_provider_links', 'place_aliases',
    'source_documents', 'travel_claims', 'route_cache',
    'weather_cache', 'opening_hours_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security', reference_table);
    execute format('drop policy if exists "Signed-in users can read reference data" on public.%I', reference_table);
    execute format(
      'create policy "Signed-in users can read reference data" on public.%I for select to authenticated using (true)',
      reference_table
    );
    execute format('grant select on public.%I to authenticated', reference_table);
  end loop;
end $$;

-- Per-user data: scoped to the owner, matching the existing trip tables.
alter table public.user_shared_sources enable row level security;
drop policy if exists "Users can only access their own shared sources" on public.user_shared_sources;
create policy "Users can only access their own shared sources"
on public.user_shared_sources
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_shared_sources to authenticated;

alter table public.plan_runs enable row level security;
drop policy if exists "Users can only access their own plan runs" on public.plan_runs;
create policy "Users can only access their own plan runs"
on public.plan_runs
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.plan_runs to authenticated;
