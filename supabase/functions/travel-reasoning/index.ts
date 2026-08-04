import { json, preflight, ProviderError, secrets } from '../_shared/providers.ts';

interface ReasoningBody { operation?: string; input?: unknown; }

interface GeminiPayload {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

const outputTextFromResponse = (payload: GeminiPayload): string => (payload.candidates || [])
  .flatMap((candidate) => candidate.content?.parts || [])
  .map((part) => part.text?.trim() || '')
  .filter(Boolean)
  .join('\n')
  .trim();

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
  const key = secrets.gemini();
  if (!key) return json({ error: 'AI reasoning is not configured.' }, 503);
  const body = (await request.json().catch(() => ({}))) as ReasoningBody;
  if (!body.operation || body.input === undefined) return json({ error: 'operation and input are required.' }, 400);
  try {
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{
          role: 'user',
          parts: [{ text: `Operation: ${body.operation}\nSource-backed input:\n${JSON.stringify(body.input)}` }],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!response.ok) throw new ProviderError(`Gemini responded ${response.status}`, response.status === 429 ? 429 : 502);
    const payload = await response.json() as GeminiPayload;
    const outputText = outputTextFromResponse(payload);
    if (!outputText) throw new ProviderError('AI returned no structured output.');
    return json({ operation: body.operation, result: parseStructuredJson(outputText) });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'AI reasoning failed.' }, status);
  }
});
