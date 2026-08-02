-- Align the current app's document and photo records with authenticated ownership.
-- Existing rows are preserved; legacy rows with no owner are intentionally not reassigned here.

alter table public.trip_documents
  add column if not exists user_id uuid references auth.users on delete cascade;

alter table public.day_photos
  add column if not exists user_id uuid references auth.users on delete cascade;

alter table public.trip_documents enable row level security;
alter table public.day_photos enable row level security;

drop policy if exists trip_documents_select_all on public.trip_documents;
drop policy if exists trip_documents_insert_all on public.trip_documents;
drop policy if exists trip_documents_update_all on public.trip_documents;
drop policy if exists trip_documents_delete_all on public.trip_documents;
drop policy if exists "Allow anonymous access to day photos" on public.day_photos;

create policy "Users can only access their own trip documents"
on public.trip_documents
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can only access their own day photos"
on public.day_photos
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Storage object ownership is enforced by requiring the first path segment to
-- equal the authenticated user's id. Public read policies remain unchanged so
-- existing public URLs continue to render.
drop policy if exists "Allow anonymous upload day photos" on storage.objects;
drop policy if exists "Allow anonymous update day photos" on storage.objects;
drop policy if exists "Allow anonymous delete day photos" on storage.objects;
drop policy if exists "Allow anonymous upload draft screenshots" on storage.objects;
drop policy if exists "Allow anonymous update draft screenshots" on storage.objects;
drop policy if exists "Allow anonymous delete draft screenshots" on storage.objects;
drop policy if exists trip_documents_storage_insert on storage.objects;
drop policy if exists trip_documents_storage_update on storage.objects;
drop policy if exists trip_documents_storage_delete on storage.objects;

create policy "Authenticated users can upload owned travel files"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('day-photos', 'draft-screenshots', 'trip-documents')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Authenticated users can update owned travel files"
on storage.objects for update to authenticated
using (
  bucket_id in ('day-photos', 'draft-screenshots', 'trip-documents')
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id in ('day-photos', 'draft-screenshots', 'trip-documents')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Authenticated users can delete owned travel files"
on storage.objects for delete to authenticated
using (
  bucket_id in ('day-photos', 'draft-screenshots', 'trip-documents')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
