-- Run this in the Supabase SQL Editor (Dashboard → SQL) once.
-- Enables shared PDF/image documents with Storage + Realtime sync.

-- 1) Table
create table if not exists public.trip_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trip_documents enable row level security;

-- Permissive policies: same anon key is embedded in your app (fine for a private couple deployment).
-- Tighten later with Supabase Auth if you add logins.
drop policy if exists "trip_documents_select_all" on public.trip_documents;
drop policy if exists "trip_documents_insert_all" on public.trip_documents;
drop policy if exists "trip_documents_update_all" on public.trip_documents;
drop policy if exists "trip_documents_delete_all" on public.trip_documents;

create policy "trip_documents_select_all" on public.trip_documents
  for select using (true);
create policy "trip_documents_insert_all" on public.trip_documents
  for insert with check (true);
create policy "trip_documents_update_all" on public.trip_documents
  for update using (true) with check (true);
create policy "trip_documents_delete_all" on public.trip_documents
  for delete using (true);

-- Realtime: run once. If you see "already member of publication", ignore.
alter publication supabase_realtime add table public.trip_documents;

-- 2) Storage bucket (public so PDFs/images load in the in-app viewer without signed URLs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-documents',
  'trip-documents',
  true,
  52428800,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "trip_documents_storage_read" on storage.objects;
drop policy if exists "trip_documents_storage_insert" on storage.objects;
drop policy if exists "trip_documents_storage_update" on storage.objects;
drop policy if exists "trip_documents_storage_delete" on storage.objects;

create policy "trip_documents_storage_read" on storage.objects
  for select using (bucket_id = 'trip-documents');
create policy "trip_documents_storage_insert" on storage.objects
  for insert with check (bucket_id = 'trip-documents');
create policy "trip_documents_storage_update" on storage.objects
  for update using (bucket_id = 'trip-documents');
create policy "trip_documents_storage_delete" on storage.objects
  for delete using (bucket_id = 'trip-documents');
