# Merge + demiurge map (live effort, opened 2026-08-31)

Delete this file when phase 5 completes. Verdicts live in `LEDGER.md` Decided (2026-08-31 lines).

## Phases

| # | Work | Proof | State |
|---|---|---|---|
| 0 | Commit `review/design-system` dirty restoration tail | commit `9a5a571` | done |
| 1 | Merge main → `review/design-system`. Main wins SDK/session-census semantics (`workbench/route-document.tsx`, `workbench/world.tsx`, `host/fleet.ts`, `state/route-store.ts`); design-review wins style. Land on main once proven | done: merge `0632f72`, ratchet recording `31f5d93`, main fast-forwarded to `31f5d93`. Evidence: `.artifacts/runs/merge-20260831/report.md`. Browser lane: `/chat`, `/takeoffs?source=fixture`, `/family?source=fixture`, `/instances` all render; only red is the honest no-host `/host/status` 500. Deviation from the proof bar: 8 repo-guard failures remain on main — all evidenced pre-existing at `86e2e8e`, none merge-caused; phase 4 pays them | done |
| 2 | Route-state demiurge. Inputs: phase-1 conflict sites, `spike/takeoffs-pane-hotkeys` implications, MasterTable atom-granularity ruling from the DOM-perf census | done: converged on S2a-core (LEDGER Decided 2026-08-31); two spike rounds on `spike/route-shell`, three routes ported, reports in that worktree's `.artifacts/runs/route-shell-spike-20260831/`. Owed to phase 3/4: canon `app-route/` build + `apps/web/AGENTS.md` route pattern + route guard, landed with the first important-route cutover | done |
| 3 | Design-system distillation + moderncss standards, encoded into `design-guard.test.ts` and `design-adherence.test.ts` | done: seven rounds on 2026-08-31 (`2a75f94`…`d8df6df`); laws in LEDGER Decided and `apps/web/AGENTS.md`; guards 8 → 3 reds, meaning allowlist 197 → 2, rawMeaningColor 0, browser-default text 0, theme single-sourced via light-dark() | done |
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

## Phase 3 frontier — meaning-system demiurge (round 1, 2026-08-31)

