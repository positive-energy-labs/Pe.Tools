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

## Phase 2 frontier — route-state demiurge (round 1, 2026-08-31)

Inputs: `.artifacts/runs/route-census-20260831/report.md`,
`.artifacts/handoffs/2026-08-31-pane-hotkeys-implications.md`, DOM-perf census MasterTable ruling.

Nouns (first principles): **lane** (live|fixture; today two spellings), **binding**
(none|document|world; today 9 `RouteDocument` sites, one hand-rolled world gate, `/data-tables`
ungated with live writes), **route document** (server-owned slice, SDK `RouteStateSpec`, LAW),
**verbs** (busy/failure/receipt core), **feeds** (`TimedRead` provenance), **view state**
(atoms-vs-useState split), **address** (URL schema; 7 routes validate `thread` and never read it),
**workspace** (4 composition families; two pane files `components/lang/pane.tsx` and
`components/ui/pane.tsx`), **shortcuts** (2 APIs, 4 Escape guard policies, 1 unguarded).
Legacy nouns that may not survive: `workbench/` as home for route plumbing; `anatomy/Workspace`
wrapper that sometimes renders no `PaneWorkspace`.

Shapes on the table (verdict owed, re-openable):

- S1 prose+patch: document the pattern, fix gate/param bugs, change no structure.
- S2 route shell: one `defineAppRoute({ address, binding, store, workspace, shortcuts })` deep
  module; shell owns lane, gate, store lifecycle, workspace, keyboard; `route-guard.test.ts`
  enforces; routes become declarations. Recommended.
- S3 routes-as-data: scaffolding generated from `RouteStateSpec`; only the 9 spec-backed routes
  fit; deferred-compatible with S2.
- S4 store-first canon: bless the domain-store pattern, migrate the three `useRouteState` routes
  into it, leave layout/URL/keyboard free. Argued against: canonizes the heaviest boilerplate and
  settles one axis of five.

Round-1 spike (`spike/route-shell` worktree, report
`.artifacts/runs/route-shell-spike-20260831/report.md`): S2's binding/lane/URL/store half held on
`/schedule-grid` and `/grilles` with no friction; the layout-slot half FALSIFIED — neither route's
real layout is a `PaneWorkspace` (it requires `visual`, lacks `header`), so mandating slots is a
redesign in refactor clothes. S2 splits: S2a = shell without layout (live candidate), S2b = slots
(deferred until the pane primitive grows `header` and optional `visual`; phase-3/4 work). New
candidate S5 from `/instances`: `binding` as an ordered resolver pipeline (world resolves before
document, resolved values land in ctx). Known holes staked by the spike: `workbench/route-state.tsx` welds store creation to the
hook (module-private factory, had to be copied); `Lane` member `"read"` is silently treated as
live in gate ordering.

Round-2 spike (`/instances` on resolvers): all five unmodified `-instances` tests pass, gate-as-
last-resolver held, `AddressedInstancesPage` deleted outright. But the builder refuses a freeze
with one root defect named: **the shell fixes the hook list at define time while lanes and stores
are decided at mount time** — three frictions (lane branches in every resolver, per-lane hooks
smuggled as `store.read()`, per-render ctx vs per-mount store) are that defect in different
clothes. Take forward, in order: 1. `documentResolver` + notYet/chrome/identity contract
(converged), 2. lane becomes a resolver carrying `reachesHost` capability, not a string (forced by
evidence), 3. only then rule whether the store belongs in the shell at all. `ctx.resolved` typing
(`Partial<R>`, needs a builder chain) is the largest correctness gap. `/instances` has no
fixture-lane test. Side finding, proven on main: `instances/fixture.tsx` has 6 type errors since
the beta.132 contract cutover (`TODO(sdk-beta132)` at the site).

## Laws for this effort

- The SDK contract is fixed; only web-side state shape changes (LEDGER Decided 2026-08-31).
- Real legwork is delegated; this session orchestrates.
- Greppable markers over memory: `TODO:` owed-in-code, `SHIM:` stand-in with replacement condition.
