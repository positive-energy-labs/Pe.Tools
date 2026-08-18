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
- 2026-08-18 — Queue provenance ruled: lenient `x-pe-origin` header (missing → counted `unknown`; attribution, not authorization), `QueueLedger` in `Pe.Revit.Global` wrapping the queue call sites (SDK untouched), `x-pe-queue-wait-ms`/`x-pe-queue-behind` + envelope `queuedMs`/`execMs` on every `/call` response, `revit.queue.snapshot` answered from ledger memory — spec in [queue-provenance.md](queue-provenance.md).
- 2026-07-08 — `host-ops.generated.ts` is checked in and committed like a lockfile; TS-native ops (settings.*, aps.*, logs, host.status) keep hand-authored schemas in `operation-types.ts` because they are not projections. `bridge-protocol`/`product` constants likewise became hand-authored — they are wire/product invariants.
- 2026-07-08 — Kept deliberately: `IBridgeOperationContext` (DI seam, not ceremony), Effect *inside* the host process (implementation, off the boundary), Ajv validation of settings docs (settings are TS-owned).
- 2026-07-08 — Old pipeline deleted outright, no deprecation: `RevitBridgeOps.cs`, per-op `HostOperationDefinition` classes, `HostOperationsCatalog`, `[ExportTsSchema]`, `JsonSchemaDocumentService` disk writes, Pe.Dev.Cli codegen; TS `host-contracts/src/effect/*`, the generated contract files, `rpc.ts`/`rpc-error.ts`, the host RpcServer switchboard, the `.schemas/` mirror.

### The service seam, install lane, and SEA packaging

- 2026-08-17 — Loopback-only bind is a product invariant, not a preference: every release is a new exe path, so any non-loopback bind re-prompts Windows Firewall once per release.
- 2026-08-17 — Staged-until-restart `VersionedAddin` is correct behavior, not a bug: it never touches locked files (WPF/ILRepack constraint).
- 2026-08-17 — A Node SEA cannot static-ESM-import a bare specifier (`ERR_UNKNOWN_BUILTIN_MODULE`); only runtime `createRequire` survives — that is why `pe:sea-require-shim` exists in `apps/host/vite.config.ts` and `apps/pea/vite.config.ts`.
- 2026-08-17 — `packages/host-contracts/src/vendor/pe-service.ts` is never reformatted: it must stay content-identical to the SDK source, and LF normalization is the only permitted delta. Fix the SDK source and re-vendor; never fork the copy.
- 2026-08-17 — Dev-lane reuse rule: lane `dev` + `executablePath`/`sourceRoot` matching the checkout → reuse the incumbent, never evict. `TsHostLauncher` reads it from the service file.
- 2026-08-17 — `/host/status` is diagnostics-only; nothing load-bearing reads it (identity comes from the service file, liveness from SDK `ProbeHealth`).
- 2026-08-17 — 0.6.10 ships on SDK beta.87; the 11-package family is vendored in `eng/sdk-feed` so a fresh checkout needs no NuGet cache.

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

