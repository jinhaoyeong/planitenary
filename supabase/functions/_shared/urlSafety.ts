/**
 * Two URL judgements that both runtimes need, and neither owns.
 *
 * `isSafePublicUrl` decides what the *server* may fetch, because a place
 * website arrives from a community-edited OpenStreetMap tag. 
 * `isLikelyResellerUrl` decides whether a host may speak as the operator.
 * The Edge functions have always needed both; the browser now needs them too,
 * to build a booking link ladder that cannot caption a marketplace page
 * "Official website".
 *
 * They live here rather than in `officialSource.ts` for one reason: importing
 * that module into client code would drag its whole graph — JSON-LD parsing,
 * OSM opening rules, admission text — into the browser bundle for two pure
 * string checks. This file has no imports, no Deno APIs and no DOM APIs, so
 * both runtimes can take it as a leaf.
 *
 * `officialSource.ts` re-exports both, so every existing Edge caller is
 * untouched.
 */

/**
 * Whether a URL is safe for the server to fetch.
 *
 * Place websites come from community-edited map data, so this is a
 * server-side request forgery surface: an edited tag pointing at
 * `http://169.254.169.254/` or `http://10.0.0.5/` would make our server read
 * something the traveller could never reach.
 *
 * Rejected: anything not HTTPS, embedded credentials, non-standard ports,
 * loopback and link-local names, internal-only suffixes, and IP literals in
 * private or reserved ranges.
 *
 * Residual risk: a public hostname whose DNS resolves to a private address
 * still passes, because resolution happens after this check. Closing that
 * needs resolve-then-pin, which the Edge runtime does not expose. The
 * consequence is bounded — the response is only ever parsed for opening hours
 * and never returned to the traveller verbatim.
 */
export function isSafePublicUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost') return false;
  if (/\.(local|internal|localdomain|home\.arpa)$/.test(host)) return false;

  // IPv6 literals arrive bracketed; no legitimate venue publishes one.
  if (host.startsWith('[')) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    // Link-local, including the cloud metadata endpoint at 169.254.169.254.
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
  }
  return true;
}

/** Known map, guide and reseller hosts are not official operator sources. */
export function isLikelyResellerUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return true; }
  return [
    'booking.com', 'expedia.com', 'getyourguide.com', 'klook.com', 'viator.com',
    'tripadvisor.com', 'rakutentravel.com', 'kkday.com', 'traveloka.com',
    'trip.com', 'ctrip.com', 'agoda.com', 'tiqets.com', 'headout.com',
    'google.com', 'google.co.jp', 'maps.google.com', 'amap.com', 'baidu.com',
    'wikivoyage.org', 'wikipedia.org',
  ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}