Input: `.artifacts/runs/meaning-census-20260831/report.md` (intent census of all 4 guard
populations, reproduced exactly against the guard's own AST/regexes).

Round-1 findings, evidence-backed:

- The 197-site debt is not 197 problems. 126 sites are ONE intent: a directional hairline on a
  row/band that already has an owner (`Section`/`Pane`/`ArtifactFrame` cannot cover it without
  wrapper DOM). 32 are surface/elevation. 23 are guard scope false positives (typography, `sr-only`,
  focus-reset counted as "meaning, fill and stroke").
- The guard itself is buggy: the inline regex's optional quote backtracks, so all 11 literal
  `transparent`/`inherit` values are counted despite the lookahead
  (`design-adherence.test.ts:107`); the opacity regex counts animation keyframes as dimming.
- Forever-exceptions confirmed: runtime data-viz series, source-provided RGB, SVG ghost/keyframe
  opacity, the token specimen. These belong in a legitimate allowlist, not debt.

Shapes on the table (verdict owed):

- M1 vocabulary extension: add the missing roles (directional hairline, surface-role-on-slot,
  inline status mark, selectable-row state, source-provenance tone) as registered authored
  classes; fix the guard regexes; ratchet honestly. Recommended core.

Round 2 (2026-08-31, `2a75f94`): PROVEN[deterministic, main checkout, 2a75f94, 2026-08-31] and
verified on a clean line. Guard reds 8 → 5. The three classifier bugs fixed, each with a
regression fixture. A positive color-role filter replaced the inverse `AUTHORING` population
(197 → 104 true meaning sites). Twelve `hairline-{t,b,l,r,x,y}[-2]` roles registered in
`design-lang.css`; 17 exact 1px migrations in the three heaviest files; 87 is the first honest
stored meaning baseline. Deliberately unmigrated: 0.5px lane rules, the 2px inspector boundary,
the caution edge — the 1px role would change their computed border. Report:
`.artifacts/runs/meaning-round2-20260831/report.md`.
- M2 modern-CSS recanonization: call sites express state via data attributes; `@layer`ed language
  CSS owns all color (`light-dark()`, `oklch()` roles). Deeper module; candidate mechanism for M1's
  roles rather than a competing whole.
- M3 guard-first only: fix regexes and scope, migrate to existing components, add nothing.
  FALSIFIED for the hairline intent — the census proves existing components structurally cannot
  cover it.
- M4 wrapper mandate: everything through `Section`/`Pane`. FALSIFIED — fixed DOM topology is the
  reason the debt exists.

Typography ground (2026-08-31, `a49fddd`): PROVEN[browser, herdr dev server :3001, a49fddd,
2026-08-31]. `[data-pe] body` now sets the value tier (`base.css:135-136`); 11 browser-default
text offenders → 0 across 13 route states with zero explicit-tier fixes needed. The check is
`vp run --no-cache @pe/web#type-sweep -- <baseUrl> <routes...>` (`apps/web/scripts/type-sweep.mjs`),
browser-lane. Report: `.artifacts/runs/type-ground-20260831/report.md`.

Round 4 planned (state-attribute convention, the M2 mechanism folded into M1): promote
`data-tone` from a `FactChip` incidental (`components/lang/chip.tsx:71`) to a language-wide
convention. Language CSS styles the closed tone set `{meta, caution, done, alarm, commit, nav,
pea}` at two intensities: `[data-tone=x]` sets ink only; `[data-tone=x][data-wash]` adds the
tinted fill + border from ONE canonical alpha recipe (today `cap.tsx:72-75` hand-mixes /50 /12
vs /55 /10). Selection ground rides `aria-selected`/`aria-expanded`/`[data-selected]`, never
`token("select")` at call sites. Spike files: `workbench/world/cap.tsx` (wash),
`takeoff/room-panel.tsx` (ink), `family/workspace-doc-pane.tsx` (pea),
`targeting/kit/picker.tsx` (selection), `family-review/proto-editor/composed-params.tsx`
(provenance `SOURCE_TONE`). Expected kill: the `rawMeaningColor` red (30 sites). Runs on the
scout line after the typography round lands, same tree.

light-dark() collapse (2026-08-31, `spike/light-dark` @ `4eb2b7f`):
PROVEN[browser, worktree :3010, 4eb2b7f, 2026-08-31]. All 23 dual-theme tokens collapsed into
single `light-dark()` declarations, net −20 LOC in `base.css`; guards unchanged at 5 reds.
Twelve computed-value spot checks equal against git-pinned old literals in both themes,
verified through the real theme mechanism (class + inline `colorScheme`,
`theme-toggle.tsx:26`; the CSS `color-scheme` rules cover the pre-hydration window). The 15
`dark:` Tailwind variants in `components/lang/` are out of scope and still ride the `.dark`
class. Merge to main owed, after the tone round lands (one writer per tree). Report:
`Pe.Tools-light-dark/.artifacts/runs/light-dark-20260831/report.md`.

Round 4 (2026-08-31, `e099dc7`): PROVEN[deterministic+browser, main checkout, e099dc7,
2026-08-31], verified on a clean line (98/101). The tone attribute convention shipped:
`lang.css` owns `[data-tone={alarm,caution,done,commit,nav,pea}]` ink,
`[data-tone][data-wash]` canonical fill (0.5px currentColor 55% border, 10% fill into
`--pe-on`), and the select ground on `aria-selected/aria-expanded/aria-pressed/data-selected`,
with an SVG fill projection. `rawMeaningColor` 30 → 0 with a 0 baseline; inlineColor 145 → 131;
meaning allowlist 87 → 75; guards 5 → 3 reds. One intentional visual delta: the cap wash
recipes unified. New guard: invalid `data-tone` values rejected. Report:
`.artifacts/runs/tone-attr-20260831/report.md`.

light-dark merge (2026-08-31): `spike/light-dark` merged to main clean (`base.css` auto-merge,
−20 LOC), guards still 3 reds, and the composition proven in the harness preview on merged
main: `data-tone=alarm` ink equals `--pe-alarm` through `light-dark()` in both themes. The
worktree, branch, and themer session are retired; the report copy is at
`.artifacts/runs/light-dark-20260831/report.md`.

Round 5 t-value sweep (2026-08-31, `ab22ea4`): PROVEN[browser+deterministic, main checkout,
ab22ea4, 2026-08-31], verified (98/101, 3 reds). Of 74 authored `t-value` lines, 37 deleted in
14 files, 37 kept in 22 files. The kept map is the finding: nearly all component-level keeps
are shadow-defense against `t-caption` swatch/tooltip regions — component recipes PIN their
tier so the component reads identically in any region; route-level restatements were the shims
and are gone. The probe (`type-sweep.mjs --probe-t-value`) removes each DOM `t-value`, diffs
computed size/leading, restores, and prints SAME or LOAD with the shadowing ancestor. The
typography law re-swept clean on all 24 route/interaction modes. Report:
`.artifacts/runs/tvalue-sweep-20260831/report.md`.

Emergent law candidate for the ledger when phase 3 closes: tiers are pinned at the component
recipe, defaulted at the body, and RESTATED nowhere.

Round 6 hairline continuation (2026-08-31, `5bab47b`): PROVEN[deterministic+browser, main
checkout, 5bab47b, 2026-08-31], verified (93/96 — the suite shrank by 5 because
`design-guard.test.ts:1089` registers one staleness test per allowlisted file and 5 files
drained to zero; benign, confirmed by name-diffing old vs new test registration). Allowlist
75 → 48 via 27 hairline migrations; `hairline-rows` added (six `divide-y divide-line` sites
forced it; no `-2` variant, no site existed). Residue fully classified: 30 surface/elevation
(deferred bucket, verdict owed), 18 named structural exceptions (16 excluded border shapes,
1 legacy caution gradient, 1 `on-select` propagation), 0 data-viz, 0 unclassified. Report:
`.artifacts/runs/hairline-cont-20260831/report.md`.

Round 7 surface roles (2026-08-31, `d8df6df`): PROVEN[deterministic+browser, main checkout,
d8df6df, 2026-08-31], verified (73/76). Allowlist 48 → 2 (both deliberate, `TODO(design)`
comments at `family/workspace-table.tsx:53,56`). Shipped: `data-surface` with `--pe-on`
propagation and SVG fill projection; `hairline-{t,b,l,x,y}-faint`; `boundary-{t,l}`; a guard
fixture rejects invalid surfaces. Phase 3 closed — next is phase 4, opening with a density
protoui on the takeoffs/family fixture lanes.

## Laws for this effort

- The SDK contract is fixed; only web-side state shape changes (LEDGER Decided 2026-08-31).
- Real legwork is delegated; this session orchestrates.
- Greppable markers over memory: `TODO:` owed-in-code, `SHIM:` stand-in with replacement condition.