- Queue provenance: build the ruled spec at [queue-provenance.md](queue-provenance.md) — `x-pe-origin`, `QueueLedger`, response stamps, `revit.queue.snapshot`.
- Report upstream to Pe.Revit.Sdk: rename the `AttachedRrd`/`FreshRevitProcess`/`NoRrdContact`/`RrdRequired` tokens to the plain-word lane/contact vocabulary (ADR 0007); Pe.Tools keeps the legacy spellings at the code boundary until the SDK renames.
- **Deferred wire surfaces** (spec'd, not built): `/ops` effect-smol MultiDocument shape (shared dialect-normalized `definitions` pool); `?session=` selection on `/schemas/settings/...` (single-session is today's reality); `GET /options/<domainKey>` returning `{enum:[...]}` so schemas can remote-`$ref` them and VSCode/Zed give live Revit completions — needs Revit-thread marshaling, judge the editor UX before building. Context-dependent domains stay on `settings.field-options` (web form only).
- (/settings) Join validation issues to the rows their field paths name, once the attention axis is ruled.
- (/settings) Four variants were built on a worktree behind `?variant=` (2026-08-17) awaiting kaitpw verdicts — harvest the winner or drop the worktree. No design-doc corroboration in this dir; the record is the session memory only. (verify)
- (/settings) If settings ever grows past a few dozen fields, migrate it to `MasterTable` with `state:` columns and the /schedule-grid pending-strip reviewer pattern.
- Firewall: stale per-version block rules survive on machines that once ran a pre-0.6.5 non-loopback bind — cosmetic, but nothing prunes them.
- SEA bundle gap: rolldown leaves `playwright-core` / `chromium-bidi` cjs subpaths as unresolved runtime externals and they are not staged beside `pea.exe` — fires only if pea or the host gains a browser tool.
- `pe-revit live status` is a dev-lane bridge tool, not an installed-product path-identity proof; either scope its output to say "dev lane" or add an installed-aware freshness proof.
- `TsHostLauncher` still re-broadcasts the host port via the `PE_TOOLS_HOST_BASE_URL` env var; it should become a service-file read once the C# callers use `Deployment.ServiceBaseUrl(name)`.
- Dev-takeover deviation: with the fixed 5180 listen port the SDK claim runs post-bind, so a dev host cannot take over a **still-listening** same-port incumbent. Needs the ephemeral-port + file-discovery migration; treated as a manual gate today.
- Report the remaining `S-*` / `S-DEF-*` rows upstream to Pe.Revit.Sdk `NEXT.md` (they are SDK-owned, not Pe.Tools work).
- Adopt-when-touched contract gaps — see [op-contract-gaps.md](op-contract-gaps.md).
- `glance.drawing-set` needs a `Thumbnail`-weight projection on `revit.detail.sheets` (titleblock + viewport bounds) plus a first-class sheet series/discipline field before it can be promoted.
- Review `revit.apply.command.execute` as an ExpertOnly candidate — powerful and unbounded, and scripting already covers the "no op fits" case.
- `revit.catalog.concept-evidence` / `revit.catalog.parameter-evidence` are script-candidates under ADR 0003 if usage stays rare.
- Client-side glances in `apps/web/src/ops/glance/` stay UI surfaces regardless of which ones get promoted to first-class ops.
- Decide how source-package sharing reuses the `Pe.Revit.Scripting` pipeline without weakening the stable single-file lane.
- Decide where an out-of-proc host-composition runner lives, for scripts needing host RPC joins outside a bridge request.
- Add the parameter-service cache / `parameters.txt` path to host status or a focused host operation if agents keep needing it.
- Defer a separate browser resolver, browser field-options endpoint, browser-specific UI activation, and browser filters on unrelated operations until usage proves them.
- Evaluate dedicated `revit.catalog.views` / `revit.catalog.sheets` only after project-browser/project-index/schedule provenance patterns settle.
- Promote repeated `host_operation_call` patterns into convenience tools only after usage proves they earn context.
- `host-contracts codegen:check` targets the untargeted host on 5180, so an SDK sandbox (own bridge, absent from that session list) can silently be compared against the dev session; generator accepts `--session` but there is no sandbox-to-host catalog target — never treat an untargeted check as isolated proof. (rehomed from param-tables ledger 2026-08-17)
- No first-class session target for a second host process doing Family Types calls; host service identity is shared across local hosts. (verify) (rehomed from param-tables ledger 2026-08-17)
- Pe.Revit.Sdk defects to report upstream, not expand into SDK changes here: dispatched and adversarially verified 2026-08-18 — the live queue is Pe.Revit.Sdk `docs/context/NEXT.md` §P1 (waves 1-4), which also records what verification killed (`test fresh` discovery unreproducible at HEAD; the acceptance `FileLoadException` framing was a reconstruction — the real blocker is acceptance teardown never removing the candidate addin). `sandbox start` state.json persistence is W3. (rehomed from param-tables ledger 2026-08-17)
- Revisit general JSON IntelliSense: through refactors some providers may no longer be wired into local schema writes; may extend to schema generation generally. (folded from repo-backlog-capture.md)
- Revisit commit `3e3fa88`: shared schedule profile usage appears to break JSON IntelliSense with nullable/type issues, and `SchedulePreviePanel` crashes around `("Order", sg => sg.SortOrder.ToString())`. (folded from repo-backlog-capture.md)
- Route-workspace deferrals from the 2026-07 migration, still open: grounded-document endpoint rename; loaded-family→Family-Types handoff (blocked on project load-back semantics); dynamic/third-party plugin loading; installed-lane acceptance for the route-plugin substrate. (captured from .artifacts/route-workspace-migration.md, deleted)
- History-mining root problems 2026-08-18 (evidence: .artifacts/runs/history-mining-20260818/SYNTHESIS.md, 911 sessions):
  `pea host operations call` needs `--request-file`/stdin — inline JSON dies in shell re-quoting (6-8 wasted attempts per incident);
  `vp check` should fix-then-check and stop linting generated files (`routeTree.gen.ts`) and `.artifacts/`;
  `pe-dev codegen sync` doesn't delete stale outputs (not a sync) and self-locks rebuilding the CLI running it;
  `revit.catalog.recent-documents` returns `{ok:true, documents:[]}` while Revit.ini File1 holds the model;
  host service-name derives from CWD while clients derive from repo root — hash mismatch strands `vp run @pe/host#dev` starts;
  `pea` flag dialect split (`--bridgeSessionId` vs `--bridge-session-id`) and `--host dev` token resolution fails inside the checkout.
