import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260816072254_terminal_bounded_unknown_ai_spend.sql', import.meta.url),
  'utf8',
);

describe('terminal bounded-unknown finalization migration', () => {
  it('makes finalization terminal and idempotent without relabelling unknown cost', () => {
    expect(migration).toContain("attempt_status = 'resolved'");
    expect(migration).toContain('cost_status = p_cost_status');
    expect(migration).toContain('estimated_cost_usd = p_estimated_cost_usd');
    expect(migration).toContain("where id = p_attempt_id and attempt_status in ('reserved', 'unresolved')");
  });

  it('continues charging every non-known terminal row at its full reservation', () => {
    expect(migration).toContain('else reserved_cost_usd');
  });
});
