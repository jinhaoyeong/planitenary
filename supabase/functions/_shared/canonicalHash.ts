/**
 * Deterministic content fingerprints.
 *
 * Lives in its own module because two layers need identical answers and neither
 * may import the other: the proposal engine fingerprints planning material and
 * finished plans, and the write boundary fingerprints itineraries.
 *
 * Every value here is an *identity* something is compared against, so the digest
 * has to be collision-resistant rather than merely fast. An earlier 32-bit
 * non-cryptographic hash was fine while these strings were only cache keys; it
 * stopped being fine the moment equality of one meant "this is the plan the
 * traveller reviewed".
 */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Stable JSON: keys sorted, `undefined` dropped, arrays left in order.
 *
 * `JSON.stringify` preserves insertion order, and Postgres `jsonb` does not
 * preserve key order at all — so the same logical value read back from the
 * database would otherwise serialise differently than it was written, and every
 * identity check would fail for a value nobody changed. Sorting makes the digest
 * a property of the value rather than of how it happened to be built or stored.
 *
 * Array order is deliberately preserved: in a plan, order is meaning. Two days
 * holding the same places in a different sequence are different plans.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry ?? null)).join(',')}]`;
  const record = asRecord(value);
  if (!record) return 'null';
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

const HEX = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, '0'));

/**
 * SHA-256 of the canonical form, as lowercase hex.
 *
 * Web Crypto rather than a hand-rolled digest, and it exists in Deno and in
 * Node 18+ alike, so the Edge Function and the test suite agree byte for byte.
 */
export async function canonicalFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => HEX[byte]).join('');
}
