import { json, preflight, ProviderError, secrets } from '../_shared/providers.ts';

interface ReasoningBody { operation?: string; input?: unknown; }

const SYSTEM = `You are a travel evidence interpreter. You may summarise, classify, translate, and explain only the source-backed input you receive. Never invent a place, opening hour, price, route, queue, review, closure, or availability. Return valid JSON only.`;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = secrets.openai();
  if (!key) return json({ error: 'AI reasoning is not configured.' }, 503);
  const body = (await request.json().catch(() => ({}))) as ReasoningBody;
  if (!body.operation || body.input === undefined) return json({ error: 'operation and input are required.' }, 400);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini',
        store: false,
        instructions: SYSTEM,
        input: `Operation: ${body.operation}\nSource-backed input:\n${JSON.stringify(body.input)}`,
      }),
    });
    if (!response.ok) throw new ProviderError(`OpenAI responded ${response.status}`, response.status === 429 ? 429 : 502);
    const payload = await response.json() as { output_text?: string };
    if (!payload.output_text) throw new ProviderError('AI returned no structured output.');
    return json({ operation: body.operation, result: JSON.parse(payload.output_text) });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'AI reasoning failed.' }, status);
  }
});
