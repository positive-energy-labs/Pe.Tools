# param-tables ledger

Arbitrary engineering tables (Basis of Design, Figures of Merit) whose values are *linked to parameters on model elements*. Live effort — frontier and round records in [MAP.md](MAP.md).

This ledger also owns its two precedent surfaces, folded in 2026-08-17: `/parameter-links` (the
linkage vocabulary and the doc-owned profile) and `/data-tables` (authored synthetic tables).

## Decided

- 2026-08-17 — The product exists because Revit can do neither half: arbitrary tables aren't a thing (the precedent is "SXL" schedules — Excel pasted into schedule *header cells*: unfilterable, unlinkable, silently stale), and a table value cannot drive a parameter (design facts are retyped into `PE_*` shared params on equipment, and they drift). The acceptance path in every variant is one demo: change heating EWT/LWT in the FOM and the 23 fan coils' `PE_M_PerfHeat_FluidEWT/LWT` update, visibly, in their schedule.
- 2026-08-17 — Round 1 runs on a REAL fixture pulled live from ProjectA_Clone_Aug_11 (`apps/web/src/param-tables/proto/fixture.ts`), not a synthetic one, so honesty problems are forced rather than designed around: FC-1's type genuinely holds heating LWT 90 vs the authored 100, so most variants open with an at-rest drift mark before any edit, and the refused DVWHSA write leaves *residual drift* after apply — refusal is not absorption.
- 2026-08-17 — Three fixture truths no variant may sand off: perf parameters live at **type** scope (one write fans out to sibling instances, and the far side of a bulk verb must be visible before it is enabled); formula-owned targets refuse **per target, with the reason**; and the table is also a **deliverable** that lands on sheet M001 as a print exhibit.
- 2026-08-17 — Precedent vocabulary is inherited, not reinvented: `/parameter-links` owns profile / definition / assignment / relationship / reducer / evaluation / reconcile, evaluation-before-apply, per-issue refusals, and the freshness gate on Apply; `/data-tables` owns name + row-key upsert, txt/num columns, and prune-on-apply. Both of their known confusions (invisible draft/preview/apply state machine, no per-cell unsaved state, invisible destructive prune) are inputs to this round, not things to re-derive.

### Linkage core (`/parameter-links`)

- 2026-08-15 — Profile storage is one versioned JSON blob in a non-visible shared Text param on Project Information, NOT Extensible Storage; malformed data fails closed. ES was rejected as unreadable/unportable for a doc-owned profile.
- 2026-08-15 — The core must not encode MOCP, panel schedules, or any particular family parameter; MOCP→circuit Rating is only the first acceptance case. Generality is the product, the case is the proof.
- 2026-08-15 — Exactly two host ops (`revit.detail.parameter-links`, `revit.apply.parameter-links`) and NO feature-specific MCP tool — one capability, one progressively discoverable path; chat and browser share the vocabulary.
- 2026-08-15 — Evaluation is deterministic and transaction-independent; explicit apply owns its transaction, the process-wide `IUpdater` writes inside Revit's updater context. Keeps the doc-owned lane DA-safe.
- 2026-08-15 — Routes-as-chat-plugins uses ONE generic route-plugin registry, not per-feature tools/transports; parameter-links is the first full inline plugin. Family Types' protocol registration stays chat-only, not a second route-state implementation.
- 2026-08-15 — Explicitly out of scope until MVP evidence exists: hiding host ops, forcing all mutation through routes, shared/office profile libraries, a formula language, migrating every route.
- 2026-08-16 — Design-language sweep landed on `routes/parameter-links.tsx`, `Evaluation.tsx`, `ProfileEditor.tsx`: `AddressingBar` replaces `RouteWorkspaceShell`, raw-palette spends gone, bold=unsaved on changed projected-write cells. `model.ts` untouched (pure model).
- 2026-08-16 — Save-draft wears `commit` blue because saving writes the *shared* document (pea + other tabs see it), even though it never touches Revit. Recorded because two blues now sit one lane apart. (verify — review may reverse this to `act`.)

### Authored synthetic tables (`/data-tables`)

- 2026-08-16 — Per-cell unsaved grammar deliberately not built: the whole draft (name/columns/rows) is unsaved until apply and the route keeps no baseline, so the commit verb is honestly the loudest thing on the page. Only worth building if review wants per-cell honesty on a synthetic table nobody else edits.

## Tried & rejected

- 2026-08-17 — Layouts already discarded by their own audits: `/parameter-links`' definition-card UI (nothing in it says "table") and `/data-tables`' inert value cells (no linkage concept at all). Round 1 rebuilt from the fixture instead of extending either.
- 2026-08-16 — (/parameter-links) A prose subline narrating the preview-freshness gate: it repeated the verb's own reason on the surface and failed the boundary test both ways. Removed; the gate now shows only as Apply's disabled state + title.
- 2026-08-16 — (/parameter-links) Blue `--pe-blue` dot in a Δ column to mark changed projected writes: column deleted, replaced by bold-means-unsaved on the result cell.
- 2026-08-16 — (/data-tables) `hover:text-destructive` on the row/column removers: spent the alarm hue on mere affordance; replaced by neutral ink plus a title reason.

## Owed

- Round-1 verdicts are unruled — five variants (`/param-tables?variant=a..e`) are built, typecheck-clean and browser-verified, awaiting a kaitpw sitting. Nothing is settled law until a round rules it. See [MAP.md](MAP.md).
- Design-language gaps the round proved by independent re-invention (8 items: no mark for a linked value, no fan-out/staged-writes preview primitive, no binding-status axis or station strip, no old→new staged-transition token, no pinned authored band or type-group header row, unruled cross-pane subscriber highlight, receipt surfaces beyond `OutcomeLine`, no cell-scale parameter picker). Route them into the design-system frontier once the round rules.
- Host-op gap is binding: `revit.apply.schedule` writes header-cell text tables and `revit.apply.parameter-links` writes param links, but nothing writes "table + linkage" atomically, and nothing renders an authored grid as a *placeable* exhibit with live cells.
- pin as test: `revit.apply.parameter-links` REFUSES when the reviewed profile carried through the route command no longer matches the live draft — a later agent patch must not be able to silently change a human-reviewed write.
- (/data-tables) No axis says "this apply will *remove* N rows" — a queued destructive write has no grammar. Cheap local fix: derive `pruned = opened rows − draft rows` and label the verb "apply to revit · prunes N".
- (/parameter-links) The local-draft/remote-draft/`syncedRef` co-edit reconcile is hand-rolled and route-local; no primitive owns "co-edited nested document". Root cause of the page-level-unsaved gap (design-system ledger, Owed).
- Route commands read a document, await external work, then replace the whole route document — a concurrent patch during the await is silently overwritten. Needs compare-and-swap revision or a transactional document updater before routes are the default authoring surface.
- The human/agent endpoint split is tool-level policy, not a security boundary — pea's general shell can call localhost directly. A stronger commit capability needs a browser-held approval primitive agent tools cannot mint or replay.