- Commit the dispatched "P1: agent-loop truth defects" section in Pe.Revit.Sdk `docs/context/NEXT.md` (appended 2026-08-18; left uncommitted because that repo carried another session's WIP). Delete this line when it lands.
- Relocated from the SDK queue 2026-08-18 — verified consumer-side, Pe.Tools owns these (evidence: `NEXT.md` §P1 "Relocated to Pe.Tools", `.artifacts/tmp/sdk-review-20260818/verify-{truth,lifecycle,shape}.md`):
  - ReadOnly script mode is not containment — owner is `source/Pe.Revit.Scripting`, whose templates already concede "document rollback guarantee, not machine isolation" (`ScriptFileTemplates.cs:89`). Honest rename lands before any scripting-core lift makes the SDK inherit the promise; the `execute` skill's warning stays until it does.
  - `codegen:check` untargeted 5180 comparison — pe-tools workspace scripts, zero SDK hits (dedupe with the `host-contracts codegen:check` line above when built).
  - `Pe.Host` fixed 5180 bind — `Pe.Revit.Bridge` is the reference implementation (ephemeral bind `BridgeHttpServer.cs:206` + port-file discovery); SDK keeps only the lane-coexistence `InstalledService.Matches` item. (supersedes the dev-takeover line above)
  - `pea --host dev` token resolution + `pea ... --request-file`/stdin — Pe.Tools pea (TypeScript); SDK precedent is flags, not JSON blobs.
  - Op-envelope host identity + `emptyBecause` on thin results — Pe.Tools op dispatcher; the wrong-binary half is covered SDK-side by W2 binary provenance.
  - Companion-pin restorability window — Pe.Tools committed feed (the SDK feed is single-version scratch by design); structural fix is the nuget.org publish. SDK doctor's `companion-pins` check verifies consistency, never restorability.
- `pea host operations search` has no `--host` selector and builds its client against default port 5180 — unsafe against a discovered dev-host port (found by black-box probe 2026-08-18; `operations call` accepts `--host` but `search` does not).
- Broad directions this cluster is aimed at: strong AI entrypoints into Revit; portable Revit entities (families, schedules) that move across documents/versions with a merge story; a stable multitenant `Pe.Host` arbitrating between `revit.exe`, local files, the local server/sandbox, and frontend/AI.
