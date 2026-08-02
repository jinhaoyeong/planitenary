-- The current app always authenticates before accessing user data.
-- Remove the prototype's anonymous table policies so the existing owner-based
-- authenticated policies are the only data access path.
drop policy if exists "Allow anonymous access to itineraries" on public.itineraries;
drop policy if exists "Allow anonymous access to budgets" on public.budgets;
drop policy if exists "Allow anonymous access to checklists" on public.checklists;
drop policy if exists "Allow anonymous access to draft items" on public.draft_items;
