# host ledger

The host runtime: the bridge wire and its operation catalog, the `/ops` console, the `/instances`
fleet cockpit, and `/settings`. Design-language and primitive gaps this cluster hit are owned by the
design-system ledger, not restated here.

## Decided

### The wire and the catalog

- 2026-07-08 — A Revit capability is ONE C# static method with `[BridgeOperation("key")]`; catalog, JSON Schemas, browser types, agent capability maps are all derived at runtime from the connected session. The running session is the source of truth — no compile-time contract artifacts projected across languages.
- 2026-07-08 — `POST /call` (+ optional `x-pe-bridge-session-id`) with `application/problem+json`-shaped errors replaces Effect RPC/NDJSON `/rpc` entirely, including the reverse direction: Revit's own calls back into the host (typed settings reads, APS auth) ride the same wire via `TsHostCallClient`.
- 2026-07-08 — Settings schemas are session state, never mirrored to disk: value-domain samples come from the open document, so persisting them was the old system's bug, not a feature. Docs carry an absolute `$schema` URL so each teammate's own host resolves it (`PE_TOOLS_HOST_BASE_URL` honored).
- 2026-07-08 — Browser invalidates off the `GET /events` SSE relay; no polling and no refresh buttons.
- 2026-07-08 — The single Revit UI thread keeps one in-flight op per session, but concurrent machine callers are now normal: a bounded FIFO queue (423 only when full) replaced the instant-423 mailbox.
- 2026-07-08 — `host-ops.generated.ts` is checked in and committed like a lockfile; TS-native ops (settings.*, aps.*, logs, host.status) keep hand-authored schemas in `operation-types.ts` because they are not projections. `bridge-protocol`/`product` constants likewise became hand-authored — they are wire/product invariants.
- 2026-07-08 — Kept deliberately: `IBridgeOperationContext` (DI seam, not ceremony), Effect *inside* the host process (implementation, off the boundary), Ajv validation of settings docs (settings are TS-owned).
- 2026-07-08 — Old pipeline deleted outright, no deprecation: `RevitBridgeOps.cs`, per-op `HostOperationDefinition` classes, `HostOperationsCatalog`, `[ExportTsSchema]`, `JsonSchemaDocumentService` disk writes, Pe.Dev.Cli codegen; TS `host-contracts/src/effect/*`, the generated contract files, `rpc.ts`/`rpc-error.ts`, the host RpcServer switchboard, the `.schemas/` mirror.

### The `/ops` console

- 2026-08-16 — `/ops` ran a parallel design vocabulary (`ops/primitives.tsx`: Chip · MonoNote · EmptyState · OpSection · KVGrid · Provenance · CoverageBar); the sweep dissolved it onto the one language. Only the Revit-familiar shapes survive ops-owned — TreeView (project browser), DataTable (schedule grid), KVGrid (properties palette) — plus a new `VizChip` for taxonomy spends. `CatHue`/`catVar` deleted at zero consumers.
- 2026-08-16 — `EmptyFrame` for sheets outside the 10-sheet detail budget keeps its dashed border as a legal R13(b) seam: a declared sheet with no geometry behind it. (verify — review may rule "not-fetched ≠ seam"; the replacement is a plain `--r-line` frame.)
- 2026-08-16 — `/ops` gets no `AddressingBar` head rail: it is a two-pane console and its per-op header is op identity, not route addressing.
- 2026-08-16 — `src/ops/**` + `routes/ops.tsx` consume zero shim tokens after the pass — only `--r-*`, `--viz-*`, `--radius`, `--font-*`.

### The fleet cockpit (`/instances`)

