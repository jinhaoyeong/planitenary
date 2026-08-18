import { describe, expect, it } from 'vitest';
import {
  budgetBackupKey,
  budgetClearedKey,
  budgetStorageKey,
  clearTripBudget,
  hydrateTripBudget,
  readBudgetAuthority,
  readLocalBudgetDocument,
  saveTripBudget,
  writeBudgetCache,
  type BudgetLocalStore,
  type ServerBudgetRow,
  type TripBudgetGateway,
} from './tripBudget';
import {
  productionShapedBudgetFixture,
  sanitizeBudgetDocument,
  type CustomBudget,
} from '../../supabase/functions/_shared/budgetDocument';
import { summarizeBudgetFacts } from '../../supabase/functions/_shared/budgetFacts';
import { deriveSmartActions } from '../../supabase/functions/_shared/smartPlannerActions';
import { tripBudgetHint } from './tripBudgetHint';

const TRIP_ID = 'trip-f5262604-cb74-4d39-af90-0d8a233c9906';
const OWNER = 'user-owner';
const OTHER = 'user-other';

const memoryLocal = (): BudgetLocalStore & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
};

const memoryGateway = (input: {
  userId: string;
  owned: string[];
  rows?: ServerBudgetRow[];
}): TripBudgetGateway & {
  rows: Map<string, ServerBudgetRow>;
  inserts: ServerBudgetRow[];
  updates: ServerBudgetRow[];
  reads: Array<{ tripId: string; userId: string }>;
} => {
  const rows = new Map<string, ServerBudgetRow>();
  for (const row of input.rows ?? []) rows.set(row.id, { ...row });
  const inserts: ServerBudgetRow[] = [];
  const updates: ServerBudgetRow[] = [];
  const reads: Array<{ tripId: string; userId: string }> = [];
  return {
    rows,
    inserts,
    updates,
    reads,
    async getAuthenticatedUserId() {
      return input.userId;
    },
    async tripIsOwned(tripId, userId) {
      return userId === input.userId && input.owned.includes(tripId);
    },
    async readBudget(tripId, userId) {
      reads.push({ tripId, userId });
      const row = rows.get(tripId);
      if (!row || row.user_id !== userId) return null;
      return { ...row };
    },
    async insertBudget(row) {
      inserts.push({ ...row, data: structuredClone(row.data) });
      if (rows.has(row.id)) return 'conflict';
      rows.set(row.id, { ...row, data: structuredClone(row.data) });
      return 'created';
    },
    async updateBudget(row) {
      updates.push({ ...row, data: structuredClone(row.data) });
      const existing = rows.get(row.id);
      if (!existing || existing.user_id !== row.user_id) return 'missing';
      rows.set(row.id, { ...row, data: structuredClone(row.data) });
      return 'updated';
    },
    async deleteBudget(tripId, userId) {
      const existing = rows.get(tripId);
      if (!existing || existing.user_id !== userId) return 'missing';
      rows.delete(tripId);
      return 'deleted';
    },
  };
};

const seedLegacyBackup = (local: BudgetLocalStore, budget: CustomBudget) => {
  local.setItem(budgetBackupKey(TRIP_ID), JSON.stringify(budget));
};

