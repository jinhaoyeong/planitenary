alter table public.trip_documents
  add column if not exists trip_id text;

create index if not exists trip_documents_user_trip_idx
  on public.trip_documents(user_id, trip_id, updated_at desc);