- 2026-08-16 — Instances state is a **row-level pipeline verdict** (world phase), not a value pseudo-dimension: the fleet is the first real consumer of the `verdict:` column clause (R5), and essentially nothing here maps to the four value axes. That is the census's result, not a gap.
- 2026-08-16 — A lifecycle cockpit is legitimately blue-dense: every verb here (declare ×3, restart/stop per row, start-again per killed row) boots or kills an OS process, so all wear `commit` per the letter of the scarcity law. The `VerbGroup` radius line carries the blast statement once.
- 2026-08-16 — Honest empties beat "—": "no open document" (live world, none open) and "nothing observed" (registry-only world) say which silence it is.

### Settings

- 2026-08-16 — /settings stays a list of `StateCell`s at CARD scale, not a table: it is a small trichotomy reviewer over a JSON file, and at list scale per-row approve/deny/unstage verbs are the honest form even at ~3 verb widths per row.
- 2026-08-16 — Prior value under a proposal/stage rides "was X" leading the note: card scale has an inline ghost only for `drift`, and a schema-flagged or pea-proposed value is not drift. Prose where the chat card renders a real diff — accepted until the model carries the proposal's prior value.
- 2026-08-16 — A busy/down SSE bridge is a caution `FactChip`, not an agreement signal: a broken lane is not the model disagreeing.
- 2026-08-16 — Validation issues stay document-scoped chips rather than being joined onto the fields they name: an issue on a staged field IS the `attention` fact, so joining is entangled with the unruled attention axis (design-system ledger, Owed) and would have pre-decided it.
- 2026-08-16 — Every command failure lands as `OutcomeKind: "error"` (caution), never dressed as a refusal: `route.command` returns `{ok:false, error?, hint?}` with no refusal discriminator, and guessing would spend the one alarm dishonestly.

## Tried & rejected

- 2026-08-16 — Rendering "response shape the view cannot narrow" as an `EmptyState` (~40 call sites): claims absence when rows may exist. Now `UnrecognizedShape` — an error `OutcomeLine` pointing at the raw-response disclosure. Mirror image of takeoffs' finding that an empty state must never stand in for an unreadable result.
- 2026-08-16 — `--pe-blue` circuit-number gutter in the panelboard and `--pe-green` for the curated-view list marker: Revit-flavoured decoration spending blue (commit/nav only) and pea's identity on a non-pea fact. Both neutralized; Revit verisimilitude knowingly traded away.
- 2026-08-16 — Hue carrying rank in `revit.resolve.references` (blue edge/wash for the leader, kiln for demoted): grayscale law. Rank now rides order + `#n` gutter + a single-series `--viz-1` score bar.
- 2026-08-16 — (/settings) `RouteWorkspaceShell` as this route's chrome: replaced by `AddressingBar`; the shell spends legacy tokens (`--paper`, `--clay-ink`, `--lichen`, `--cat-clay`, `--line-2`) and could not carry the fact lane or the one-commit verb.
- 2026-08-16 — (/settings) `HostConnectionPill` for bridge state: replaced by a connection `FactChip`; the pill was route chrome carrying a document-scoped fact.
- 2026-08-16 — (/settings) Hand-rolled busy/error state per command: replaced by `useVerb`, which serializes open/re-read/validate/save.

## Owed

- **Deferred wire surfaces** (spec'd, not built): `/ops` effect-smol MultiDocument shape (shared dialect-normalized `definitions` pool); `?session=` selection on `/schemas/settings/...` (single-session is today's reality); `GET /options/<domainKey>` returning `{enum:[...]}` so schemas can remote-`$ref` them and VSCode/Zed give live Revit completions — needs Revit-thread marshaling, judge the editor UX before building. Context-dependent domains stay on `settings.field-options` (web form only).
- (/settings) Join validation issues to the rows their field paths name, once the attention axis is ruled.
- (/settings) Four variants were built on a worktree behind `?variant=` (2026-08-17) awaiting kaitpw verdicts — harvest the winner or drop the worktree. No design-doc corroboration in this dir; the record is the session memory only. (verify)
- (/settings) If settings ever grows past a few dozen fields, migrate it to `MasterTable` with `state:` columns and the /schedule-grid pending-strip reviewer pattern.