describe('trip budget source of truth', () => {
  it('A. no server + no local → no budget', async () => {
    const local = memoryLocal();
    const gateway = memoryGateway({ userId: OWNER, owned: [TRIP_ID] });
    const result = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(result).toEqual({
      ok: true, kind: 'none', budget: null, source: 'none', imported: false, configured: false,
    });
    expect(gateway.inserts).toEqual([]);
    expect(readBudgetAuthority(TRIP_ID, local)).toBe('none');
  });

  it('B. server exists → server loads', async () => {
    const local = memoryLocal();
    const serverBudget = productionShapedBudgetFixture();
    const gateway = memoryGateway({
      userId: OWNER,
      owned: [TRIP_ID],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: serverBudget, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    const result = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('server');
    expect(result.imported).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.budget).toEqual(serverBudget);
    expect(gateway.inserts).toEqual([]);
    expect(readBudgetAuthority(TRIP_ID, local)).toBe('server');
  });

  it('C. local only → one-time import succeeds', async () => {
    const local = memoryLocal();
    const legacy = productionShapedBudgetFixture();
    seedLegacyBackup(local, legacy);
    const gateway = memoryGateway({ userId: OWNER, owned: [TRIP_ID] });
    const result = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(true);
    expect(result.kind).toBe('server');
    expect(gateway.inserts).toHaveLength(1);
    expect(gateway.inserts[0]?.user_id).toBe(OWNER);
    expect(sanitizeBudgetDocument(gateway.rows.get(TRIP_ID)?.data)).toEqual(legacy);
  });

  it('D. imported server row becomes authoritative', async () => {
    const local = memoryLocal();
    seedLegacyBackup(local, productionShapedBudgetFixture());
    const gateway = memoryGateway({ userId: OWNER, owned: [TRIP_ID] });
    await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(readBudgetAuthority(TRIP_ID, local)).toBe('server');
    expect(readLocalBudgetDocument(TRIP_ID, local)).toEqual(productionShapedBudgetFixture());
    expect(JSON.parse(local.getItem(budgetBackupKey(TRIP_ID)) || 'null')).toEqual(productionShapedBudgetFixture());
  });

  it('E. server + stale local conflict → server wins', async () => {
    const local = memoryLocal();
    const serverBudget = productionShapedBudgetFixture();
    const stale = productionShapedBudgetFixture();
    stale.food.max = 99999;
    stale.expenses = [];
    seedLegacyBackup(local, stale);
    local.setItem(budgetStorageKey(TRIP_ID), JSON.stringify(stale));
    const gateway = memoryGateway({
      userId: OWNER,
      owned: [TRIP_ID],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: serverBudget, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    const result = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.budget).toEqual(serverBudget);
    expect(result.budget?.food.max).toBe(1200);
    expect(gateway.updates).toEqual([]);
    expect(gateway.inserts).toEqual([]);
  });

  it('F. server value refreshes local backup', async () => {
    const local = memoryLocal();
    const serverBudget = productionShapedBudgetFixture();
    const stale = { not: 'a budget', food: { max: 1 } };
    local.setItem(budgetBackupKey(TRIP_ID), JSON.stringify(stale));
    const gateway = memoryGateway({
      userId: OWNER,
      owned: [TRIP_ID],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: serverBudget, updated_at: '2026-08-19T00:00:00.000Z' }],
    });
    await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(JSON.parse(local.getItem(budgetBackupKey(TRIP_ID)) || 'null')).toEqual(serverBudget);
    expect(JSON.parse(local.getItem(budgetStorageKey(TRIP_ID)) || 'null')).toEqual(serverBudget);
  });

  it('G. failed server write does not falsely become authoritative', async () => {
    const local = memoryLocal();
    const serverBudget = productionShapedBudgetFixture();
    const gateway = memoryGateway({
      userId: OWNER,
      owned: [TRIP_ID],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: serverBudget, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    gateway.updateBudget = async () => 'error';
    const edited = productionShapedBudgetFixture();
    edited.misc.max = 50;
    const saved = await saveTripBudget({ tripId: TRIP_ID, budget: edited, mode: 'server', gateway, local });
    expect(saved.ok).toBe(false);
    expect(readLocalBudgetDocument(TRIP_ID, local)).toEqual(serverBudget);
    expect(readBudgetAuthority(TRIP_ID, local)).toBe('server');
    expect(gateway.rows.get(TRIP_ID)?.data).toEqual(serverBudget);
  });

  it('H. successful edit persists server + backup', async () => {
    const local = memoryLocal();
    const serverBudget = productionShapedBudgetFixture();
    const gateway = memoryGateway({
      userId: OWNER,
      owned: [TRIP_ID],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: serverBudget, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    const edited = productionShapedBudgetFixture();
    edited.misc.max = 800;
    const saved = await saveTripBudget({ tripId: TRIP_ID, budget: edited, mode: 'server', gateway, local });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.source).toBe('server');
    expect(saved.budget.misc.max).toBe(800);
    expect(sanitizeBudgetDocument(gateway.rows.get(TRIP_ID)?.data)?.misc.max).toBe(800);
    expect(JSON.parse(local.getItem(budgetBackupKey(TRIP_ID)) || 'null')).toMatchObject({ misc: { max: 800 } });
  });

  it('I. clear/reset cannot resurrect stale backup', async () => {
    const local = memoryLocal();
    const serverBudget = productionShapedBudgetFixture();
    const gateway = memoryGateway({
      userId: OWNER,
      owned: [TRIP_ID],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: serverBudget, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    const cleared = await clearTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(cleared.ok).toBe(true);
    expect(gateway.rows.has(TRIP_ID)).toBe(false);
    seedLegacyBackup(local, serverBudget);
    local.setItem(budgetStorageKey(TRIP_ID), JSON.stringify(serverBudget));
    expect(local.getItem(budgetClearedKey(TRIP_ID))).toBeTruthy();
    const revived = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(revived).toMatchObject({ ok: true, kind: 'none', configured: false, imported: false });
    expect(gateway.inserts).toEqual([]);
  });

  it('J. another device without localStorage sees server budget', async () => {
    const ownerLocal = memoryLocal();
    const deviceB = memoryLocal();
    const gateway = memoryGateway({ userId: OWNER, owned: [TRIP_ID] });
    seedLegacyBackup(ownerLocal, productionShapedBudgetFixture());
    await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local: ownerLocal });
    const otherDevice = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local: deviceB });
    expect(otherDevice.ok).toBe(true);
    if (!otherDevice.ok) return;
    expect(otherDevice.imported).toBe(false);
    expect(otherDevice.kind).toBe('server');
    expect(otherDevice.budget).toEqual(productionShapedBudgetFixture());
    expect(deviceB.getItem(budgetStorageKey(TRIP_ID))).toBeTruthy();
  });

  it('K. cross-user read rejected', async () => {
    const local = memoryLocal();
    const ownerBudget = productionShapedBudgetFixture();
    const gateway = memoryGateway({
      userId: OTHER,
      owned: ['trip-other'],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: ownerBudget, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    const result = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('forbidden');
    expect(gateway.reads.some((read) => read.userId === OTHER && read.tripId === TRIP_ID)).toBe(false);
    expect(readLocalBudgetDocument(TRIP_ID, local)).toBeNull();
  });

  it('L. cross-user write rejected', async () => {
    const local = memoryLocal();
    const ownerBudget = productionShapedBudgetFixture();
    const gateway = memoryGateway({
      userId: OTHER,
      owned: ['trip-other'],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: ownerBudget, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    const edited = productionShapedBudgetFixture();
    edited.misc.max = 1;
    const saved = await saveTripBudget({ tripId: TRIP_ID, budget: edited, mode: 'server', gateway, local });
    expect(saved.ok).toBe(false);
    expect(gateway.updates).toEqual([]);
    expect(gateway.inserts).toEqual([]);
    expect(sanitizeBudgetDocument(gateway.rows.get(TRIP_ID)?.data)).toEqual(ownerBudget);
  });

  it('M. invalid local backup not imported', async () => {
    const local = memoryLocal();
    local.setItem(budgetBackupKey(TRIP_ID), JSON.stringify({ ceiling: 900, currency: 'RM' }));
    const gateway = memoryGateway({ userId: OWNER, owned: [TRIP_ID] });
    const result = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(result).toMatchObject({ ok: true, kind: 'none', imported: false });
    expect(gateway.inserts).toEqual([]);
  });

  it('N. concurrent server row appearing during import is not overwritten', async () => {
    const local = memoryLocal();
    const localOnly = productionShapedBudgetFixture();
    localOnly.misc.max = 42;
    seedLegacyBackup(local, localOnly);
    const concurrent = productionShapedBudgetFixture();
    const gateway = memoryGateway({
      userId: OWNER,
      owned: [TRIP_ID],
      rows: [{ id: TRIP_ID, user_id: OWNER, data: concurrent, updated_at: '2026-08-18T00:00:00.000Z' }],
    });
    gateway.readBudget = async (tripId, userId) => {
      gateway.reads.push({ tripId, userId });
      if (gateway.inserts.length === 0) return null;
      const row = gateway.rows.get(tripId);
      if (!row || row.user_id !== userId) return null;
      return { ...row };
    };
    const result = await hydrateTripBudget({ tripId: TRIP_ID, mode: 'server', gateway, local });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(false);
    expect(result.budget?.misc.max).toBe(1000);
    expect(gateway.inserts).toHaveLength(1);
    expect(sanitizeBudgetDocument(gateway.rows.get(TRIP_ID)?.data)?.misc.max).toBe(1000);
  });
});

describe('trip budget intelligence contract', () => {
  it('O. Budget totals and get_budget_summary represent the same data', () => {
    const budget = productionShapedBudgetFixture();
    const facts = summarizeBudgetFacts(budget);
    expect(facts.present).toBe(true);
    expect(facts.currency).toBe('MYR');
    expect(facts.spent).toBe(85);
    expect(facts.plannedCeiling).toBe(2000 + 3000 + 500 + 1200 + 500 + 1000);
    expect(facts.remainingKnownBudget).toBe((facts.plannedCeiling ?? 0) - 85);
  });

  it('P/R. Ask grounding extras read server budget and fail closed when missing', async () => {
    const {
      collectAskGrounding,
      deriveAskGroundingPlan,
    } = await import('../../supabase/functions/_shared/askGrounding');
    const { rehydrateIntelligenceFocus } = await import('../../supabase/functions/_shared/intelligenceContext');
    const itinerary = {
      id: TRIP_ID,
      name: 'Flight Acceptance Test',
      days: [{ day: 1, city: 'Fukuoka', activities: [{ id: 'park', name: 'Ohori Park', type: 'sight' }] }],
    };
    const question = 'What’s left in my budget?';
    const uiContext = { tripId: TRIP_ID, surface: 'budget' as const };
    const plan = deriveAskGroundingPlan({ question, surface: 'budget', uiContext });
    const uiFocus = rehydrateIntelligenceFocus(itinerary, uiContext, TRIP_ID);
    const missing = collectAskGrounding({
      itinerary,
      tripId: TRIP_ID,
      question,
      plan,
      uiFocus,
    });
    expect(plan.required).toContain('budget');
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.missing).toContain('budget');
    expect(missing.detail).toMatch(/haven’t set a trip budget yet/i);

    const present = collectAskGrounding({
      itinerary,
      tripId: TRIP_ID,
      question,
      plan,
      uiFocus,
      extras: { budgetStored: productionShapedBudgetFixture() },
    });
    expect(present.ok).toBe(true);
    if (!present.ok || !present.packet) return;
    expect(present.packet.budget).toMatchObject({
      present: true,
      currency: 'MYR',
      spent: 85,
      plannedCeiling: 8200,
      remainingKnownBudget: 8115,
    });
  });

  it('S. Smart Plan Review budget uses the same server facts, not a stale local peek', () => {
    const local = memoryLocal();
    const stale = productionShapedBudgetFixture();
    stale.expenses = [{
      id: 'stale',
      description: 'stale',
      amountMYR: 8000,
      amountCNY: 0,
      paidBy: 'You',
      category: 'misc',
      date: '2026-08-01T00:00:00.000Z',
    }];
    local.setItem(budgetStorageKey(TRIP_ID), JSON.stringify(stale));
    const hinted = tripBudgetHint(TRIP_ID, null, local);
    expect(hinted.hasBudget).toBe(false);

    writeBudgetCache(TRIP_ID, productionShapedBudgetFixture(), {
      updatedAt: '2026-08-19T00:00:00.000Z',
      source: 'server',
    }, local);
    const serverHint = tripBudgetHint(TRIP_ID, null, local);
    expect(serverHint.hasBudget).toBe(true);
    expect(serverHint.ceilingKnown).toBe(8200);
    expect(serverHint.remainingKnown).toBe(8115);
    const actions = deriveSmartActions({
      itinerary: { days: [{ day: 1, activities: [{ id: 'park', name: 'Park', type: 'sight' }] }] },
      surface: 'budget',
      hasBudget: serverHint.hasBudget,
      budgetCeilingKnown: serverHint.ceilingKnown,
      budgetRemainingKnown: serverHint.remainingKnown,
    });
    expect(actions.map((action) => action.id)).toContain('review-budget');
  });

  it('T/U. known itinerary costs stay numeric and unknown prices stay unknown', () => {
    const facts = summarizeBudgetFacts(productionShapedBudgetFixture(), {
      days: [{
        day: 1,
        activities: [
          { name: 'Castle', type: 'sight', estimatedCost: { amount: 180, currency: 'MYR' } },
          { name: 'Ramen', type: 'food' },
        ],
      }],
    });
    expect(facts.itineraryKnownCosts).toEqual([{ name: 'Castle', amount: 180, currency: 'MYR' }]);
    expect(facts.unknownCostCount).toBe(1);
    expect(facts.spent).toBe(85);
  });

  it('V. no invented RM value path from a missing wallet', () => {
    const facts = summarizeBudgetFacts(null, {
      days: [{ day: 1, activities: [{ name: 'Castle', type: 'sight' }] }],
    });
    expect(facts.present).toBe(false);
    expect(facts.spent).toBeUndefined();
    expect(facts.plannedCeiling).toBeUndefined();
    expect(facts.note).not.toMatch(/\bRM\s*\d/i);
  });

  it('does not ship a browser service-role client', async () => {
    const { readFile } = await import('node:fs/promises');
    const persistence = await readFile(new URL('./tripBudget.ts', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../components/Budget.tsx', import.meta.url), 'utf8');
    expect(persistence).not.toMatch(/SERVICE_ROLE|service_role|serviceRole/);
    expect(ui).not.toMatch(/SERVICE_ROLE|service_role|serviceRole/);
    expect(ui).not.toMatch(/\.upsert\(/);
    expect(persistence).not.toMatch(/\.upsert\(/);
  });
});
