# Budget source-of-truth — production acceptance

**Verdict: PRODUCTION ACCEPTED, with one recorded process deviation.**
Commit under acceptance: `ef4f6f1` "feat: make trip budget server authoritative".
Run date: 2026-08-19. Trip: Winter in Tokyo `trip-1e307ec2-36d8-44f8-8b72-891edb002a7f`,
owner `f6c86c71-d9f7-4362-91cd-2364f62faf91`.

## Environment

Two Chrome profiles were used, tracked by deviceId because the display names are
misleading and swapped between sessions:

| deviceId | role |
| --- | --- |
| `57aa3a3f-32eb-4ced-8da1-deb22c1c9332` | fresh profile, empty origin storage — all testing |
| `53fd143c-cd54-432a-abe8-a3ce825dc3db` | frozen full-storage evidence profile — never touched |

The original browser reload test is **N/A for this acceptance**: it was blocked by the
independent localStorage-exhaustion defect (see `defects/orphaned-trip-localstorage-cleanup.md`).
That profile was deliberately preserved rather than repaired.

## Results

| Check | Result |
| --- | --- |
| Fresh profile had no Budget cache for the trip beforehand | PASS — zero `budget-*` keys, 19,920 B origin total |
| No multi-MB orphan history in the fresh profile | PASS — largest `-history` 1,292 B |
| Budget loads from server | PASS — `budget-meta` wrote `source: "server"` |
| Configured / spent / remaining | PASS — RM300 / RM50 / RM250 |
| Exactly one owned `public.budgets` row | PASS — second owned row belongs to a different trip |
| No import/create loop | PASS — row `updated_at` unchanged; load was a pure read |
| Smart Plan consumes server Budget facts | PASS — deterministic "Review budget" action |
| Smart Plan AI cost | PASS — ledger delta 0, reserved 0, unresolved 0 |
| Ask budget grounding | PASS |
| Ask factual answer | PASS |
| AI accounting | PASS, +2 calls (see deviation) |
| Legacy local→server import | N/A in production — no eligible owned legacy wallet; local tests pass |

### Server authority evidence

The cache written on first load carried
`{"updatedAt":"2026-08-19T02:26:04.292+00:00","source":"server"}`, matching the
`public.budgets` row's `updated_at` to the millisecond, with a payload byte-consistent
with the row read over SQL. The server row was **not** modified by the load.

### Ask grounding (single question, `OPENAI_MODEL=gpt-5-nano`)

Browser request carried only `tripId`, `question`, and `uiContext.surface = "budget"` —
**no configured, spent, remaining, currency or FX value**. Response:

```
grounding.ok     = true
grounding.scopes = [trip, itinerary, day, budget]
grounding.reads  = { scope: budget, reader: get_budget_summary, provenance: budget }
grounding.missing = []
answer = "Spent: 50 MYR. Remaining known budget: 250 MYR (planned ceiling 300 MYR)."
```

Zero invented USD, CNY, FX rate, category totals, itinerary cost, or extra expenses —
notable because the UI was simultaneously displaying `$74 / $12 / $62` from a client-side
presentation conversion, and none of it leaked into the answer. `amountCNY: 83` exists in
the stored row but is stripped by `get_expenses` before model exposure.

`grounding.facts` does not echo the RM amounts to the client. Accepted: the authoritative
read is represented by `grounding.reads` and the server adapter, and duplicating amounts
into a client diagnostic payload is not required.

## Process deviation — one duplicate paid Ask

Two `agent-ask` calls were made where the procedure allowed one.

| id | tokens | cost USD | status |
| --- | --- | --- | --- |
| 15 | 1893 | 0.00011145 | resolved / known |
| 16 | 1939 | 0.00011410 | resolved / known |

Baseline `max_ledger_id = 14`; counters went global 0→2, user 0→2, trip 0→2;
reserved 0, unresolved 0.

**Cause:** the first Enter submission succeeded asynchronously. The acceptance runner
checked the recorder while the request was still in flight, saw no entry, then saw the
textarea momentarily absent during re-render and inferred the submission had failed. It
reopened the panel and clicked Send, producing a duplicate. The second request body
contained `conversation:[{first answer}]`, which already proved the first had succeeded.

**This is an acceptance-runner error, not product behaviour.** It is not app auto-retry,
not Planitenary generating a duplicate request, not an accounting failure, and not
grounding instability. Both responses were independently successful and returned the same
authoritative result. No corrective third Ask was run — that would reduce discipline, not
increase it.

## State at close

- `OPENAI_MODEL` = `disabled`, digest-verified against `sha256("disabled")`
- Frozen evidence profile untouched
- Storage reliability fix `6d2a78a` remains **local and unpushed**, not deployed, handled separately
