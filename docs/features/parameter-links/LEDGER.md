# parameter-links ledger

## Decided
- 2026-08-15 — Profile storage is one versioned JSON blob in a non-visible shared Text param on Project Information, NOT Extensible Storage; malformed data fails closed. ES was rejected as unreadable/unportable for a doc-owned profile.
- 2026-08-15 — The core must not encode MOCP, panel schedules, or any particular family parameter; MOCP→circuit Rating is only the first acceptance case. Generality is the product, the case is the proof.
- 2026-08-15 — Exactly two host ops (`revit.detail.parameter-links`, `revit.apply.parameter-links`) and NO feature-specific MCP tool — one capability, one progressively discoverable path; chat and browser share the vocabulary.
- 2026-08-15 — Evaluation is deterministic and transaction-independent; explicit apply owns its transaction, the process-wide `IUpdater` writes inside Revit's updater context. Keeps the doc-owned lane DA-safe.
- 2026-08-15 — Preview/apply carry the complete reviewed profile through the route command and apply fails if it no longer matches the live draft — a later agent patch cannot silently change a human-reviewed write.
- 2026-08-15 — Routes-as-chat-plugins uses ONE generic route-plugin registry, not per-feature tools/transports; parameter-links is the first full inline plugin. Family Types' protocol registration stays chat-only, not a second route-state implementation.
- 2026-08-15 — Explicitly out of scope until MVP evidence exists: hiding host ops, forcing all mutation through routes, shared/office profile libraries, a formula language, migrating every route.
- 2026-08-16 — Design-language sweep landed on `routes/parameter-links.tsx`, `Evaluation.tsx`, `ProfileEditor.tsx`: `AddressingBar` replaces `RouteWorkspaceShell`, raw-palette spends gone, bold=unsaved on changed projected-write cells. `model.ts` untouched (pure model).
- 2026-08-16 — Save-draft wears `commit` blue because saving writes the *shared* document (pea + other tabs see it), even though it never touches Revit. Recorded because two blues now sit one lane apart. (verify — review may reverse this to `act`.)

## Tried & rejected
- 2026-08-16 — A prose subline narrating the preview-freshness gate: it repeated the verb's own reason on the surface and failed the boundary test both ways. Removed; the gate now shows only as Apply's disabled state + title.
- 2026-08-16 — Blue `--pe-blue` dot in a Δ column to mark changed projected writes: column deleted, replaced by bold-means-unsaved on the result cell.

## Owed
- No home for page-level "unsaved" beyond a caution `FactChip`: the unsaved thing is a nested *document* edited through selects (`FieldOptionSelect`), and the editable `StateCell` (R8) covers text cells only. Needs a select-shaped editable cell — a component repair, second consumer of evidence after takeoffs #7.
- Preview freshness (`previewed`/`reviewed`/`applyReady`, incl. "pea previewed, human must re-run") is real state with no visible mark — only a greyed verb + hover title. Candidate home: `ArmingStrip`, still with no shipping consumer; this route is a candidate first consumer.
- "Host disconnected" has no axis and no kind; three routes now hand-pick a chip tone for it. Rule a standing treatment ("connection state is a caution fact chip named `host ·`").
- `RouteWorkspaceShell` + `HostConnectionPill` survive only for `/settings` (with their `--paper`/`--clay-ink`/`--line-2`/`--cat-clay` spends). When settings moves to `AddressingBar`, delete them and their shim lines.
- The local-draft/remote-draft/`syncedRef` co-edit reconcile is hand-rolled and route-local; no primitive owns "co-edited nested document". Root cause of the unsaved-cell gap above.
- Route commands read a document, await external work, then replace the whole route document — a concurrent patch during the await is silently overwritten. Needs compare-and-swap revision or a transactional document updater before routes are the default authoring surface.
- The human/agent endpoint split is tool-level policy, not a security boundary — pea's general shell can call localhost directly. A stronger commit capability needs a browser-held approval primitive agent tools cannot mint or replay.
- `family.editor.apply` misclassifies display values as formula references: `GetReferencedIn("179 W")` hits when a param named `W` exists. Fix the value-vs-formula discriminator in `RevitDataRequestService`, not in route plugins. (verify — may have landed.)
- Chat attachments do not hydrate route-owned document state (acceptance PDF was parsed locally); `parse_spec` also needs `LLAMA_CLOUD_API_KEY` and fails opaquely without it. (verify.)
- `ask_user` transcript renderer collapses custom questions/options into generic approval buttons; route review stays the human decision surface until it preserves the option contract. (verify.)
- `host-contracts codegen:check` targets the untargeted host on 5180, so an SDK sandbox (own bridge, absent from that session list) can silently be compared against RRD. Generator accepts `--session` but there is no sandbox-to-host catalog target; never treat an untargeted check as isolated proof.
- No first-class session target for a second host process doing Family Types calls; host service identity is shared across local hosts. (verify.)
- Pe.Revit.Sdk defects seen in these lanes (report upstream, do not expand into SDK changes): `pe-revit test fresh` discovery misses `Pe.Revit.Tests` without `--project` though it resolves as `PeProjectKind=RevitTests`; `sandbox start` materialization failure names a `state.json` that is never persisted, so `status`/`restart` return `unknown-id`; `Pe.RuntimeAcceptance.Addin` duplicate-assembly `FileLoadException` blocks a test behind a manual dialog; beta.66 companion pins are not consistently restorable (R24 falls back to `dev.9`, R26 tops out at beta.57) so cross-version proof is source-compatible only.
