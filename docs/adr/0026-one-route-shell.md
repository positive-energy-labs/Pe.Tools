# One route shell: the manifest is the graph

Date: 2026-10-29. Status: accepted. kaitpw ruled "yes to all 9" on the contact sheet of this thread (f3440d56). Evidence lineage: `.artifacts/runs/shell-census-20261029/` (six census lines) and `.artifacts/runs/shell-muse-20261029/` (ten muse lines, five cross-examiners); the sheet is `SHEET.md` there. All claims are source-read, not run.

## Context

Every web route re-owns the same coordination: reading acquisition in its own `host.ts`, pending-edit and revision reconciliation, a History renderer, a view bridge, hand-drawn verb rows, hand-bound chords. `RouteManifest` is a bag: `stages` are words, `StageDecl` is a separate map, `manifest.views` is declared and never mounted by `RouteShell`. Actions take one fixed input, so row-scoped verbs are hand-rolled outside consent, the log and Pea. Six routes rebuild their manifest inside the component to reach local state. `host/client.ts` is exported and eight route files call the host directly. The /sheets prototype sat under the real `Situation` and bypassed everything below the head; the `protoui` mounting law told it to.

Two kernels exist: `entityRoute` plus `EntityRouteView` (families, family, schedules) and the ducts path (hand-authored `Situation` plus kit `TeachingLayout`). Neither can declare the other's routes.

## Decision

One typed TypeScript manifest per route is the whole declaration. The kernel mounts everything from it. A generated JSON projection, hashed with the module for Pods, is what Pea and the catalog read; the shell refuses to mount a route whose live manifest disagrees with the stored projection. Route files stay as thin TanStack adapters.

