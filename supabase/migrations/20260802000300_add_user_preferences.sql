-- Store account-level appearance and currency preferences in the same
-- Supabase project as the user's trip data.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  theme text,
  currency text,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Users can only access their own preferences" on public.user_preferences;
create policy "Users can only access their own preferences"
on public.user_preferences
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_preferences to authenticated;
