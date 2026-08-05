/**
 * Bring a link the traveller found into the plan as evidence.
 *
 * This is how TikTok, Douyin and RedNote reach the app at all. None of them
 * offers public travel search to commercial apps, and scraping them violates
 * their terms and gets a server blocked within days — so the traveller supplies
 * the link, and everything after that is sanctioned:
 *
 *   1. The URL is recorded against their trip (always).
 *   2. Where the platform publishes a public oEmbed endpoint, the caption and
 *      author are read from it. This is an API meant for exactly this.
 *   3. Claims are extracted from that caption by the same conservative rules
 *      every other source uses, and stored with a verbatim excerpt.
 *
 * Step 3 only happens when the traveller says which place the link is about.
 * Guessing would attach one venue's praise to another, which is worse than
 * leaving the link unattached — and an unattached link is still saved, still
 * theirs, and can be attached later.
 */
import { createClient } from '@supabase/supabase-js';
import { assessDisclosure, extractClaims } from '../_shared/claims.ts';
import { expiryFor } from '../_shared/providers.ts';
import {
  readCanonicalPlaceIds,
  serviceClient,
  writeEvidenceCache,
  type CachedEvidence,
} from '../_shared/cache.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

type SharedSource = 'tiktok' | 'douyin' | 'rednote' | 'youtube' | 'google-places' | 'user-shared';

const sourceForHost = (host: string): SharedSource => {
  const value = host.toLowerCase();
  if (value.includes('tiktok.com')) return 'tiktok';
  if (value.includes('douyin.com')) return 'douyin';
  if (value.includes('xiaohongshu.com') || value.includes('xhslink.com')) return 'rednote';
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
  if (value.includes('google.com/maps') || value.includes('maps.google.')) return 'google-places';
  return 'user-shared';
};

/**
 * Public oEmbed endpoints, which platforms publish precisely so third parties
 * can describe a link without scraping it.
 *
 * Douyin and RedNote publish none. Their links are still recorded — the
 * traveller can add their own note — but nothing is read from the page, because
 * the only way to do that would be scraping.
 */
const OEMBED_ENDPOINTS: Partial<Record<SharedSource, (url: string) => string>> = {
  youtube: (url) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
};

interface OEmbed {
  title?: string;
  author_name?: string;
  provider_name?: string;
}

/** Caption and author for a link, or null when the platform publishes neither. */
async function readOEmbed(source: SharedSource, url: string): Promise<OEmbed | null> {
  const endpoint = OEMBED_ENDPOINTS[source]?.(url);
  if (!endpoint) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Planitenary/1.0 (travel itinerary planner)' },
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json() as OEmbed;
  } catch {
    // Enrichment is a bonus; the link itself is already safe.
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normaliseTripId = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim().replace(/^trip-/i, '');
  return UUID_PATTERN.test(candidate) ? candidate : null;
};

interface ImportBody {
  url?: string;
  tripId?: string;
  note?: string;
  /** The place this link is about, as the traveller was viewing it. */
  providerPlaceId?: string;
  provider?: string;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
  const body = (await request.json().catch(() => ({}))) as ImportBody;
  if (!body.url || body.url.length > 4096) return json({ error: 'A valid HTTPS link is required.' }, 400);
  let url: URL;
  try { url = new URL(body.url); } catch { return json({ error: 'The link is not a valid URL.' }, 400); }
  if (url.protocol !== 'https:') return json({ error: 'Only HTTPS links can be imported.' }, 400);
  const tripId = normaliseTripId(body.tripId);
  if (body.tripId && !tripId) return json({ error: 'The trip identifier is invalid.' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Authentication required.' }, 401);

  const source = sourceForHost(url.hostname);
  const { data, error } = await supabase.from('user_shared_sources').insert({
    user_id: userData.user.id,
    trip_id: tripId,
    source,
    source_url: url.toString(),
    note: body.note || null,
  }).select('id, source, source_url, created_at').single();
  if (error) return json({ error: error.message }, 400);

  // ---------------------------------------------------------------------
  // Turn the link into evidence, where that is possible and unambiguous.
  // ---------------------------------------------------------------------
  const oembed = await readOEmbed(source, url.toString());
  // The traveller's own note is theirs and counts as much as the caption —
  // often more, since they wrote it about this specific place.
  const text = [oembed?.title, body.note].filter(Boolean).join('. ');
  const claims = extractClaims(text);

  let attachedTo: string | null = null;
  const cache = serviceClient();
  if (cache && body.providerPlaceId && claims.length > 0) {
    const provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'osm';
    const canonicalIds = await readCanonicalPlaceIds(cache, provider, [body.providerPlaceId]);
    const canonicalPlaceId = canonicalIds.get(body.providerPlaceId);
    if (canonicalPlaceId) {
      const document: CachedEvidence = {
        canonicalPlaceId,
        source,
        sourceUrl: url.toString(),
        sourceItemId: data.id,
        retrievedAt: new Date().toISOString(),
        // The traveller went looking for this and chose to keep it, which is a
        // different kind of signal from a search result we happened to find.
        authorType: 'traveller',
        disclosure: assessDisclosure(text),
        confidence: 0.55,
        claims,
      };
      await writeEvidenceCache(cache, [document], expiryFor('reviewSummary'));
      attachedTo = canonicalPlaceId;
    }
  }

  return json({
    imported: true,
    item: data,
    /** What was read from the link, so the UI can show it back. */
    caption: oembed?.title,
    author: oembed?.author_name,
    claimsFound: claims.length,
    /** Null when the link is saved but not yet tied to a place. */
    attachedTo,
  });
});
