-- Real photographs of real places.
--
-- Every row here is a photograph somebody took of the place it is attached to,
-- fetched from Wikimedia Commons with its author and licence. Nothing in this
-- table is ever generated: an approximation of a landmark is a false statement
-- about what a traveller will see, and one they have no way to detect.
--
-- The licence and author columns are not decoration. CC BY and CC BY-SA
-- require attribution, so the credit line is part of the permission to display
-- the image at all — and a row that lost its licence must stop being shown
-- rather than quietly keep rendering. `_shared/placeImages.ts` refuses to
-- build a `PlaceImage` without one, and `parsePlaceImage` refuses to read one
-- back without one.

create table if not exists public.place_images (
  canonical_place_id uuid not null references public.canonical_places on delete cascade,
  -- The rendered URL actually put in an <img src>, always a Wikimedia host.
  image_url text not null,
  thumbnail_url text,
  -- Dimensions of the source photograph, for ranking one against another.
  width integer,
  height integer,
  source text not null default 'wikimedia-commons',
  -- The Commons file page: where the full licence and author text live, and
  -- what the credit line links to.
  source_page text not null,
  author text,
  licence text not null,
  licence_url text,
  -- Which lead found it — see LEAD_PRIORITY in _shared/placeImages.ts. Kept so
  -- a re-rank after a cache read orders identically to a fresh fetch.
  lead text not null default 'commons-category',
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (canonical_place_id, image_url)
);

create index if not exists place_images_place_expiry_idx
  on public.place_images (canonical_place_id, expires_at);

alter table public.place_images enable row level security;

drop policy if exists "Signed-in users can read reference data" on public.place_images;
create policy "Signed-in users can read reference data"
on public.place_images
for select
to authenticated
using (true);

grant select on public.place_images to authenticated;

-- ---------------------------------------------------------------------------
-- Image lookup probes
-- ---------------------------------------------------------------------------
--
-- Cached photographs record what Commons *held*. They cannot record that
-- Commons was asked and held nothing — and "no rows" is indistinguishable from
-- "never asked". Most OSM places carry no image tag and no Wikidata item, so
-- without this table the large majority of every deck is looked up again on
-- every single discovery run, forever. This is the same fact `evidence_probes`
-- exists to record, and it is recorded again here rather than there for the
-- reason `ai_place_briefs` got its own table: a photograph is not a source of
-- evidence, and widening the evidence-source union for something that is not
-- evidence makes both harder to reason about.
create table if not exists public.place_image_probes (
  canonical_place_id uuid not null references public.canonical_places on delete cascade,
  source text not null,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (canonical_place_id, source)
);

create index if not exists place_image_probes_expiry_idx
  on public.place_image_probes (expires_at);

alter table public.place_image_probes enable row level security;

drop policy if exists "Signed-in users can read reference data" on public.place_image_probes;
create policy "Signed-in users can read reference data"
on public.place_image_probes
for select
to authenticated
using (true);

grant select on public.place_image_probes to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role write grants
-- ---------------------------------------------------------------------------
-- Explicit, for the reason 20260805000100 and 20260806000100 both state: a
-- silent write failure looks exactly like "this place has no photograph", so
-- the cache would appear to work while every run re-fetched. That is the
-- failure mode this table exists to prevent.
--
-- Delete is granted on `place_images` because a place's photographs are
-- replaced wholesale when they are re-fetched: a file deleted from Commons —
-- or one whose licence changed to something this app may not display — has to
-- be able to disappear, not survive as a leftover row beside the new answer.
-- The re-fetch itself happens when the 30-day TTL lapses; the nightly
-- `travel-refresh` does not cover images.
grant select, insert, update, delete on public.place_images to service_role;
grant select, insert, update on public.place_image_probes to service_role;
