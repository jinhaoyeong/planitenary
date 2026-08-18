/**
 * Authenticated trip budget persistence.
 *
 * For signed-in owned trips, `public.budgets` is the factual source of truth.
 * localStorage is a cache / backup / offline copy — never Ask or Smart Plan
 * authority, and never a blind upsert over a server row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sanitizeBudgetDocument,
  type CustomBudget,
} from '../../supabase/functions/_shared/budgetDocument';
import { supabase } from './supabase';

export const budgetStorageKey = (tripId: string) => `budget-${tripId}`;
export const budgetBackupKey = (tripId: string) => `budget-${tripId}-backup`;
export const budgetHistoryKey = (tripId: string) => `budget-${tripId}-history`;
export const budgetMetaKey = (tripId: string) => `budget-meta-${tripId}`;
export const budgetClearedKey = (tripId: string) => `budget-${tripId}-cleared`;

export type BudgetAuthoritySource = 'server' | 'cache-fallback' | 'local' | 'none';

export interface BudgetStorageMeta {
  updatedAt: string;
  source: Exclude<BudgetAuthoritySource, 'none'>;
}

export interface BudgetLocalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ServerBudgetRow {
  id: string;
  user_id: string;
  data: unknown;
  updated_at: string;
}

export interface TripBudgetGateway {
  getAuthenticatedUserId(): Promise<string | null>;
  tripIsOwned(tripId: string, userId: string): Promise<boolean>;
  readBudget(tripId: string, userId: string): Promise<ServerBudgetRow | null>;
  insertBudget(row: ServerBudgetRow): Promise<'created' | 'conflict' | 'error'>;
  updateBudget(row: ServerBudgetRow): Promise<'updated' | 'missing' | 'error'>;
  deleteBudget(tripId: string, userId: string): Promise<'deleted' | 'missing' | 'error'>;
}

export type HydrateTripBudgetResult =
  | { ok: true; kind: 'none'; budget: null; source: 'none'; imported: false; configured: false }
  | {
    ok: true;
    kind: 'server' | 'cache-fallback' | 'local';
    budget: CustomBudget;
    source: Exclude<BudgetAuthoritySource, 'none'>;
    imported: boolean;
    configured: boolean;
    updatedAt: string;
  }
  | { ok: false; kind: 'error' | 'forbidden'; message: string };

export type SaveTripBudgetResult =
  | { ok: true; budget: CustomBudget; source: 'server' | 'local'; updatedAt: string; conflict: boolean }
  | { ok: false; message: string; conflict?: boolean };

const friendlyLoadError = 'Couldn’t load your budget right now.';
const friendlySaveError = 'Couldn’t save your budget. Try again.';
const friendlyClearError = 'Couldn’t clear your budget. Try again.';
const friendlyForbidden = 'This trip budget is not available for your account.';

export const browserBudgetLocalStore: BudgetLocalStore = {
  getItem: (key) => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, value);
    } catch {
      // Quota or private-mode failure must not crash the wallet UI.
    }
  },
  removeItem: (key) => {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(key);
    } catch {
      // Best effort.
    }
  },
};

const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

export const readBudgetAuthority = (
  tripId: string,
  local: BudgetLocalStore = browserBudgetLocalStore,
): BudgetAuthoritySource => {
  const meta = parseJson(local.getItem(budgetMetaKey(tripId)));
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'none';
  const source = (meta as { source?: unknown }).source;
  if (source === 'server' || source === 'cache-fallback' || source === 'local') return source;
  return 'none';
};

const wasCleared = (tripId: string, local: BudgetLocalStore): boolean =>
  Boolean(local.getItem(budgetClearedKey(tripId)));

/** Read primary then legacy `-backup` without treating either as server authority. */
export function readLocalBudgetDocument(
  tripId: string,
  local: BudgetLocalStore = browserBudgetLocalStore,
): CustomBudget | null {
  const primary = sanitizeBudgetDocument(parseJson(local.getItem(budgetStorageKey(tripId))));
  if (primary) return primary;
  return sanitizeBudgetDocument(parseJson(local.getItem(budgetBackupKey(tripId))));
}

