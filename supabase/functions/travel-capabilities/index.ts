/**
 * Reports which travel providers this deployment has credentials for.
 *
 * This is the only channel by which the browser learns what the product can
 * honestly offer. It returns booleans and nothing else — no keys, no endpoints,
 * no quota detail.
 */
import { capabilitySnapshot, json, preflight } from '../_shared/providers.ts';

Deno.serve((request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }
  return json(capabilitySnapshot());
});
