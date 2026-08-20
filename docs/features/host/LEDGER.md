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

- 2026-08-20 — SDK beta.121 cutover field verdict (W5-A drive + BB-1 black-box drive, Opus, from `--help`/`guide`/the execute skill only): the SDK session/doc/op surface worked first try almost everywhere (start 40 s, restart-with-doc 73 s, `op result` replay, `keep-doc`); the route relays the SDK envelope untouched; the host leg proves `up how=health`. The product path was dead for the whole drive because the installed loader shim predates beta.121 (see Owed). Evidence: `Pe.Revit.Sdk/.artifacts/review-20260820/{w5a,bb}-report.md` (disposable).

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

- **Ship a product release on SDK beta.121.** The installed `Pe.Revit.Loader` shim (0.6.25 and 0.6.23) accepts receipt lanes `(dev, sandbox)` and rejects beta.121's `installed` receipt, so `pe-revit session start --year 25` boots a Revit with no `Pe.App` in it while the CLI says `ready` (BB-1 F-1). Until the payload is rebuilt and released, the installed lane — the end-user path — is dead; the dev lane is fine.
- Host eviction by a route-launched session (BB-1 F-4): `POST /sessions start` on a dev-lane host spawned a competing `@pe/host` (`--take-over-host`), the incumbent's claim was refused, the Herdr pane died and `node --watch` does not return without a file change; the service file ended owned by an orphan pid nobody can stop. One owner per `sourceRoot` service name; a lost claim must be a retryable restart. Sibling defect (W5-A): Pe.App's host supervisor spawns its own host before trying the healthy incumbent and its 45 s spawn budget is shorter than a dev-host cold start — so no bridge ever connects, `announceServedSession` never writes `sessionId`, and the `BridgeAgent` op receipts stay field-unproven.
- `/sessions` route lane choice (BB-1 F-14): a bare `start {year}` on a dev-lane host injects this checkout's `--project` (dev lane, 46 s build) while the same bare CLI verb means installed lane; there is no way to ask the route for installed. Decide: default like the CLI and take an explicit project, or name the lane in the body.
- `pea --prompt` cannot start a turn without a bridged Revit (`scripting.workspace.bootstrap: No observed session is connected`) and reuses `observed` to mean "bridged" (BB-1 F-3/F-12); `pea host status` prints `session none` beside a ready controlled session (F-11) — read the SDK registry and say "not bridged".
- `/instances` has no text-level proof path: SSR ships a client-only shell with zero session strings, so a drive without a browser tool cannot verify the page (BB-1 F-25) — SSR the fleet list or name the preview tool in the execute skill (done for t3-code).
- `pea host operations search` `fetch failed` re-confirmed 2026-08-20 (BB-1 F-2) with the host answering `call` seconds either side; a CLI failure also prescribes an MCP tool name (`host_operation_search`, F-22).
- Queue provenance: build the ruled spec at [queue-provenance.md](queue-provenance.md) — `x-pe-origin`, `QueueLedger`, response stamps, `revit.queue.snapshot`.
- **Deferred wire surfaces** (spec'd, not built): `/ops` effect-smol MultiDocument shape (shared dialect-normalized `definitions` pool); `?session=` selection on `/schemas/settings/...` (single-session is today's reality); `GET /options/<domainKey>` returning `{enum:[...]}` so schemas can remote-`$ref` them and VSCode/Zed give live Revit completions — needs Revit-thread marshaling, judge the editor UX before building. Context-dependent domains stay on `settings.field-options` (web form only).
- (/settings) Join validation issues to the rows their field paths name, once the attention axis is ruled.
- (/settings) Four variants were built on a worktree behind `?variant=` (2026-08-17) awaiting kaitpw verdicts — harvest the winner or drop the worktree. No design-doc corroboration in this dir; the record is the session memory only. (verify)
- (/settings) If settings ever grows past a few dozen fields, migrate it to `MasterTable` with `state:` columns and the /schedule-grid pending-strip reviewer pattern.
- Firewall: stale per-version block rules survive on machines that once ran a pre-0.6.5 non-loopback bind — cosmetic, but nothing prunes them.
- SEA bundle gap: rolldown leaves `playwright-core` / `chromium-bidi` cjs subpaths as unresolved runtime externals and they are not staged beside `pea.exe` — fires only if pea or the host gains a browser tool.
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
- `host-contracts` offline `codegen`/`codegen:check` (the default lanes since `7af1eba`) silently swallow a `--session` arg — exit 0, no acknowledgment, generated files mutate (drive B-10). Fix: the offline lane refuses args it will not use; only `codegen:verify-live` takes `--session`. Docs corrected 2026-08-19 (BUILD.md, execute skill).
- No first-class session target for a second host process doing Family Types calls; host service identity is shared across local hosts. (verify) (rehomed from param-tables ledger 2026-08-17)
- Pe.Revit.Sdk defects go upstream, never expand into SDK changes here. The queue is the SDK's own `docs/context/NEXT.md`, rewritten open-only at beta.121; `SPEC.md` + `docs/adr/0002-session-surface-final-form.md` are the authority for what the surface now is. Everything the session-surface cutover closed (session-state persistence, the acceptance rig, fresh-rung discovery) is off this ledger. (rehomed from param-tables ledger 2026-08-17)
- Revisit general JSON IntelliSense: through refactors some providers may no longer be wired into local schema writes; may extend to schema generation generally. (folded from repo-backlog-capture.md)
- Revisit commit `3e3fa88`: shared schedule profile usage appears to break JSON IntelliSense with nullable/type issues, and `SchedulePreviePanel` crashes around `("Order", sg => sg.SortOrder.ToString())`. (folded from repo-backlog-capture.md)
- Route-workspace deferrals from the 2026-07 migration, still open: grounded-document endpoint rename; loaded-family→Family-Types handoff (blocked on project load-back semantics); dynamic/third-party plugin loading; installed-lane acceptance for the route-plugin substrate. (captured from .artifacts/route-workspace-migration.md, deleted)
- History-mining root problems 2026-08-18 (evidence: .artifacts/runs/history-mining-20260818/SYNTHESIS.md, 911 sessions):
  `vp check` should fix-then-check and stop linting generated files (`routeTree.gen.ts`) and `.artifacts/`;
  `pe-dev codegen sync` doesn't delete stale outputs (not a sync) and self-locks rebuilding the CLI running it;
  `revit.catalog.recent-documents` returns `{ok:true, documents:[]}` while Revit.ini File1 holds the model;
  host service-name derives from CWD while clients derive from repo root — hash mismatch strands `vp run @pe/host#dev` starts;
  `pea` flag dialect split (`--bridgeSessionId` vs `--bridge-session-id`).
