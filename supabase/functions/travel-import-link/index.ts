import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const sourceForHost = (host: string) => {
  const value = host.toLowerCase();
  if (value.includes('tiktok.com')) return 'tiktok';
  if (value.includes('douyin.com')) return 'douyin';
  if (value.includes('xiaohongshu.com') || value.includes('xhslink.com')) return 'rednote';
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
  if (value.includes('google.com/maps') || value.includes('maps.google.')) return 'google-places';
  return 'user-shared';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
  const body = (await request.json().catch(() => ({}))) as { url?: string; tripId?: string; note?: string };
  if (!body.url || body.url.length > 4096) return json({ error: 'A valid HTTPS link is required.' }, 400);
  let url: URL;
  try { url = new URL(body.url); } catch { return json({ error: 'The link is not a valid URL.' }, 400); }
  if (url.protocol !== 'https:') return json({ error: 'Only HTTPS links can be imported.' }, 400);

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
    trip_id: body.tripId || null,
    source,
    source_url: url.toString(),
    note: body.note || null,
  }).select('id, source, source_url, created_at').single();
  if (error) return json({ error: error.message }, 400);
  return json({ imported: true, item: data });
});
