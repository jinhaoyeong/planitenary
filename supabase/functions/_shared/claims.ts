/**
 * Reading claims out of what people wrote.
 *
 * Shared by every evidence source — reviews, forum threads, video captions, and
 * links the traveller pastes in — so one place, one set of rules, one standard
 * of proof.
 *
 * The standard: **report what a source said, never assert what it did not.**
 * Every claim carries a verbatim `excerpt` so the evidence drawer can show the
 * traveller the sentence it came from. A rule that would fire on an ambiguous
 * phrase is not worth having; missing a claim is a smaller failure than
 * inventing one.
 *
 * No imports and no Deno APIs, so the vitest suite exercises this directly.
 */

export type ClaimType =
  | 'worth-visiting' | 'overrated' | 'local-favourite' | 'tourist-trap'
  | 'queue-time' | 'crowded' | 'closed' | 'reservation-needed' | 'food-quality';

export interface Claim {
  type: ClaimType;
  summary: string;
  value?: number;
  unit?: 'minutes';
  strength: number;
  excerpt?: string;
}

export type Disclosure = 'organic' | 'sponsored' | 'possible-promotion';

/**
 * Conservative phrase matching. Each rule needs an unambiguous phrase — we
 * would rather miss a claim than invent one.
 */
const CLAIM_RULES: Array<{ type: ClaimType; patterns: RegExp[]; summary: string; strength: number }> = [
  { type: 'overrated', patterns: [/\boverrated\b/i, /\bnot worth (the|it)\b/i, /\bwaste of (time|money)\b/i], summary: 'Described as overrated', strength: 0.8 },
  { type: 'tourist-trap', patterns: [/\btourist trap\b/i, /\btoo touristy\b/i], summary: 'Described as a tourist trap', strength: 0.8 },
  { type: 'local-favourite', patterns: [/\blocals? (love|go|eat|favou?rite)\b/i, /\bhidden gem\b/i], summary: 'Described as a local favourite', strength: 0.7 },
  { type: 'worth-visiting', patterns: [/\bworth (the|a) (visit|trip|queue|wait)\b/i, /\bmust[- ]see\b/i, /\bhighly recommend\b/i], summary: 'Described as worth visiting', strength: 0.7 },
  { type: 'crowded', patterns: [/\b(very |extremely |so )?crowded\b/i, /\bpacked\b/i, /\bshoulder to shoulder\b/i], summary: 'Reported as crowded', strength: 0.6 },
  { type: 'closed', patterns: [/\bpermanently closed\b/i, /\bclosed (down|for good)\b/i], summary: 'Reported as closed', strength: 0.9 },
  { type: 'reservation-needed', patterns: [/\b(book|reserve|reservation)s? (ahead|in advance|required|essential)\b/i], summary: 'Booking ahead is recommended', strength: 0.7 },
  { type: 'food-quality', patterns: [/\b(delicious|amazing food|best (meal|food))\b/i], summary: 'Food is well regarded', strength: 0.6 },
];

/**
 * "waited about 40 minutes", "2 hour queue", "45 min wait", "the line was
 * about 50 min".
 *
 * The hedging run in the second pattern matters: people rarely write "line of
 * 50 min", they write "the line was about 50 min" or "wait was roughly 20
 * min". Allowing a short run of known hedge words — and only those — catches
 * the natural phrasing without loosening the pattern into matching prose.
 */
const QUEUE_HEDGES = '(?:of|was|is|for|about|around|approx\\.?|roughly|maybe|like)';
const QUEUE_PATTERNS = [
  /(\d{1,3})\s*(?:-|to)?\s*\d{0,3}\s*min(?:ute)?s?\s*(?:queue|wait|line)/i,
  new RegExp(`(?:queue|wait(?:ed)?|line)\\s*(?:${QUEUE_HEDGES}\\s+){0,3}(\\d{1,3})\\s*min`, 'i'),
  /(\d)\s*hours?\s*(?:queue|wait|line)/i,
];

export function extractClaims(text: string): Claim[] {
  if (!text) return [];
  const claims: Claim[] = [];

  for (const rule of CLAIM_RULES) {
    const hit = rule.patterns.find((pattern) => pattern.test(text));
    if (!hit) continue;
    const match = text.match(hit);
    claims.push({
      type: rule.type,
      summary: rule.summary,
      strength: rule.strength,
      excerpt: match ? text.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + 80).trim() : undefined,
    });
  }

  for (const pattern of QUEUE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = Number.parseInt(match[1], 10);
    if (!Number.isFinite(raw)) continue;
    const minutes = /hour/i.test(match[0]) ? raw * 60 : raw;
    // Anything beyond four hours is far more likely a misparse than a queue.
    if (minutes > 0 && minutes <= 240) {
      claims.push({
        type: 'queue-time',
        summary: `Reported wait of about ${minutes} minutes`,
        value: minutes,
        unit: 'minutes',
        strength: 0.7,
        excerpt: match[0],
      });
    }
    break;
  }

  return claims;
}

/** Undisclosed promotion is common; look for the honest disclosures at least. */
export function assessDisclosure(text: string): Disclosure {
  if (/\b(sponsored|paid partnership|#ad\b|gifted|complimentary (meal|stay|visit))/i.test(text)) {
    return 'sponsored';
  }
  if (/\b(discount code|use my code|affiliate|partnership)\b/i.test(text)) return 'possible-promotion';
  return 'organic';
}
