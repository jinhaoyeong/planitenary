import { json, preflight, ProviderError, secrets } from '../_shared/providers.ts';

interface ReasoningBody { operation?: string; input?: unknown; }

interface ResponseOutputItem {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface ResponsePayload {
  /** Convenience field returned by SDKs; raw HTTP responses may omit it. */
  output_text?: string;
  output?: ResponseOutputItem[];
}

const outputTextFromResponse = (payload: ResponsePayload): string => {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = (payload.output || []).flatMap((item) => (item.content || [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text!.trim()))
    .filter(Boolean);
  return parts.join('\n').trim();
};

const parseStructuredJson = (text: string): unknown => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ProviderError('AI returned invalid structured JSON.');
  }
};

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
    const payload = await response.json() as ResponsePayload;
    const outputText = outputTextFromResponse(payload);
    if (!outputText) throw new ProviderError('AI returned no structured output.');
    return json({ operation: body.operation, result: parseStructuredJson(outputText) });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'AI reasoning failed.' }, status);
  }
});
