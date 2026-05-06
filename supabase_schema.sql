-- Enable the UUID extension
create extension if not exists "uuid-ossp";

-- Create itineraries table
create table if not exists public.itineraries (
  id text primary key,
  user_id uuid references auth.users not null,
  data jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create budgets table
create table if not exists public.budgets (
  id text primary key,
  user_id uuid references auth.users not null,
  data jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create checklists table
create table if not exists public.checklists (
  id text primary key,
  user_id uuid references auth.users not null,
  data jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create draft items table (row-per-draft for safer concurrent editing)
create table if not exists public.draft_items (
  id text primary key,
  itinerary_id text not null,
  user_id uuid references auth.users not null,
  data jsonb not null,
  client_id text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists draft_items_itinerary_id_idx on public.draft_items(itinerary_id);
create index if not exists itineraries_user_id_idx on public.itineraries(user_id);

-- Enable Row Level Security (RLS)
alter table public.itineraries enable row level security;
alter table public.budgets enable row level security;
alter table public.checklists enable row level security;
alter table public.draft_items enable row level security;

-- Create policies for authenticated users
drop policy if exists "Users can only access their own itineraries" on public.itineraries;
create policy "Users can only access their own itineraries"
on public.itineraries
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own budgets" on public.budgets;
create policy "Users can only access their own budgets"
on public.budgets
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own checklists" on public.checklists;
create policy "Users can only access their own checklists"
on public.checklists
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own draft items" on public.draft_items;
create policy "Users can only access their own draft items"
on public.draft_items
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Enable Realtime
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'itineraries'
  ) then
    alter publication supabase_realtime add table public.itineraries;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'budgets'
  ) then
    alter publication supabase_realtime add table public.budgets;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checklists'
  ) then
    alter publication supabase_realtime add table public.checklists;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'draft_items'
  ) then
    alter publication supabase_realtime add table public.draft_items;
  end if;
end $$;

-- Storage bucket for shared draft screenshots
insert into storage.buckets (id, name, public)
values ('draft-screenshots', 'draft-screenshots', true)
on conflict (id) do nothing;

drop policy if exists "Allow anonymous upload draft screenshots" on storage.objects;
create policy "Allow anonymous upload draft screenshots"
on storage.objects
for insert
to anon
with check (bucket_id = 'draft-screenshots');

drop policy if exists "Allow anonymous read draft screenshots" on storage.objects;
create policy "Allow anonymous read draft screenshots"
on storage.objects
for select
to anon
using (bucket_id = 'draft-screenshots');

drop policy if exists "Allow anonymous update draft screenshots" on storage.objects;
create policy "Allow anonymous update draft screenshots"
on storage.objects
for update
to anon
using (bucket_id = 'draft-screenshots')
with check (bucket_id = 'draft-screenshots');

drop policy if exists "Allow anonymous delete draft screenshots" on storage.objects;
create policy "Allow anonymous delete draft screenshots"
on storage.objects
for delete
to anon
using (bucket_id = 'draft-screenshots');
