create table if not exists public.trip_registry (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  day_count integer not null default 0,
  city_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_registry_user_status_idx
  on public.trip_registry(user_id, status, updated_at desc);

alter table public.trip_registry enable row level security;

drop policy if exists "Users can only access their own trip registry" on public.trip_registry;
create policy "Users can only access their own trip registry"
on public.trip_registry
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.trip_registry to authenticated;

-- The registry is the deliberate visibility boundary for the new app. Existing
-- rows in itineraries remain untouched and are not automatically surfaced.

