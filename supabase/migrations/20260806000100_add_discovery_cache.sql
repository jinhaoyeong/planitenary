-- Discovery result cache.
--
-- `canonical_places` stores a place's *identity*, which is deliberately narrow:
-- name, coordinates, address, contact. It cannot answer "what did discovery
-- return for Osaka" because it carries none of the planning fields — category,
-- opening hours, estimated visit length, rating.
--
-- This table caches the discovery payload itself, one row per city per provider,
-- so repeating a search re-reads a row instead of re-buying a provider's search
-- results. It mirrors `weather_cache`: an opaque payload plus its own expiry.
--
-- Access follows the shared-reference-data rule already established for the
-- other caches: any signed-in user may read, only the service role may write.

create table if not exists public.discovery_cache (
  -- lower(city)|COUNTRYCODE — see `discoveryCityKey` in _shared/cacheKeys.ts.
  city_key text not null,
  provider text not null,
  -- PlaceCandidate[], exactly as the function would have returned it live.
  payload jsonb not null,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (city_key, provider)
);

create index if not exists discovery_cache_expiry_idx
  on public.discovery_cache (expires_at);

alter table public.discovery_cache enable row level security;

drop policy if exists "Signed-in users can read reference data" on public.discovery_cache;
create policy "Signed-in users can read reference data"
on public.discovery_cache
for select
to authenticated
using (true);

grant select on public.discovery_cache to authenticated;

-- ---------------------------------------------------------------------------
-- Evidence lookup support
-- ---------------------------------------------------------------------------

-- Evidence is read back by canonical place. The existing index leads with
-- `published_at desc`, which does not serve "every live document for these
-- places" — the query the evidence cache actually runs on every discovery.
create index if not exists source_documents_place_expiry_idx
  on public.source_documents (canonical_place_id, expires_at);

-- ---------------------------------------------------------------------------
-- Evidence probe log
-- ---------------------------------------------------------------------------
--
-- Cached documents record what a provider *returned*. They cannot record that a
-- provider was asked and returned nothing — and "no rows" is indistinguishable
-- from "never asked". Without this table, every place with no reviews and no
-- video coverage is re-fetched on every single discovery run, forever.
--
-- One row per place per source, so a fresh YouTube probe does not suppress a
-- due Google refresh (and vice versa) once more sources arrive.
create table if not exists public.evidence_probes (
  canonical_place_id uuid not null references public.canonical_places on delete cascade,
  source text not null,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (canonical_place_id, source)
);

create index if not exists evidence_probes_expiry_idx
  on public.evidence_probes (expires_at);

alter table public.evidence_probes enable row level security;

drop policy if exists "Signed-in users can read reference data" on public.evidence_probes;
create policy "Signed-in users can read reference data"
on public.evidence_probes
for select
to authenticated
using (true);

grant select on public.evidence_probes to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role write grants
-- ---------------------------------------------------------------------------
-- Same reasoning as 20260805000100: without an explicit grant the functions'
-- best-effort writes fail silently, results stay correct, and every run keeps
-- hitting the provider. That is precisely the failure this phase exists to fix,
-- so the grants are explicit rather than inherited.
grant select, insert, update on public.discovery_cache to service_role;
grant select, insert, update on public.canonical_places to service_role;
grant select, insert, update on public.place_provider_links to service_role;
grant select, insert, update on public.source_documents to service_role;
grant select, insert, update on public.evidence_probes to service_role;
-- Claims are replaced wholesale when a document is refreshed, so this one
-- needs delete as well.
grant select, insert, update, delete on public.travel_claims to service_role;
