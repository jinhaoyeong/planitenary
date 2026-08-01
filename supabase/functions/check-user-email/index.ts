import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { email } = await request.json().catch(() => ({}));
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return json({ error: 'Enter a valid email address.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Recovery lookup is not configured.' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Keep the privileged scan inside this function; never ship the service-role key to the browser.
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return json({ error: 'Recovery lookup failed.' }, 502);
    if (data.users.some((user) => user.email?.trim().toLowerCase() === normalizedEmail)) {
      return json({ exists: true });
    }
    if (data.users.length < 1000) break;
  }

  return json({ exists: false });
});
