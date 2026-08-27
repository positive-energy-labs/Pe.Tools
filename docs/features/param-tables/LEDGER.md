# param-tables ledger

Arbitrary engineering tables (Basis of Design, Figures of Merit) whose values are *linked to parameters on model elements*. This ledger records the retired throwaway round and the durable decisions for its `/parameter-links` and `/data-tables` precedents.

This ledger also owns its two precedent surfaces, folded in 2026-08-17: `/parameter-links` (the
linkage vocabulary and the doc-owned profile) and `/data-tables` (authored synthetic tables).

## Decided

- 2026-08-27 — The unlinked throwaway `/param-tables` round was retired unruled after import-graph proof found one closed prototype island with no shipping destination. No product surface or primitive was promoted.
- 2026-08-27 — Historical evidence from the retired round: real project-a evidence opened with at-rest drift and left residual drift after a refused write; type-scoped writes fan out to sibling instances, so the far side of a bulk verb must be visible; formula-owned targets refuse per target with their reason; and the table was also a deliverable intended for sheet M001.
- 2026-08-27 — Historical problem observation: Revit provides neither arbitrary authored tables nor a live table-value-to-parameter linkage. This remains an observation, not a promoted product surface.
- 2026-08-17 — Precedent vocabulary is inherited, not reinvented: `/parameter-links` owns profile / definition / assignment / relationship / reducer / evaluation / reconcile, evaluation-before-apply, per-issue refusals, and the freshness gate on Apply; `/data-tables` owns name + row-key upsert, txt/num columns, and prune-on-apply. Their current ledgers own their remaining confusions and repair work.

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

- 2026-08-17 — Layouts already discarded by their own audits: `/parameter-links`' definition-card UI (nothing in it says "table") and `/data-tables`' inert value cells (no linkage concept at all). The throwaway round rebuilt from the fixture instead of extending either, then ended without a product ruling.
- 2026-08-16 — (/parameter-links) A prose subline narrating the preview-freshness gate: it repeated the verb's own reason on the surface and failed the boundary test both ways. Removed; the gate now shows only as Apply's disabled state + title.
- 2026-08-16 — (/parameter-links) Blue `--pe-blue` dot in a Δ column to mark changed projected writes: column deleted, replaced by bold-means-unsaved on the result cell.
- 2026-08-16 — (/data-tables) `hover:text-destructive` on the row/column removers: spent the alarm hue on mere affordance; replaced by neutral ink plus a title reason.

## Owed

- pin as test: `revit.apply.parameter-links` REFUSES when the reviewed profile carried through the route command no longer matches the live draft — a later agent patch must not be able to silently change a human-reviewed write.
- (/data-tables) No axis says "this apply will *remove* N rows" — a queued destructive write has no grammar. Cheap local fix: derive `pruned = opened rows − draft rows` and label the verb "apply to revit · prunes N".
- (/parameter-links) The local-draft/remote-draft/`syncedRef` co-edit reconcile is hand-rolled and route-local; no primitive owns "co-edited nested document". Root cause of the page-level-unsaved gap (design-system ledger, Owed).
- Route commands read a document, await external work, then replace the whole route document — a concurrent patch during the await is silently overwritten. Needs compare-and-swap revision or a transactional document updater before routes are the default authoring surface.
- The human/agent endpoint split is tool-level policy, not a security boundary — pea's general shell can call localhost directly. A stronger commit capability needs a browser-held approval primitive agent tools cannot mint or replay.
