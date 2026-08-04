export interface RegionalRouteResult {
  durationMinutes: number;
  distanceMeters: number;
}

const positiveNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

/** Parse the Amap walking response documented by its Web Service API. */
export function parseAmapWalkingRoute(payload: unknown): RegionalRouteResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as { status?: string; route?: { paths?: Array<{ distance?: unknown; duration?: unknown }> } };
  if (source.status !== '1') return null;
  const path = source.route?.paths?.[0];
  const distance = positiveNumber(path?.distance);
  const duration = positiveNumber(path?.duration);
  if (distance === undefined || duration === undefined) return null;
  return { distanceMeters: distance, durationMinutes: Math.max(1, Math.round(duration / 60)) };
}

/** Parse the Baidu DirectionLite walking response. */
export function parseBaiduWalkingRoute(payload: unknown): RegionalRouteResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as { status?: number; result?: { routes?: Array<{ distance?: unknown; duration?: unknown }> } };
  if (source.status !== 0) return null;
  const route = source.result?.routes?.[0];
  const distance = positiveNumber(route?.distance);
  const duration = positiveNumber(route?.duration);
  if (distance === undefined || duration === undefined) return null;
  return { distanceMeters: distance, durationMinutes: Math.max(1, Math.round(duration / 60)) };
}
