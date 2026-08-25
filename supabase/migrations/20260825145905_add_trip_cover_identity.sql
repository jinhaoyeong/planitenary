-- A cover is factual identity, not an arbitrary dashboard URL. The client and
-- Edge boundaries validate the full payload (including Wikimedia attribution
-- and validation version) before display. JSONB keeps the additive contract
-- compatible with existing registry rows, which intentionally remain null.
alter table public.trip_registry
  add column if not exists cover_ref jsonb;

comment on column public.trip_registry.cover_ref is
  'Validated TripCoverRef shared by the trip shelf and handbook hero; null means deterministic non-photographic fallback.';
