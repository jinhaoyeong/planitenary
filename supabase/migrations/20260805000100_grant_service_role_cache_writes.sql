-- The read-through / write-through cache (route_cache, weather_cache) is written
-- by the travel Edge Functions using the service-role key. Grant the privileges
-- explicitly so caching never depends on project-level default privileges.
--
-- Without this, the functions' best-effort upserts fail *silently*: results are
-- still correct, but nothing is cached and every preview keeps hitting the paid
-- provider. Making the grant explicit is what lets the live cache proof succeed.
--
-- GRANT is idempotent, so re-running this is a no-op where the privilege already
-- exists via default privileges.
grant select, insert, update on public.route_cache to service_role;
grant select, insert, update on public.weather_cache to service_role;