export function writeBudgetCache(
  tripId: string,
  budget: CustomBudget,
  meta: BudgetStorageMeta,
  local: BudgetLocalStore = browserBudgetLocalStore,
): void {
  const serialized = JSON.stringify(budget);
  local.setItem(budgetStorageKey(tripId), serialized);
  local.setItem(budgetBackupKey(tripId), serialized);
  local.setItem(budgetMetaKey(tripId), JSON.stringify(meta));
  local.removeItem(budgetClearedKey(tripId));
}

export function invalidateLocalBudget(
  tripId: string,
  local: BudgetLocalStore = browserBudgetLocalStore,
  options: { markCleared?: boolean } = {},
): void {
  local.removeItem(budgetStorageKey(tripId));
  local.removeItem(budgetBackupKey(tripId));
  local.removeItem(budgetHistoryKey(tripId));
  local.removeItem(budgetMetaKey(tripId));
  if (options.markCleared) {
    local.setItem(budgetClearedKey(tripId), new Date().toISOString());
  } else {
    local.removeItem(budgetClearedKey(tripId));
  }
}

export const tripBudgetCleanupKeys = (tripId: string): string[] => [
  budgetStorageKey(tripId),
  budgetBackupKey(tripId),
  budgetHistoryKey(tripId),
  budgetMetaKey(tripId),
  budgetClearedKey(tripId),
];

const isoNow = () => new Date().toISOString();

const uniqueViolation = (error: { code?: string; message?: string } | null | undefined): boolean => {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();
  return code === '23505' || message.includes('duplicate') || message.includes('unique');
};

