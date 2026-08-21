/**
 * Small, source-shaped price facts shared by the Ask server contract and the
 * browser presentation layer.
 *
 * A price fact is never a model estimate. It is copied from a saved admission
 * record or a saved itinerary estimate, with the source currency kept beside
 * the amount so a bare number cannot be mistaken for a different currency.
 */

export interface AskPriceFare {
  audience: string;
  amount: number;
  minAmount?: number;
  maxAmount?: number;
  currency: string;
  note?: string;
}

export interface AskPriceFact {
  name: string;
  scheduledDay?: number;
  kind: 'admission' | 'estimate';
  fares: AskPriceFare[];
  source?: string;
  sourceUrl?: string;
  retrievedAt?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

const currency = (value: unknown): string | undefined => {
  const code = text(value, 3)?.toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : undefined;
};

const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : undefined;

const fareFromUnknown = (value: unknown): AskPriceFare | undefined => {
  const row = asRecord(value);
  const audience = text(row?.audience, 40);
  const valueAmount = amount(row?.amount);
  const valueCurrency = currency(row?.currency);
  if (!audience || valueAmount === undefined || !valueCurrency) return undefined;
  const minAmount = amount(row?.minAmount);
  const maxAmount = amount(row?.maxAmount);
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) return undefined;
  return {
    audience,
    amount: valueAmount,
    ...(minAmount !== undefined ? { minAmount } : {}),
    ...(maxAmount !== undefined ? { maxAmount } : {}),
    currency: valueCurrency,
    ...(text(row?.note, 160) ? { note: text(row?.note, 160) } : {}),
  };
};

const faresFromUnknown = (value: unknown): AskPriceFare[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
      const fare = fareFromUnknown(entry);
      return fare ? [fare] : [];
    }).slice(0, 8)
    : [];

const sourceUrl = (value: unknown): string | undefined =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim())
    ? value.trim().slice(0, 500)
    : undefined;

/** Parse a server-returned price fact before it reaches browser state. */
export const parseAskPriceFact = (value: unknown): AskPriceFact | undefined => {
  const row = asRecord(value);
  const name = text(row?.name, 160);
  const fares = faresFromUnknown(row?.fares);
  const kind = row?.kind === 'estimate' ? 'estimate' : row?.kind === 'admission' ? 'admission' : undefined;
  if (!name || !kind || fares.length === 0) return undefined;
  const day = typeof row?.scheduledDay === 'number' && Number.isInteger(row.scheduledDay)
    && row.scheduledDay > 0 && row.scheduledDay <= 60
    ? row.scheduledDay
    : undefined;
  const source = text(row?.source, 60);
  const url = sourceUrl(row?.sourceUrl);
  const retrievedAt = typeof row?.retrievedAt === 'string' && Number.isFinite(Date.parse(row.retrievedAt))
    ? row.retrievedAt.trim().slice(0, 80)
    : undefined;
  return {
    name,
    scheduledDay: day,
    kind,
    fares,
    ...(source ? { source } : {}),
    ...(url ? { sourceUrl: url } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
  };
};

export const parseAskPriceFacts = (value: unknown, max = 12): AskPriceFact[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
      const fact = parseAskPriceFact(entry);
      return fact ? [fact] : [];
    }).slice(0, max)
    : [];

const factFromAdmission = (
  name: string,
  admission: Record<string, unknown>,
  scheduledDay?: number,
): AskPriceFact | undefined => {
  const fares = faresFromUnknown(admission.fares);
  if (admission.class === 'spend-based') {
    const typical = fareFromUnknown(admission.typicalSpend);
    if (typical) fares.push(typical);
  }
  if (fares.length === 0) return undefined;
  return parseAskPriceFact({
    name,
    scheduledDay,
    kind: 'admission',
    fares,
    source: admission.source,
    sourceUrl: admission.sourceUrl,
    retrievedAt: admission.retrievedAt,
  });
};

/**
 * Read one saved itinerary/place record. Admission wins over the derived
 * estimate; the estimate is only a fallback when no fare list survived.
 */
export const priceFactFromRecord = (value: unknown, scheduledDay?: number): AskPriceFact | undefined => {
  const row = asRecord(value);
  const name = text(row?.name, 160);
  if (!name) return undefined;

  const admission = asRecord(row?.admission);
  const sourced = admission ? factFromAdmission(name, admission, scheduledDay) : undefined;
  if (sourced) return sourced;

  const estimate = asRecord(row?.estimatedCost);
  const estimateAmount = amount(estimate?.amount);
  const estimateCurrency = currency(estimate?.currency);
  if (estimateAmount === undefined || !estimateCurrency) return undefined;
  return parseAskPriceFact({
    name,
    scheduledDay,
    kind: 'estimate',
    fares: [{ audience: text(estimate?.basis, 40) ?? 'estimate', amount: estimateAmount, currency: estimateCurrency }],
    source: 'stored-itinerary-estimate',
  });
};

/** Find saved admission facts in a bounded tool result. */
export const priceFactsFromValue = (value: unknown, max = 12): AskPriceFact[] => {
  const found: AskPriceFact[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || found.length >= max || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const entry of node.slice(0, 100)) visit(entry, depth + 1);
      return;
    }
    const row = asRecord(node);
    if (!row) return;
    const fact = priceFactFromRecord(row);
    if (fact) {
      const key = `${fact.name.toLowerCase()}|${fact.kind}|${fact.fares.map((fare) => `${fare.audience}:${fare.amount}:${fare.maxAmount ?? ''}:${fare.currency}`).join(',')}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push(fact);
      }
    }
    for (const child of Object.values(row)) visit(child, depth + 1);
  };
  visit(value, 0);
  return found;
};

export const mergeAskPriceFacts = (target: AskPriceFact[], incoming: AskPriceFact[], max = 12): void => {
  const seen = new Set(target.map((fact) =>
    `${fact.name.toLowerCase()}|${fact.kind}|${fact.fares.map((fare) => `${fare.audience}:${fare.amount}:${fare.maxAmount ?? ''}:${fare.currency}`).join(',')}`));
  for (const fact of incoming) {
    if (target.length >= max) break;
    const key = `${fact.name.toLowerCase()}|${fact.kind}|${fact.fares.map((fare) => `${fare.audience}:${fare.amount}:${fare.maxAmount ?? ''}:${fare.currency}`).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(fact);
  }
};

export const adultFare = (fact: AskPriceFact): AskPriceFare | undefined =>
  fact.fares.find((fare) => fare.audience.toLowerCase() === 'adult') ?? fact.fares[0];
