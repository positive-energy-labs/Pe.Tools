# Merge + demiurge map (live effort, opened 2026-08-31)

Delete this file when phase 5 completes. Verdicts live in `LEDGER.md` Decided (2026-08-31 lines).

## Phases

| # | Work | Proof | State |
|---|---|---|---|
| 0 | Commit `review/design-system` dirty restoration tail | commit `9a5a571` | done |
| 1 | Merge main → `review/design-system`. Main wins SDK/session-census semantics (`workbench/route-document.tsx`, `workbench/world.tsx`, `host/fleet.ts`, `state/route-store.ts`); design-review wins style. Land on main once proven | done: merge `0632f72`, ratchet recording `31f5d93`, main fast-forwarded to `31f5d93`. Evidence: `.artifacts/runs/merge-20260831/report.md`. Browser lane: `/chat`, `/takeoffs?source=fixture`, `/family?source=fixture`, `/instances` all render; only red is the honest no-host `/host/status` 500. Deviation from the proof bar: 8 repo-guard failures remain on main — all evidenced pre-existing at `86e2e8e`, none merge-caused; phase 4 pays them | done |
| 2 | Route-state demiurge. Inputs: phase-1 conflict sites, `spike/takeoffs-pane-hotkeys` implications, MasterTable atom-granularity ruling from the DOM-perf census | route-state model and new-route rules recorded in `LEDGER.md` and `apps/web/AGENTS.md` | open |
| 3 | Design-system distillation + moderncss standards, encoded into `design-guard.test.ts` and `design-adherence.test.ts` | each rule has a check that fails when broken | open |
| 4 | Re-cutover chat, takeoffs, family, then families, settings. Per-route clean-room allowed here only. Baselines shrink substantially | per-route visual proof; baseline deltas recorded | open |
| 5 | Nits: 3 owed fixes from `.artifacts/handoffs/2026-08-31-web-dom-perf-census.md`, pane-hotkeys port if adopted, `TODO:`/`SHIM:` harvest | census greps clean | open |

## Laws for this effort

- The SDK contract is fixed; only web-side state shape changes (LEDGER Decided 2026-08-31).
- Real legwork is delegated; this session orchestrates.
- Greppable markers over memory: `TODO:` owed-in-code, `SHIM:` stand-in with replacement condition.