export function createSupabaseBudgetGateway(
  client: Pick<SupabaseClient, 'from' | 'auth'> = supabase,
): TripBudgetGateway {
  return {
    async getAuthenticatedUserId() {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user?.id) return null;
      return data.user.id;
    },

    async tripIsOwned(tripId, userId) {
      const registry = await client
        .from('trip_registry')
        .select('id')
        .eq('id', tripId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      if (registry.data && typeof (registry.data as { id?: unknown }).id === 'string') return true;
      const itinerary = await client
        .from('itineraries')
        .select('id')
        .eq('id', tripId)
        .eq('user_id', userId)
        .maybeSingle();
      return Boolean(itinerary.data && typeof (itinerary.data as { id?: unknown }).id === 'string');
    },

    async readBudget(tripId, userId) {
      const { data, error } = await client
        .from('budgets')
        .select('id, user_id, data, updated_at')
        .eq('id', tripId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as ServerBudgetRow;
      if (row.user_id !== userId || row.id !== tripId) return null;
      return row;
    },

    async insertBudget(row) {
      const { error } = await client.from('budgets').insert({
        id: row.id,
        user_id: row.user_id,
        data: row.data,
        updated_at: row.updated_at,
      });
      if (!error) return 'created';
      if (uniqueViolation(error)) return 'conflict';
      return 'error';
    },

    async updateBudget(row) {
      const { data, error } = await client
        .from('budgets')
        .update({ data: row.data, updated_at: row.updated_at })
        .eq('id', row.id)
        .eq('user_id', row.user_id)
        .select('id')
        .maybeSingle();
      if (error) return 'error';
      return data ? 'updated' : 'missing';
    },

    async deleteBudget(tripId, userId) {
      const { error } = await client
        .from('budgets')
        .delete()
        .eq('id', tripId)
        .eq('user_id', userId);
      if (error) return 'error';
      return 'deleted';
    },
  };
}

const requireOwnedUser = async (
  tripId: string,
  gateway: TripBudgetGateway,
): Promise<{ userId: string } | { message: string; forbidden?: boolean }> => {
  const userId = await gateway.getAuthenticatedUserId();
  if (!userId) return { message: friendlyForbidden, forbidden: true };
  const owned = await gateway.tripIsOwned(tripId, userId);
  if (!owned) return { message: friendlyForbidden, forbidden: true };
  return { userId };
};

const adoptServerRow = (
  tripId: string,
  row: ServerBudgetRow,
  local: BudgetLocalStore,
): { budget: CustomBudget; updatedAt: string } | { error: string } => {
  const budget = sanitizeBudgetDocument(row.data);
  if (!budget) return { error: friendlyLoadError };
  const updatedAt = typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : isoNow();
  writeBudgetCache(tripId, budget, { updatedAt, source: 'server' }, local);
  return { budget, updatedAt };
};

const toHydratedServer = (
  adopted: { budget: CustomBudget; updatedAt: string },
  imported: boolean,
): HydrateTripBudgetResult => ({
  ok: true,
  kind: 'server',
  budget: adopted.budget,
  source: 'server',
  imported,
  configured: true,
  updatedAt: adopted.updatedAt,
});

export async function hydrateTripBudget(input: {
  tripId: string;
  mode: 'server' | 'local';
  gateway?: TripBudgetGateway;
  local?: BudgetLocalStore;
}): Promise<HydrateTripBudgetResult> {
  const local = input.local ?? browserBudgetLocalStore;
  const tripId = input.tripId;
  if (!tripId) return { ok: true, kind: 'none', budget: null, source: 'none', imported: false, configured: false };

  if (input.mode === 'local') {
    const localBudget = readLocalBudgetDocument(tripId, local);
    if (!localBudget) {
      return { ok: true, kind: 'none', budget: null, source: 'none', imported: false, configured: false };
    }
    const meta = parseJson(local.getItem(budgetMetaKey(tripId))) as BudgetStorageMeta | null;
    const updatedAt = meta?.updatedAt && typeof meta.updatedAt === 'string' ? meta.updatedAt : isoNow();
    writeBudgetCache(tripId, localBudget, { updatedAt, source: 'local' }, local);
    return {
      ok: true,
      kind: 'local',
      budget: localBudget,
      source: 'local',
      imported: false,
      configured: true,
      updatedAt,
    };
  }

  const gateway = input.gateway ?? createSupabaseBudgetGateway();
  const auth = await requireOwnedUser(tripId, gateway);
  if ('message' in auth) {
    return {
      ok: false,
      kind: auth.forbidden ? 'forbidden' : 'error',
      message: auth.message,
    };
  }

  let serverRow: ServerBudgetRow | null;
  try {
    serverRow = await gateway.readBudget(tripId, auth.userId);
  } catch {
    const cached = readLocalBudgetDocument(tripId, local);
    if (cached) {
      writeBudgetCache(tripId, cached, { updatedAt: isoNow(), source: 'cache-fallback' }, local);
      return {
        ok: true,
        kind: 'cache-fallback',
        budget: cached,
        source: 'cache-fallback',
        imported: false,
        configured: false,
        updatedAt: isoNow(),
      };
    }
    return { ok: false, kind: 'error', message: friendlyLoadError };
  }

  if (serverRow) {
    const adopted = adoptServerRow(tripId, serverRow, local);
    if ('error' in adopted) return { ok: false, kind: 'error', message: adopted.error };
    return toHydratedServer(adopted, false);
  }

  if (wasCleared(tripId, local)) {
    invalidateLocalBudget(tripId, local, { markCleared: true });
    return { ok: true, kind: 'none', budget: null, source: 'none', imported: false, configured: false };
  }

  const legacy = readLocalBudgetDocument(tripId, local);
  if (!legacy) {
    return { ok: true, kind: 'none', budget: null, source: 'none', imported: false, configured: false };
  }

  const createdAt = isoNow();
  const inserted = await gateway.insertBudget({
    id: tripId,
    user_id: auth.userId,
    data: legacy,
    updated_at: createdAt,
  });

  if (inserted === 'created' || inserted === 'conflict') {
    const authoritative = await gateway.readBudget(tripId, auth.userId);
    if (authoritative) {
      const adopted = adoptServerRow(tripId, authoritative, local);
      if ('error' in adopted) return { ok: false, kind: 'error', message: adopted.error };
      return toHydratedServer(adopted, inserted === 'created');
    }
    if (inserted === 'conflict') {
      return { ok: false, kind: 'error', message: friendlyLoadError };
    }
  }

  if (inserted === 'error') {
    writeBudgetCache(tripId, legacy, { updatedAt: createdAt, source: 'cache-fallback' }, local);
    return {
      ok: true,
      kind: 'cache-fallback',
      budget: legacy,
      source: 'cache-fallback',
      imported: false,
      configured: false,
      updatedAt: createdAt,
    };
  }

  return { ok: false, kind: 'error', message: friendlyLoadError };
}

export async function saveTripBudget(input: {
  tripId: string;
  budget: CustomBudget;
  mode: 'server' | 'local';
  gateway?: TripBudgetGateway;
  local?: BudgetLocalStore;
}): Promise<SaveTripBudgetResult> {
  const local = input.local ?? browserBudgetLocalStore;
  const budget = sanitizeBudgetDocument(input.budget);
  if (!budget) return { ok: false, message: friendlySaveError };
  const tripId = input.tripId;
  if (!tripId) return { ok: false, message: friendlySaveError };

  if (input.mode === 'local') {
    const updatedAt = isoNow();
    writeBudgetCache(tripId, budget, { updatedAt, source: 'local' }, local);
    return { ok: true, budget, source: 'local', updatedAt, conflict: false };
  }

  const gateway = input.gateway ?? createSupabaseBudgetGateway();
  const auth = await requireOwnedUser(tripId, gateway);
  if ('message' in auth) return { ok: false, message: auth.message };

  const updatedAt = isoNow();
  const row: ServerBudgetRow = {
    id: tripId,
    user_id: auth.userId,
    data: budget,
    updated_at: updatedAt,
  };

  const existing = await gateway.readBudget(tripId, auth.userId);
  if (existing) {
    const updated = await gateway.updateBudget(row);
    if (updated !== 'updated') return { ok: false, message: friendlySaveError };
    const authoritative = await gateway.readBudget(tripId, auth.userId);
    if (!authoritative) return { ok: false, message: friendlySaveError };
    const adopted = adoptServerRow(tripId, authoritative, local);
    if ('error' in adopted) return { ok: false, message: friendlySaveError };
    return { ok: true, budget: adopted.budget, source: 'server', updatedAt: adopted.updatedAt, conflict: false };
  }

  const inserted = await gateway.insertBudget(row);
  if (inserted === 'conflict') {
    const concurrent = await gateway.readBudget(tripId, auth.userId);
    if (!concurrent) return { ok: false, message: friendlySaveError, conflict: true };
    const adopted = adoptServerRow(tripId, concurrent, local);
    if ('error' in adopted) return { ok: false, message: friendlySaveError, conflict: true };
    return { ok: true, budget: adopted.budget, source: 'server', updatedAt: adopted.updatedAt, conflict: true };
  }
  if (inserted !== 'created') return { ok: false, message: friendlySaveError };

  const authoritative = await gateway.readBudget(tripId, auth.userId);
  if (!authoritative) return { ok: false, message: friendlySaveError };
  const adopted = adoptServerRow(tripId, authoritative, local);
  if ('error' in adopted) return { ok: false, message: friendlySaveError };
  return { ok: true, budget: adopted.budget, source: 'server', updatedAt: adopted.updatedAt, conflict: false };
}

export async function clearTripBudget(input: {
  tripId: string;
  mode: 'server' | 'local';
  gateway?: TripBudgetGateway;
  local?: BudgetLocalStore;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const local = input.local ?? browserBudgetLocalStore;
  const tripId = input.tripId;
  if (!tripId) return { ok: false, message: friendlyClearError };

  if (input.mode === 'local') {
    invalidateLocalBudget(tripId, local, { markCleared: true });
    return { ok: true };
  }

  const gateway = input.gateway ?? createSupabaseBudgetGateway();
  const auth = await requireOwnedUser(tripId, gateway);
  if ('message' in auth) return { ok: false, message: auth.message };

  const deleted = await gateway.deleteBudget(tripId, auth.userId);
  if (deleted === 'error') return { ok: false, message: friendlyClearError };
  invalidateLocalBudget(tripId, local, { markCleared: true });
  return { ok: true };
}