- **Graph.** Stages gate leaves of one declared layout tree. A stage names its verbs by placement, its readings, its chords and its teaching. A route may declare `pick: false` so its stages are an order Pea advances, not a control a person picks.
- **Verbs.** Two kinds. A `workVerb` is subject-scoped, acknowledged by Work and carries its inverse. A `commandVerb` is host-bound and declares `review: none | shown | required`. A human never skips `shown`; Pea may skip `shown` and never `required`. A placement is a function from row to verbs; one schema per verb. Cell edits are named `workVerb`s with chord, teaching and activity identity. The kernel owns take, reject, reopen and delete on every proposable cell.
- **Readings.** A kernel graph with typed source adapters: `use`, `derive`, `worker`, `port` (a live service session, no host receipt) and `feed` (a reading plus a log sink). The browser view lease stays separate. Routes do not call the host; one `ts/tests/repo-guards` test enforces one host door.
- **Layout.** One grammar (kit `PaneSplit` and `TeachingLayout`), one declared tree per route with conditional gates, presets for left and right sidebars around a main area. Topology stays per route. The tutorial is generated from the tree and measured geometry. Pane folds are device state, never in a link (re-openable).
- **Keys.** `action.chord` is the only chord field; `StageDecl.keys` and the `Situation` `chords` prop go. Every pane is a key scope. Mod+K is the focused pane's navigator with a URL-addressed fallback; Mod+Shift+K is everywhere. The thread list stays the one thread navigator.
- **State and URL.** Page fields declare a role; the role sets URL presence, push or replace, share exclusion and Pea access by default. Authored inputs with no document (grilles' rows) are Work. A tab is its link; the host stores no Page document. Hosted panes and standalone routes share one body with the URL as an optional projection.
- **Undo.** One inverse-patch journal per Work at the one write path (`route-work.ts`). A verb press marks the step. Ctrl+Z reverts only the person's own edits; Pea's edits are not steps. Back walks the URL; Ctrl+Z never does.
- **Timeline.** One narrow append-only log of verb invocations, receipts and checkpoints, recorded apart from Work revisions. It is the undo barrier source and the History source. It is not an event-sourced route.
- **Snapshot.** An immutable checkpoint is address plus authored inputs plus reading versions, host-filed by hash, opened read-only at `?at=`. One History renderer replaces the per-route ones.
- **Seed and cutover.** `entityRoute` minus its entity-specific parts is the kernel; entity survives as a preset. The ducts `TeachingLayout` renderer is kept; its consumer is not. Two kernels run side by side on a worktree with a CI count of old-kernel imports that only decreases. Order: `agent-contracts` route skeleton first, then duct-loss, ducts with the sheet stage, schedules, families, family, rooms, helpers. A declaration is at most 60 lines; bodies are uncapped and hold no coordination.
- **protoui.** A variant is a manifest-declared pane body or layout mounted by the same instance. It never replaces kernel, head, target, owners, acquisition or admission. New verbs, readings, keys or subjects enter the manifest first. If the manifest cannot express it, report the missing seam before any workaround.

Rejected as whole paradigms: JSON-only manifest, event-sourced route, host-side query graph, state machine, spreadsheet, Page as route, route as MCP server, state in the `.rvt`. Reasons are in `J-founder.md` and `X5-founder.md`.

- **Values resolve through declared layers** (amended 2026-10-29, reworded 2026-10-30). A value comes from the first layer that has it: run input → Work → model store (for ducts, `_PE_DuctLosses`) → firm file → engine default. Each resolved value carries its source. Anything that decides a computed result belongs to a shared layer (Work, model store or firm), never to one person: two engineers price the same thing the same way. A `setting` field role (`url: false`, `share: false`, `agent: "set"`) holds per-user view state only. The host persists it per user per route; the kernel renders it in the chrome Settings popover; `/settings` lists every registered graph's settings. No route reaches the chrome through a slot (`PrimaryRouteControls slot="settings"` is deleted).

## Kernel laws (2026-10-30, kaitpw: "super bullish")

Distilled from three cutover waves. Every purge round is organised by law, not by route.

- **D1. Routes declare; the kernel executes.** Route code that sequences host calls, Work, the URL or keys is a kernel gap, not route code.
- **D2. Every effect is a verb; every read is a reading or a query verb.** Nothing happens on arrival unless a reading declares demand. UI iteration without Revit goes through ONE kernel fixture lane (one URL spelling for every route): the graph declares its seeds, the kernel swaps sources for a fixture host with an in-memory Work store, and nothing writes real Work. Per-route demo lanes are deleted.
- **D3. One identity per thing.** One Work identity and one journal per stored Work, however a reader spells its key. One graph per route: the manifest is the graph, and registries are fed from graphs.
- **D4. Unknown is not old.** Resetting, discarding or overwriting needs positive proof of age and ownership. Anything unproven refuses (2026-10-29: a host with a lagging schema reset another branch's cloud Work).
- **D5. Intent survives refusal.** A refused or stale press keeps its input for retry or discard. Nothing a person entered is dropped silently.
- **D6. Four homes for state:** Page (shareable view), Work (the result being built), layered values (above), and per-user settings (view state only). Any other state is a smell.
- **D7. Every migration ships a ratchet** (a baseline that can only shrink). A red `kernel gap:` test is the only accepted marker for a missing primitive.
- **D8. A route is done when it is proven live in its real use, not when its tests pass.** The proof names its custody (whose host, whose document) and is driven by the people or threads who use that route for real. Deterministic green is a precondition, not proof.

## Consequences

Supersedes the 2026-09-15 design-system rejection of a common pane layout, for declaration and grammar only; topology stays per route. Supersedes the `SURFACE-PHILOSOPHY.md` candidate law that a route owns its host calls. Amends ADR 0024: preview stays optional per verb through `review: none`, and a human never skips a declared review. Reconciles the 2026-10-20 ducts no-stage-picker ruling with the running route through `pick: false`.

Step 0 spikes, 2026-10-29 on `t3/route-shell` (`.artifacts/runs/shell-close-20261029/`): the families A→B→A race is FALSIFIED (`families/read-ownership.test.ts`, red): a reading attempt must be keyed by target, Work identity and an unreused attempt generation checked on every delivery path. The Work write path is FALSIFIED for undo (`route/work-journal.test.ts`, red): a write is `{ patches, expectedRevision, press }`, the host stamps `by`, the acknowledgement names accepted forward and inverse paths, and a `restore` write kind preserves provenance. A manifest-built route beside the generated file routes is PROVEN (`route/shell-probe.test.ts`): `createRoute` plus `addChildren` on the original root; the generator leaves `routeTree.gen.ts` alone.

Owed before cutover: the two red tests above turn green on the kernel; a per-Work host journal if undo must survive reload; browser hydration of a manifest-built route.
