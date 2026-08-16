-- Short-lived factual research cache for the read-only Planitenary agent.
--
-- The key is a SHA-256 digest of the normalised query. Raw questions can
-- contain private trip context (for example a hotel name), so they are not
-- stored in a public-schema table even though only the service role can read
-- it. Results expire quickly because closures, exhibitions and travel advice
-- are precisely the facts this cache exists to research.
create table if not exists public.agent_web_cache (
  query_key text primary key,
  provider text not null check (provider in ('brave', 'wikimedia')),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  caveat text,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists agent_web_cache_expiry_idx
  on public.agent_web_cache (expires_at);

alter table public.agent_web_cache enable row level security;

-- No end-user policy: all reads and writes stay behind the authenticated Edge
-- Function, which has already proved trip ownership before research begins.
revoke all on table public.agent_web_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_web_cache to service_role;
