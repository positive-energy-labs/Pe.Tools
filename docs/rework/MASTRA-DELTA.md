# MASTRA-DELTA — @mastra/* + mastracode pinned→latest, per Pe touchpoint

2026-07-07. Grounding doc for **PLAN.md Phase 3** (bump @mastra/* 1.48-alpha → 1.50.x + mastracode
0.27-alpha → 0.30, then delete the Pe glue the bump obsoletes). Ethos (precedent commit 2b96990):
when Mastra ships a native equivalent, delete the Pe adapter. **Mastra stays a dependency — never
propose removing it.**

Every verdict below is one of:
- **DELETE after bump** — upstream now covers it; verified against a published tarball / changelog.
- **KEEP** — upstream gap confirmed still open (cited); glue stays.
- **VERIFY-AT-BUMP** — plausible upstream fix, but needs a live test against OUR symptom before deleting.

## Source-of-truth caveat (read this)

The local mastra checkout at `C:\Users\kaitp\source\repos\mastra` is **destroyed**: `.git` has no
`HEAD`/`config` (GitButler `gk/` tree, no pull possible) and the working tree is empty — every
`package.json`, `CHANGELOG.md`, and all `src`/`dist` files are gone; only stray
`dist/capabilities/*.json` survive. `git pull` and reading source there both fail.

Everything below was verified instead from **published artifacts**:
- Latest versions + changelogs pulled live from the npm registry (`npm view`) and unpkg
  (`CHANGELOG.md`, cumulative newest-first, sliced to entries above our pins).
- API shapes verified by `npm pack`-ing the latest tarballs and reading their `.d.ts`:
  `mastracode@0.30.0`, `@mastra/server@1.50.1`, `@mastra/client-js@1.31.1`, `@mastra/core@1.50.1`.

PR/issue numbers are cited from the changelog bodies. Where a claim could not be pinned to a
published artifact it is marked VERIFY-AT-BUMP, not asserted.

---

## 1. Version matrix

| Package | Our pin | Latest stable | Δ | Risk on our path |
|---|---|---|---|---|
| `@mastra/core` | `1.48.0-alpha.4` | **`1.50.1`** | alpha→stable, +2 minor | **Breaking rename #18665** (AgentController interval API) hits us. heartbeats→schedules rename #18874 is unrelated to us (we don't use `mastra.schedules`). |
| `@mastra/hono` | `1.5.3-alpha.4` | **`1.5.6`** | alpha→stable | Low. Delta is mostly lockstep `@mastra/server` bumps + a `ws` security fix (#18789). `MastraServer({app,mastra})` + `.init()` unchanged as far as the changelog shows — VERIFY. |
| `@mastra/memory` | `1.21.3-alpha.0` | **`1.22.2`** | alpha→stable | Low. Additive OM features (extractors #18653, OM-managed working memory #18654, `providerMetadata` on ObserveHooks #18563). No breaking rename to the `observationalMemory` config shape. VERIFY our config still type-checks. |
| `@mastra/libsql` | `1.14.2` | **`1.15.1`** | +1 patch | Low. Adds opt-in `retention` (#18733); auto-normalizes legacy `target.type:'heartbeat'` rows (#18874). `ThreadStateLibSQL` / `stores.threadState` still shipped. |
| `@mastra/client-js` | `1.28.0` (apps/web) | **`1.31.1`** | +3 minor | Medium. Adds `createSchedule*` + deprecates `createHeartbeat*` (#18874 — we use neither). New: `steer`, `followUp`, `getOMRecord`, `setGoal`/`getGoal`. **`sendMessage` and `cloneThread` are unchanged** (see gaps §3). |
| `@mastra/mcp` | `1.12.0` (packages/mcps) | **`1.13.1`** | +1 minor | Low. Only change in delta: MCP client tools now surface `outputSchema` (#18854). No `createTool`/MCPServer break. |
| `mastracode` | `0.27.0-alpha.4` | **`0.30.0`** | alpha→stable, +3 minor | **Breaking rename #18665** (`heartbeatHandlers`→`intervalHandlers` on `createMastraCode` opts). No public `resolveModel` export added (gap §3). Entry-point rename `runHeadless`→`runMC` does NOT hit us (we use `./tui`/`./acp` subpaths). |

`@mastra/server` (transitively via `@mastra/hono`) tracks `@mastra/core`: latest `1.50.1`. We import
it only through `MastraServer` from `@mastra/hono`.

Recommendation: take **stable** on all (`latest` tag), not the `-alpha` line. This exits the
alpha-pin churn that motivated Phase 3.

---

## 2. Per-touchpoint delta table

Verified file:line on the left; upstream state (with tarball/changelog citation) in the middle;
verdict on the right.

### 2a. Model resolution — the throwaway-runtime hack

| Our glue | Upstream now | Verdict |
|---|---|---|
| `packages/runtime/src/models/resolve.ts:30-43` — boots one cached `createMastraCode({disableHooks,disableMcp,heartbeatHandlers:[]})` per process purely to borrow `runtime.resolveModel`; leaks it for process lifetime (`resolve.ts:20-21` ponytail note). | **No public resolver export in `mastracode@0.30.0`.** Verified against the tarball: `package/dist/index.d.ts` root-exports `createMastraCode`, `createMastraCodeAgentController`, `bootLocalAgentController`, `mountAgentControllerOnMastra`, `prepareAgentControllerMount`, `createAuthStorage`, and the headless runners — **but not `resolveModel`**. `resolveModel(modelId,{thinkingLevel?,remapForCodexOAuth?})` lives in `./agents/model.d.ts`, imported internally, and `./agents/model` is **not** in the package `exports` map (`.`, `./tui`, `./acp`, `./headless`, `./plugin`, `./package.json`) — deep import stays blocked. | **KEEP.** The MASTRA_UPSTREAM_CANDIDATES.md "small public model resolver" ask is still unmet at 0.30.0. **Required edit at bump:** `resolve.ts:38` `heartbeatHandlers: []` → `intervalHandlers: []` (#18665; the option is now `intervalHandlers?: IntervalHandler[]`, verified in `index.d.ts` `MastraCodeConfig`). |

### 2b. Multimodal send — the `/pe/messages` image hack

| Our glue | Upstream now | Verdict |
|---|---|---|
| `packages/runtime/src/agent-controller-web.ts:16-27` (`peSendMessageSchema`), `:122-130` (`POST /pe/messages` → `runtime.session.sendMessage({content,files})`). Delegates to the in-process Session because the native HTTP route is `{message:string}` only. | **Native HTTP send still string-only.** `@mastra/client-js@1.31.1` `dist/resources/agent-controller.d.ts:404`: `sendMessage(message: string): Promise<void>`. No `files` param; the mapped route is `POST .../messages`. The in-process `Session.sendMessage` still accepts `files` (that's why the bridge works), but the HTTP boundary drops them. | **KEEP.** Upstream candidate "carry `files` on the send route" unmet at 1.31.1. |
| `apps/web/src/workbench/provider.tsx:638-649` (`postPeMessage`), `:575-602` (`toFiles`), `:604-610` (`toBase64`), `:333` (send calls `postPeMessage`). | Same gap — the client sends via the Pe route because `client-js.sendMessage` can't carry attachments. | **KEEP** (all of it) until the native route carries `files`. `attachmentsToContent` (`:559-573`) is the **optimistic echo** and stays regardless. |

Note the display side (`adapter.ts:334-343` image/file part, `wire.ts:37-47` loose image schema) is
**read-back** rendering, independent of send. It is not obsoleted by any native send change; keep.

### 2c. Approvals — the suspended-run workarounds

| Our glue | Upstream now | Verdict |
|---|---|---|
| `apps/web/src/workbench/adapter.ts:154-155` — `agent_end` with `reason:"suspended"` returns state unchanged so the pending approval + "waiting" status survive (else the approve/deny buttons vanish). | **#18583** "Fixed approved and declined tool approvals not round-tripping on **recall**" (core 1.49.0; also memory #18583 fixes OM token-count on declined approvals). The changelog is explicit: *"Live approve/decline already worked; this was a **write-path persistence** gap"* (fixes #17218). That is a **memory.recall** fix, NOT the live SSE `agent_end(suspended)` reducer behavior we guard here. **#18940** separately fixes `listSuspendedRuns()` reporting `toolCallId: undefined` — closer to our surface but about storage discovery, not the reducer. | **VERIFY-AT-BUMP.** Our symptom is a *client reducer / stream* concern, not recall persistence. #18583/#18940 may reduce approval breakage but do not obviously subsume this guard. Live-test approve/deny before touching `adapter.ts:154-155`. |
| `apps/web/src/workbench/provider.tsx:238-248` — after `agent_end`, re-hydrate the transcript **unless** `reason==="suspended"`, because `hydrate`'s `switchThread` re-attaches and REPLAYS the suspended run → `agent_end(suspended)` → hydrate → replay… a ~165 events/s flood. | No changelog entry addresses agent-controller **subscribe/replay on re-attach to a suspended run**. #18862 (snapshot-bloat pruning on HITL suspensions) and #18931 (message-hydration resource-id backfill) are adjacent but not this. | **VERIFY-AT-BUMP.** Keep the flood guard until a live suspended run on 1.50.1 is observed not to replay. |
| `provider.tsx:382-418` `resolveApproval` + `:546-555` `rejectApproval` — split `tool-approval:`/`tool-suspended:` handling over `approveTool` / `respondToToolSuspension`. | Both native methods intact: `client-js.d.ts:408` `approveTool(toolCallId,approved)`, `:414` `respondToToolSuspension(toolCallId, resumeData)`. This is thin, correct usage of native APIs — not a workaround. | **KEEP** (it's just the native call surface, nothing to delete). |
| `packages/mcps/src/shared/request-access.ts:44` — `requireApproval` on the Pea tool. | Native `createTool({requireApproval})` is the intended API and unchanged. | **KEEP.** Not glue; this is the native contract. |

### 2d. Transparency capture proxies

| Our glue | Upstream now | Verdict |
|---|---|---|
| `packages/runtime/src/system-prompt-capture.ts` (52 LOC) — InputProcessor that snapshots the resolved system prompt at the provider boundary. Used at `apps/pea/src/runtime.ts:85,118` and fed to `metadata.workbench.systemPrompt` (`runtime.ts:152`), surfaced via `/pe/inspect`. | Native accessors exist: `getInstructions()` / `getToolsForExecution()` / `listSkills()` via `buildRequestContext` on `getCurrentAgent` — MEMORY note *world-inspector-tool-capture* records World mode already sourcing these natively in peco with "zero shims", calling the capture proxies a "redundant fallback". | **VERIFY-AT-BUMP.** The web `/pe/inspect` payload (`agent-controller-web.ts:121`, `adapter.ts:PeInspect`) still **reads the capture snapshots** — it is not yet wired to the native accessors. Deletable only after the inspect payload is re-sourced from native accessors and the web inspector verified equivalent. Deletes `system-prompt-capture.ts` + `tests/system-prompt-capture.test.ts`. |
| `packages/runtime/src/tool-list-capture.ts` (111 LOC) — Proxy over the resolved model intercepting `doStream`/`doGenerate` to snapshot the tool list. Used at `apps/pea/src/runtime.ts:92,118` → `metadata.workbench.toolList`. | Same native accessor story (`getToolsForExecution`). | **VERIFY-AT-BUMP.** Same as above — the `approxTokens` sizing the inspector wants (`adapter.ts:751-759`) must be reproduced from the native tool list first. Deletes `tool-list-capture.ts` + `tests/tool-list-capture.test.ts`. |

### 2e. Storage / thread-state / memory

| Our glue | Upstream now | Verdict |
|---|---|---|
| `packages/runtime/src/storage/thread-state.ts` (62 LOC) — duck-typed resolver that walks `stores.threadState` / `getStorage()` / `getMastra().getStorage()` to *locate* the native `ThreadStateLibSQL`. Header already notes the custom impl was deleted. | `@mastra/libsql@1.15.1` still ships `stores.threadState` by default; no new public "get the thread-state store" accessor in the delta. | **KEEP** (with a **simplify** flag). It's a locator, not a reimplementation, so it's low-value but not obsoleted. If the bump surfaces a stable public accessor, collapse the 5-branch walk (`thread-state.ts:19-24`) to it — VERIFY-AT-BUMP. |
| `packages/runtime/src/storage/profiles.ts` — `LibSQLStore` config + local pragmas. | `LibSQLStore` constructor unchanged in delta (retention is additive/opt-in #18733). | **KEEP** as-is. Optional: adopt `retention` later — out of Phase-3 scope. |
| `packages/runtime/src/memory/profiles.ts:90-114` — `observationalMemory` config (observation/reflection thresholds, `observeAttachments`, instruction). | Memory 1.22.2: OM shape is a superset (new `observation.manageWorkingMemory` #18654, extractors #18653). No field we set was renamed/removed per the delta. | **KEEP.** VERIFY it type-checks against `MemoryConfigInternal` at 1.22.2 (we import that type at `profiles.ts:3`). Low risk. |

### 2f. Controller construction + web mount

| Our glue | Upstream now | Verdict |
|---|---|---|
| `packages/runtime/src/controller/create-runtime-controller.ts` — `new AgentController(config)`, `.init()`, `.createSession()`, `.destroy()`, `Mastra({agentControllers,storage})`. | These APIs are unchanged in the core delta. **No `heartbeatHandlers`/`stopHeartbeats` usage here** (verified — the rename does NOT touch this file). | **KEEP.** No edit needed. Watch for `AgentControllerConfig` type drift at compile (alpha→stable), but no rename lands here. |
| `packages/runtime/src/agent-controller-web.ts:81-96` `resolveServingTarget` — wraps a mastracode controller on a fresh `Mastra` when its internal Mastra doesn't list it. | mastracode 0.30 now exports `mountAgentControllerOnMastra` / `prepareAgentControllerMount` (`index.d.ts:180,211`). These *may* replace the manual wrap for the mastracode (pe-code) path. | **VERIFY-AT-BUMP.** Plausible simplification for the mastracode-controller branch only; the pea branch (`create-runtime-controller` already registers on an explicit Mastra) is unaffected. Not required for the bump. |
| `agent-controller-web.ts:132-133` `new MastraServer({app,mastra})` + `server.init()`. | `@mastra/hono@1.5.6` — no `MastraServer` API change surfaced in the delta. | **KEEP.** VERIFY `.init()` signature at compile. |
| `apps/pe-code/src/runtime.ts:179` `runtime.controller.stopHeartbeats()`. | **#18665**: renamed to `stopIntervals()` (also `removeHeartbeat`→`removeInterval`, `heartbeatHandlers`→`intervalHandlers`, `HeartbeatHandler`→`IntervalHandler`). | **DELETE/rename after bump.** `stopHeartbeats()` → `stopIntervals()`. Hard compile break otherwise. |

---

## 3. Known-still-open upstream gaps (we keep glue for these)

1. **Public model resolver export** — `mastracode@0.30.0` still exposes `resolveModel` only via
   `createMastraCode().resolveModel`; no root export, `./agents/model` not in `exports`. `resolve.ts`
   throwaway-runtime hack **stays** (rename `heartbeatHandlers`→`intervalHandlers`). See §2a. Also
   still open: **OAuth-for-OM** — gateway-resolved roles (Observational Memory) take a model-id
   `string`, not a pre-resolved instance, so OM can't ride operator OAuth (MASTRA_UPSTREAM_CANDIDATES.md
   §"Export a small public model resolver surface"). Unchanged at 1.50.1.

2. **`files` on the send-message HTTP route** — `client-js@1.31.1` `sendMessage(message:string)` is
   string-only (`agent-controller.d.ts:404`). `/pe/messages` + `postPeMessage` + `toFiles` **stay**.
   See §2b.

3. **Message-cutoff fork** — `client-js@1.31.1` `cloneThread({sourceThreadId?,title?})`
   (`agent-controller.d.ts:449-452`) has **no** `upToMessageId`/`beforeMessageId`. `provider.tsx:452-467`
   `forkThread(messageId)` still ignores `messageId` and does a whole-thread clone. **KEEP** (degraded,
   per product). See MASTRA_UPSTREAM_CANDIDATES.md §"forkThread(messageId)".

4. **Thread-history hydration — RE-ATTRIBUTE.** PLAN.md cites `mastra#13645` as the reason thread
   hydration "stays ours". **Verified: #13645 is closed as *not planned*** and is about
   `chatRoute`/`useChat` **v5 message formatting** — a different surface. We use the agent-controller
   `session.listMessages()` route (`provider.tsx:141`), which exists and works. Our real client-side
   workaround is the **suspended-run replay-flood guard** (§2c, `provider.tsx:238-248`), which has no
   tracked upstream issue. Keep it; drop the #13645 citation from the ledger or repoint it at the
   replay-flood behavior.

5. **Lossy client-js event union** — `wire.ts` re-validates the SSE union because `client-js` types
   `om_status` as `{status:string}`, `om_observation_end` as `{}`, and collapses the rest into
   `OtherAgentControllerEvent` (`wire.ts:5-14`). No changelog entry widens these payload types.
   **KEEP** `wire.ts` (see §4 for the churn note).

---

## 4. Bump execution notes

**Rename churn (hard compile breaks — do these first):**
- `packages/runtime/src/models/resolve.ts:38` — `heartbeatHandlers: []` → `intervalHandlers: []`
  (#18665). Verified: `mastracode@0.30.0` `MastraCodeConfig.intervalHandlers?: IntervalHandler[]`.
- `apps/pe-code/src/runtime.ts:179` — `controller.stopHeartbeats()` → `controller.stopIntervals()`
  (#18665). These are the **only two** `heartbeat`-API sites in TS
  (`apps/web/src/workbench/claims.ts` and `apps/host/src/index.ts:28` are unrelated Pe-owned
  "heartbeat" concepts — do NOT touch).
- The core **heartbeats→schedules** rename (#18874: `mastra.heartbeats`→`mastra.schedules`,
  `Heartbeat`→`AgentSchedule`, config `heartbeat:`→`schedules:`) and the client-js
  `createHeartbeat*`→`createSchedule*` deprecation **do not touch us** — we use neither the scheduled-
  agent feature nor those client methods. Ignore.

**client-js event union (wire.ts) — expect zero forced changes, but re-verify:**
- The bump 1.28.0→1.31.1 added `steer`, `followUp`, `getOMRecord`, `setGoal`/`getGoal`,
  `getResourceIds`, `setResourceId` and the schedule methods. None are consumed by `wire.ts`/`adapter.ts`.
- `wire.ts`'s discriminated union mirrors event *payloads*, which the changelog doesn't touch. Risk is
  only if an event field was renamed silently — run the app and watch `parseWireEvent` drop rates
  (`provider.tsx:216-217`). Remove the `[wire-diag]` TEMP logging (`provider.tsx:218-228,673-680`)
  during this pass regardless.

**Memory / storage migration:**
- LibSQL auto-normalizes legacy `target.type:'heartbeat'` schedule rows on read (#18874) — no manual
  migration. Our DBs don't have schedule rows anyway.
- No OM config-shape break; `memory/profiles.ts` should compile untouched. New opt-in
  `observation.manageWorkingMemory` (#18654) is available if wanted — out of scope.
- `retention` (#18733) is opt-in; ignore for Phase 3.

**mastracode API changes to be aware of (none forced beyond the rename):**
- `./tui` (`MastraTUI` — `apps/pea/src/runtime.ts:244`, `apps/pe-code/src/runtime.ts:53`), `./acp`
  (`MastraCodeAcpAgent` — `packages/runtime/src/acp-server.ts:4`) subpaths still exported at 0.30.
  Verify `MastraTUIOptions` shape (`controller/session/authStorage/hookManager/mcpManager`) still
  matches — VERIFY-AT-BUMP.
- New: `runMC`/`runMCCli` headless runners + `./headless` export (replaces old `runHeadless`) — we
  don't use `runHeadless`, so no break.
- New: `mountAgentControllerOnMastra` / `prepareAgentControllerMount` — candidate to simplify
  `agent-controller-web.ts` `resolveServingTarget` (mastracode branch only). Optional.

**Post-bump live gate (PLAN Phase 3 exit — do NOT skip):**
- Drive a real approval (approve AND deny) end-to-end in apps/web. Confirm the buttons don't vanish
  and there's no replay flood BEFORE deciding whether §2c guards can be trimmed.
- Drive an image send + read-back. Confirms `/pe/messages` still needed (it will be) and the display
  path renders.

---

## 5. Deletion shortlist (ordered; LOC = source lines removed)

**Tier 0 — confirmed dead, delete now (not blocked on the bump):**
1. `packages/agent-projection/` — orphan. Only `dist/index.d.mts` + `dist/index.mjs` remain; **no
   `src`, not in `pnpm-workspace.yaml`, zero references** across packages/apps. Delete the directory.
   (~0 source LOC; removes a stale published-shape artifact.)
2. `packages/workbench-transport/` — same: orphan `dist`-only, not in workspace, zero refs. Delete.
3. Smoke markers (PLAN Phase 0 overlap, but they sit in mastra-touchpoint files):
   `agent-controller-web.ts:60,110` (`smokeMarker` in `PeWebInfo` + `"SDK-HOTSWAP-B"`),
   `apps/pea/src/runtime.ts:151` (`workbench.smokeMarker`). ~4 LOC + the type field.

**Tier 1 — delete right after the bump lands (mechanical):**
4. `apps/pe-code/src/runtime.ts:179` + `apps/web/src/workbench/provider.tsx:218-228,673-680`
   (`[wire-diag]` TEMP diagnostic + `stringifyShort`) — the diagnostic is explicitly TEMP; ~15 LOC.
   (The pe-code line is a rename, not a deletion — see §4.)

**Tier 2 — VERIFY-AT-BUMP, delete only after the live gate passes:**
5. Capture proxies **iff** `/pe/inspect` is re-sourced from native accessors:
   `packages/runtime/src/system-prompt-capture.ts` (52) +
   `packages/runtime/src/tool-list-capture.ts` (111) +
   `packages/runtime/tests/system-prompt-capture.test.ts` +
   `packages/runtime/tests/tool-list-capture.test.ts`, plus the wiring at
   `apps/pea/src/runtime.ts:17-18,85,92,118,152-153`. **~163 source LOC + 2 tests.** Blocked on §2d.
6. Suspended-run approval guards **iff** live approve/deny on 1.50.1 shows no button-vanish/replay-flood:
   `adapter.ts:154-155`, `provider.tsx:238-248`. Small (~15 LOC) but behaviorally load-bearing — do
   not delete speculatively. Blocked on §2c.
7. `storage/thread-state.ts` 5-branch walk (`:19-24`) collapse **iff** a stable public thread-state
   accessor appears (none at 1.15.1). Simplify, don't delete the file. Blocked on §2e.

**Explicitly NOT deletable (correcting the brief's assumptions):**
- `packages/runtime/src/interrupts.ts` (203 LOC) — the brief lists it as "already-dead". **It is
  live:** imported by `packages/runtime/src/context.ts:8` (`readRuntimeResumeDecisions`,
  `RuntimeResumeDecision`) and `packages/runtime/src/prompts.ts:3` (`RuntimeResumeDecision` type).
  Deleting it is a separate dead-code investigation of the context/prompts resume chain, **not** a
  mastra-bump consequence. Leave it out of Phase 3.
- `/pe/messages` + `postPeMessage`/`toFiles`/`toBase64`, `forkThread` degradation, `wire.ts` —
  all KEEP (§3 gaps 2/3/5). The bump does not obsolete them.

**Net Phase-3-attributable deletion if all VERIFY gates pass:** ~2 orphan packages + ~180 source LOC
(captures) + ~19 LOC (markers + diagnostics) + 2 test files, plus 2 one-line renames. The big, safe,
unconditional wins are the two orphan `packages/*` directories and the diagnostic/marker cleanup; the
capture-proxy deletion is the largest LOC win but is gated on re-sourcing `/pe/inspect`.
