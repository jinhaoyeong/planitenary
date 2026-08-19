-- Identity validation for place photographs.
--
-- A Wikidata id on an OSM object names an entity, not necessarily the place a
-- traveller is looking at. Production served a Tokyo flagship for a Fukuoka
-- branch, a concert photograph for a theatre, and a placeholder glyph for two
-- shrines — all correctly licensed, all wrong.
--
-- Rows accepted under an older policy cannot be trusted once the policy
-- tightens, so every cached decision records the version it was made under.
-- Existing rows default to 1 and are therefore treated as needing
-- revalidation; nothing is deleted, and a row that still passes is simply
-- re-stamped.

alter table public.place_images
  add column if not exists validation_version integer not null default 1;

alter table public.place_image_probes
  add column if not exists validation_version integer not null default 1;

-- Reads filter on this, so it leads the index.
create index if not exists place_images_validation_version_idx
  on public.place_images (validation_version, canonical_place_id);

create index if not exists place_image_probes_validation_version_idx
  on public.place_image_probes (validation_version, canonical_place_id);

comment on column public.place_images.validation_version is
  'Identity-validation policy version this image was accepted under. Rows below the current version are treated as a cache miss and must be re-resolved before display.';

comment on column public.place_image_probes.validation_version is
  'Identity-validation policy version this probe was recorded under. A probe from an older policy must not suppress a fresh lookup.';