- `Pe.Revit.Scripting` ReadOnly mode is not containment, and its name says it is: the templates already concede "document rollback guarantee, not machine isolation" (`ScriptFileTemplates.cs:89`), and the SDK agrees that in-process code is trusted. The honest rename lands before any scripting-core lift makes the SDK inherit the promise; the `execute` skill's warning stays until it does.
- The product op envelope carries no answerer identity and no `emptyBecause`, so `ok:true` with a thin payload cannot be told from a wrong-target success. Owner is the Pe.Tools op dispatcher; the SDK's own envelopes carry `resolved` + `binary` and its op receipts are a different artifact — do not read one as the other.
- `pea host operations call` needs `--request-file`/stdin, and `pea --host dev` token resolution fails inside a checkout. Inline JSON dies in PowerShell re-quoting (6-8 wasted attempts per incident); SDK precedent is typed flags, never a JSON blob on the command line.
- Relocated from the SDK queue 2026-08-18 — verified consumer-side, Pe.Tools owns these (evidence: `.artifacts/tmp/sdk-review-20260818/verify-{truth,lifecycle,shape}.md`):
  - `codegen:check` untargeted 5180 comparison — pe-tools workspace scripts, zero SDK hits (dedupe with the `host-contracts codegen:check` line above when built).
  - `Pe.Host` fixed 5180 bind — `Pe.Revit.Bridge` is the reference implementation (ephemeral bind `BridgeHttpServer.cs:206` + port-file discovery); SDK keeps only the lane-coexistence `InstalledService.Matches` item. (supersedes the dev-takeover line above)
  - From the 2026-08-19 black-box drives (evidence: `.artifacts/runs/blackbox-20260818/DRIVE-{A,B}.md`, cited by incident): `pea <bad subcommand>` exits 0 (B-11d); `vp check` cannot be green on an unchanged tree — an unconditional exit 1 carries no signal (B-9); offline `codegen` swallows `--session` — see the sharpened line above (B-10).
  - Companion-pin restorability window — Pe.Tools committed feed (the SDK feed is single-version scratch by design); structural fix is the nuget.org publish. SDK doctor's `companion-pins` check verifies consistency, never restorability.
- `pea host operations search` has no `--host` selector and builds its client against default port 5180 — unsafe against a discovered dev-host port (found by black-box probe 2026-08-18; `operations call` accepts `--host` but `search` does not). **Confirmed fatal 2026-08-19**: with the dev host on its real port, every `search --query X` returns a bare `fetch failed` (no URL, no port, no hint) while `pea host status` works in the same second — so op discovery is entirely unavailable in the dev lane and raw `POST /call` is the only path. Contrast the excellent no-host message ("start it with `vp run @pe/host#dev`"): the fix is to reuse the same discovery + the same diagnostic voice.
- Doc-ops ownership question, open with the user (evidence: `.artifacts/runs/close-repro-20260819/IDEALIZE-SESSION-SURFACE.md`, FINDINGS.md F3/F6/F13/F14): the proposal is to move document identity and lifecycle (recents, cloud-GUID resolution, open/close) OUT of the host CLI and into `pe-revit`'s session surface, leaving the host to own the op catalog and data/apply ops. Anchors: `revit.catalog.recent-documents` is already host-LOCAL (Revit.ini parse, 115ms, returns cloud project/model GUIDs) so it needs no bridge; and close already lives SDK-side in the bridge's dialog hook, so open is its mirror. The SDK took the other half at beta.121: `pe-revit doc open|close|current|recents` and `op list|result` are session surface now, so this is a question of which recents/GUID resolution stays product-side, not whether doc lifecycle moves.
- Third-party addin interference is load-bearing, not incidental (2026-08-19): CTC ModelDashboard's `DocumentOpened` handler commits transactions on every freshly opened document, so a "clean" detached or cloud doc is dirty before our open op returns — this is what summons Revit's whole workshared close chain and it inflates every open timing. Any doc-open contract we write states this, rather than promising an unmodified document.
- Broad directions this cluster is aimed at: strong AI entrypoints into Revit; portable Revit entities (families, schedules) that move across documents/versions with a merge story; a stable multitenant `Pe.Host` arbitrating between `revit.exe`, local files, the local server, and frontend/AI.
