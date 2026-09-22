# Unification review, runtime lane — 2026-09-16

Round one report. Owner: runtime partner (Herdr `unify-runtime`, checkout `Pe.Tools-unify-runtime` at `527048f`). No repo files changed except this one; all instrumentation was in-page and is gone on reload.

## Benchmark identity

| Item | Value |
|---|---|
| Chrome tab | Claude-in-Chrome MCP tab group 584747802, tab 1394038165, title "Positive Energy — Tools". Mine only. **`document.visibilityState` was `hidden` for the whole round** (the MCP window was not foreground), so rAF/paint timings could not be taken; CPU, network and React commit timings are unaffected by that. |
| URLs | `http://127.0.0.1:5173/chat?thread=aa327a56-7e4f-4a03-b2e5-85585938bf14` ("Revit API docs links", 59 messages, 1.70 MB body), `?thread=126ebb2e-…` (empty), `?thread=5003ff10-5e10-4130-8334-cf751d741f1f` (isolated test thread I created; one send) |
| Frontend | Vite dev PID 46900 on 5173 (HMR 4206) serving the **root checkout** `C:/Users/kaitp/source/repos/Pe.Tools` (main `527048f`, clean). Not my worktree, so no server-side instrumentation was possible without touching root's checkout; none was done. |
| Backend | `apps/host/src/dev.ts --take-over-host` PID 48680, 127.0.0.1:49307, started 16:37 |
| Revit | not attached throughout; nothing here touched Revit |
| Proof lane | attached browser on the React **dev** bundle with unbundled Vite modules. Ratios and shapes carry to installed; absolute ms do not. |

Method: disposable in-page probe (PerformanceObserver longtask/layout-shift/event, MutationObserver, `fetch`/`EventSource` wrappers with stack capture, a 50 ms DOM poll for blank states, and a React DevTools `onCommitFiberRoot` hook summing per-component `selfBaseDuration`). JS Self-Profiling API is blocked (`Document-Policy: js-profiling` not sent), so function-level CPU attribution is unavailable on the root server; component-level attribution below is React's own fiber timer, which is authoritative for render time but says nothing about layout/paint.

## Measurements (reproduced)

### Cold reload of `/chat?thread=<big>`
DOMContentLoaded 221 ms, `load` 391 ms, **first paint 3.9 s**, 246 module scripts. `/src/families/*` (another route) is fetched at 1.5 s: the route tree is not lazy. Sidebar reads "pick or start a thread" until a 1 s timer plus `listThreads` completes.

### Thread switch (sidebar click or browser back/forward), three runs

| Phase | Run 1 (empty → big) | Run 2 (back) | Run 3 (forward) |
|---|---|---|---|
| Click → DOM collapses to 212 nodes, "Loading thread state" | ~1.0 s | 2.4 s long task first | 0.2 s |
| `/pe/thread/<id>` fetched **twice** | 829 + 850 ms | 2443 + 1847 ms | (cached in probe) |
| readings `EventSource` closed/reopened | 2× | 2× | 3× |
| Body → first transcript paint (2.7 k nodes) | 4.2 s | 5.2 s | 7.5 s |
| Settled (4.2 k nodes) | 10.5 s | 12.5 s | 11 s |
| Long tasks after body | 2553, 552, 5338, 617 ms | 2175, 1584, 4787 ms | 1637, 603, 3447, 574, 926 ms |
| Full-tree commits after body | — | 9 × 414–1540 ms | 11 × 472–875 ms |

Big → empty still blanks for 1.0 s and fetches the empty thread twice (831 + 1000 ms). Unmounting the big tree is itself a 1.7–2.4 s long task.

### Idle on the big thread (22 s, no input)
Four 830-byte `host-status` SSE snapshots (host polls at 5 s) → four full-tree commits of 647, 707, 1230, 1568 ms. Over a later 90 s window the heartbeat long task was 413–723 ms every 5.0 s. **`Markdown` is 470–1106 ms of that self time every commit; everything else ≤ 200 ms.**

### Typing in the composer (big thread mounted)
242 commits for 89 keystrokes; the keystroke commits themselves are ~1 ms (atom-owned draft, tree bails out). The 300 ms URL `prompt` patch triggers a router navigation and a further full-tree commit (690, 642 ms). Input-event latency could not be measured while hidden.

### New thread from the composer verb
Three full-tree commits of the *old* thread (568, 477, 773 ms) before the provider remounts, then three EventSource reopens, then the usual double fetch.

### One send on the isolated test thread (no tools, no Revit)
Cheap: 54 commits totalling 958 ms, long tasks 289 + 147 + 4 × ~100 ms; `/pe/thread` refetched twice after `message_end`. **Outcome unknown: the run ended with the composer head reading `RUN FAILED.` and no reason.** The UI shows the fallback `Run failed.` (`thread-stream.ts` `agent_end reason=error` with no error text); the thread holds only my prompt; the model was `anthropic/claude-opus-5` (the big thread had run `gpt-5.6-sol`). I did not find the host log within budget (`local-ops.ts productLogPaths` under `%LOCALAPPDATA%`), so the cause is unverified. No further sends were made.

### Payload composition
The 1.70 MB thread body: tool results 1.37 MB (two assistant messages of 655 KB and 335 KB), reasoning 80 KB, visible text 59 KB, tool args 50 KB, `inspect` 30 KB. Per SSE open the server also replays `{"kind":"receipts"}` (22.5 KB) plus five per-call receipts of 32–221 KB.

Settled DOM: 4165 nodes, 2567 `span` (2154 inside 29 `pre`, highlighting), 109 `button`, 27 `svg`. Layout shift over the whole round: CLS 0.005.

## Ownership and caller census (cited)

| Owner | Where | Lifecycle | Measured consequence |
|---|---|---|---|
| Provider keyed by thread | `routes/chat.tsx:60` `<WorkbenchProvider key={thread ?? "draft"}>` | every thread change unmounts store, session, stream, shell, hotkeys, panes | the blank; 1.7–2.4 s unmount; sidebar re-fetch; pane state reset |
| Page store | `workbench/store.ts` via `useRouteOwner` (`route/use-route.ts:278`) | recreated with the provider | palette/lens/draft reset per thread |
| `host-status` reading | `provider/view.tsx:54`, `route/shell.tsx:38` (lamp), `host/world-log.ts:75` | `readings.ts` `PeReadings.schedule/open`: any key join or leave opens a **new** `EventSource` and retires the old on `onopen` | 2–3 reconnects per switch, each replaying every snapshot (~380 KB seen) |
| Host heartbeat | `apps/host/src/resource-adapters.ts:44` `POLL_MS host-status 5_000`, `oneShot` publishes with no equality gate; `readings.ts advance()` always allocates a new `ready` object | a new `info` every 5 s whether or not anything changed | one full-tree commit per 5 s |
| Provider context | `provider/view.tsx` context `useMemo` deps include `info`, `chat`, `threads`, and every callback | new context value per heartbeat/frame | every `useWorkbench` consumer re-renders |
| Transcript | `workbench/moments.tsx:212` `Part` → `<Markdown>` (`prose.tsx`, react-markdown + GFM); no `memo` in `moments.tsx` | re-parses every text part on every ancestor render | 470–1160 ms per commit on 16 text parts |
| Code blocks | `components/lang/code.tsx` `highlightToHtml` in `useMemo` | memoised per `code` | ≤ 57 ms per commit; DOM weight only |
| Thread body | `provider/thread-stream.ts:41` `useHostCall` → `/pe/thread/:id` (`packages/runtime/src/agent-controller-web.ts:103` → `thread-state.ts readThreadState`, full `queryThreadMessages`) | effect mounts, is torn down and re-run through React `reconnectPassiveEffects` (stack captured); the `AbortController` signal is never passed to `fetch` | the double 1.7 MB fetch on every switch |
| Route readings | `chat/manifest.ts:49` `head`, `inventory`, `receipts` (bare) subscribed by `useRoute` per mount; `chat/scope.ts` `thread-head` per thread; `actions/receipt.tsx:35` per call | each is a key join/leave on remount | the reconnect storm above |
| Display frames | `thread-stream.ts` `session.subscribe` after `hydrated`; `invalidatingEvents` refetch the body | one refetch per `message_end`/`agent_end` | two body fetches per send |
| Thread list | `provider/view.tsx` `refreshThreads` 1 s after `loading` clears | per provider instance | sidebar empty ≥ 1 s per switch |
| Route handle | `chat-shell.tsx` `useMemo(chatManifest…)` deps include `chat.display`, `sendPrompt` | new manifest most frames | not separated |

## Reproduced vs suspected
Reproduced: every row above with a measured consequence, plus the unexplained `RUN FAILED.`
Suspected only: layout/paint share of the long tasks (hidden tab, no frames); plugin-pane cost; reconnect after a real host restart (not attempted: it would disturb the shared dev host).

## History as evidence
`50e3f01` "chat draws its own message list; assistant-ui leaves" removed the virtualised list; nothing replaced its memoisation, which is when the per-commit markdown cost became proportional to thread length. `e0b8008` "readings swap streams without a gap" made topology swaps open a second stream before closing the first, which is correct for the lamp but multiplies replay traffic when remounts churn keys. `fd5dbd5`/`8758c48` added `chatLoading` gating on `host-status`, so a status reconnect now also gates the transcript. None of these commits is wrong alone; together they make thread identity, stream identity and status identity one React key.

## Candidate shapes

**A. Keep the keyed provider, memoise the leaves.** `memo(Markdown)` on `text`, `memo(AssistantMoment)` on message identity, split the provider context into `session`/`chat`/`threads`/`status` contexts, dedupe `host-status` by value on the host (or in `advance`). Pass the abort signal to `fetch`. Fails when: any new consumer reads the fat context again; the blank on switch stays because the provider still remounts.

**B. One provider per route, thread as state.** Mount `WorkbenchProvider` once under `/chat`; thread id becomes a prop/atom; `useThreadStream` keys its own state on thread id (it already resets `frame`/`sent` by `threadId`). Readings keys `inventory`, `receipts`, `host-status` stay subscribed across switches, so the EventSource never reopens on a switch; only `thread-head` joins/leaves. Store keeps pane widths and palette across threads; draft and lens intent reset explicitly. Plus A's leaf memoisation. Fails when: thread-scoped state is forgotten in the store and leaks between threads (draft, approvals set, `sent`); needs one explicit "thread changed" reset list.

**C. B plus a thinner body.** `/pe/thread` returns messages with tool results elided past N KB behind the existing per-call `receipts` reading (the transcript already subscribes per call), and the stream keeps display frames. Cuts 1.37 MB of 1.70 MB per fetch and most of the parse. Fails when: a tool result must be visible inline for the ledger's "inspectable evidence" rule; then it is fetched on expand.

**D. Do not commit on heartbeat at all.** Host publishes `host-status` only on change; browser `advance` keeps object identity on equal snapshots. Independent of A–C, smallest diff, removes the idle 5 s cost entirely. Fails when: a consumer relies on the tick as a clock (none found in the census; `useCacheView` diffs on `userTurns`, not time).

Retired-owner / LOC opportunities under B+C+D: the `key={thread}` remount, the 1 s `refreshThreads` timer, the `sent` reconciliation array (once display frames are the only mid-turn source), one of the three `useHostStatus` call sites (the provider can pass `info` down), the duplicate fetch. Roughly −80 lines in `view.tsx`/`chat.tsx`, +20 for the explicit reset list.

## Decisions for the user

1. Provider identity: keep one provider per thread (A) or one per route with thread as state (B)? B is the only shape that removes the blank; A only shortens it.
2. Thread body contract: may `/pe/thread` elide large tool results behind the per-call receipts reading (C), or must the full result ship inline?
3. Heartbeat: may the host publish `host-status` only on change (D), or does something need the 5 s tick as a liveness signal in the UI? (The lamp can keep a "last heard" timestamp from the stream itself.)
4. The failed send: should root or the user read the dev host terminal for the `5003ff10` run error, and should the UI surface the `agent_end` error text instead of `Run failed.`? I stopped sending after one failure.
5. Profiling lane: to get function-level CPU (and paint) numbers I need either the root server to send `Document-Policy: js-profiling` (one Vite `server.headers` line) or permission to start my worktree's own `dev:no-revit` pair through Herdr on separate ports. Which?
6. The benchmark window must be foreground for paint/rAF/input-latency numbers; who brings it forward, and when?

## Broader findings (outside the 47 commits)
- `readings.ts` caps frames at `READING_MAX_FRAME_BYTES`; the 221 KB per-call receipt frame is under it but a larger tool result will turn a reconnect into `lost()` and a 1 s retry loop. Not reproduced; worth a bound on the host side.
- The route tree fetches other routes' modules on `/chat` load (3.9 s first paint in dev). Installed lane bundles differently; unmeasured there.
- `useHostCall` returns a new object each render (the comment in `thread-stream.ts` already documents one bug this caused).

---

# Round 2 — checkpoint 1 (2026-09-16, ~17:45)

## Evidence corrections to round 1
- The benchmark tab was `hidden` for every round-1 measurement. Chrome throttles timers and can deprioritise work in hidden tabs, so **round-1 absolute timings (including CPU and network) are provisional**, not "unaffected" as first written. Shapes (double fetch, reconnect count, heartbeat-driven commits, Markdown dominance) are structural and were confirmed from source and stack captures; magnitudes will be re-run foreground.
- Round-1 "self time" came from React's `selfBaseDuration`, which is the last *base* render estimate, not the actual CPU spent in that commit. Round 2 uses per-fiber `actualDuration` (this commit's real render time, inclusive of children, minus children) and, on my own server, the JS Self-Profiling API for function-level samples. Neither includes style/layout/paint; those are measured separately from long-task tail after the commit and from rAF frame timing, foreground only.
- "First transcript paint" in round 1 was a DOM node-count timestamp, not a paint. Renamed to "DOM restored" below; paint timings come from foreground rAF/`paint` entries.

## Failed isolated send: diagnosed (read-only)
The send on thread `5003ff10-…` at 17:01 coincided with a **host takeover**: `%LOCALAPPDATA%/Positive Energy/Pe.Tools/state/service/host-source-3a8196893e0b.log` records a supervisor spawning a `dev` lane at 22:01:05Z (17:01:05 local), and the process table shows `Pe.Tools-pod-feature-review/.../apps/host` starting `src/dev.ts` at 17:01:07–09 (PIDs 38052 → 3976 → 52888). Root's original host (PID 48680) is gone; the current root pair is PID 54248 (host, 17:12:56) and PID 52092 (Vite 5173, 17:13:11). The turn died with the backend, and the browser rendered the `Run failed.` fallback because `agent_end` carried no error text. So: environmental, not a chat-runtime bug, but two product findings stand: (1) `--take-over-host` from another checkout silently kills in-flight turns on the shared port; (2) the UI must surface the `agent_end` reason and "host changed under you", not `Run failed.`

## Foreground status
`window.focus()` from the page cannot raise the window; `visibilityState` is still `hidden`. **Exact user action needed:** click the Chrome window whose active tab is titled "Positive Energy — Tools" at `http://127.0.0.1:5173/chat?thread=5003ff10-…` (Claude-in-Chrome tab group 584747802) so it is the foreground window, then leave it alone. I re-verify `visibilityState === "visible"` before recording anything.

## Own server for profiling
Worktree `Pe.Tools-unify-runtime` now carries one disposable change: `apps/web/vite.config.ts` `server.headers: { "Document-Policy": "js-profiling" }`. `vp install` is running; next `dev:no-revit` starts through a Herdr pane, ports will be published here. Root's server is untouched.

## Root's source check (received): accepted into the contract work
- `useHostCall` keeps `data` across dependency changes, so provider reuse would show thread A's body under thread B until B hydrates; any non-remount shape must tag data with its thread id or scope the stream per thread.
- `openThread` patches only `thread`, so `prompt`/`turn` travel to the new thread; shared pane state vs thread-scoped URL state must be separated explicitly.
- Async completions (`rename`, `fork`, approvals) write provider-wide `error`/`threads` after awaiting; a persistent provider needs original-thread custody for those completions.
These, not a reset list, are the ownership contract's subjects. Draft follows at checkpoint 2.

# Round 2 — checkpoint 2 (~18:05)

## Identity (own server, root untouched)
Browser `http://127.0.0.1:5175`, backend `http://127.0.0.1:49843` (host PID 40668, `dev:no-revit`, service `host-source-f11a0c7af171-no-revit`), checkout `Pe.Tools-unify-runtime` at `527048f` plus two disposable edits: `apps/web/vite.config.ts` and `apps/host/scripts/dev-web.ts` (a middleware adding `Document-Policy: js-profiling`). Herdr panes: `w1:p2` runs the pair; `w1:p3` hosts delegate `receipts` (codex, gpt-5.6-sol, low) in sibling worktree `Pe.Tools-unify-runtime-receipts`, writing only `docs/features/agent/RECEIPTS-FORMATS.md` there. The no-revit lane reads the same thread store (the 59-message thread is present), so thread identity is preserved. Tab still `hidden`; every number below is hidden-tab and therefore throttled (Self-Profiling clamped to ~25 ms effective sampling, timers coalesced). The same exact user action as checkpoint 1 is still needed for paint/input numbers.

## Attribution with actual timers and the sampling profiler (hidden tab)
Thread switch empty -> big on my server, two runs, per-commit `actualDuration` (this commit's real render time), self = own minus children:
- 11-12 full-tree commits of 436-840 ms in the 7 s after the body lands; `Markdown` self 308-696 ms of each (13-16 instances rendered per commit). Heartbeat commits then continue at 5.0 s: 436-522 ms.
- Sampling profiler, inclusive by module over the switch window: `react-dom` 100 % of busy samples (the work is inside React render/commit), `react-markdown` (micromark/mdast) 57 %, `scheduler` 40 %, `react/jsx-dev-runtime` + `jsx-runtime` 26 % (dev-only element validation), `remark-gfm` 8 %, `lens/model.ts` 7 %, `moments.tsx` 6 %, `code.tsx` 2 %. Top self frames: jsx-dev-runtime element creation, micromark `debug`/`go`/`consume`/`enter`, `lens/model.ts:246` (the scroll-geometry effect writing wick/caret styles), `unist visit`.
- Limits: hidden-tab sampling under-counts; the dev bundle inflates jsx-dev-runtime and micromark `debug` (the `debug` package formats even when disabled). The ratio "markdown parse dominates a commit, code highlighting does not" is robust across both rounds and both servers; the absolute ms are not.
- Thread body on my host: 67-76 ms for the same 1.7 MB (549 ms for the empty thread's first fetch, which is the `listAvailableModels` call, not the messages). Root's host answered the same in 830-2443 ms; the difference is root's host load, not the payload. Still fetched twice.

## The double fetch is StrictMode, dev only
Stack of the second `/pe/thread` fetch: `commitHookPassiveMountEffects > reconnectPassiveEffects > doubleInvokeEffectsOnFiber`. `doubleInvokeEffectsOnFiber` is React's StrictMode effect replay. StrictMode comes from TanStack Start's default client entry (`@tanstack/react-start/dist/plugin/default-entry/client.tsx:8`, `<StrictMode><StartClient/></StrictMode>`), not from repo source. Production fetches once. What remains a real defect in both lanes: `useHostCall` creates an `AbortController` and the `run` in `thread-stream.ts:41` ignores `signal`, so a thread change mid-flight lets the old request run to completion (the result is dropped by the `aborted` guard, so no stale body lands; bandwidth and host time are wasted). Cancellation end to end: switch -> provider unmount -> `useHostCall` cleanup `controller.abort()` -> nothing observes it -> response arrives -> `if (!controller.signal.aborted)` discards it. Stale-response safety today comes from the discard, not from cancellation, and it holds only because the provider remounts per thread.

## Reconnect after a backend restart (observed on root's server, not induced)
When root's host was replaced at 17:12 the page on 5173 reconnected its readings stream but the thread body query reported `Thread sync failed (502)` and stayed there; `useHostCall` has no retry and `invalidatingEvents` only refetch on agent events. The lamp recovers, the transcript does not.

## New confirmed direction (activity-suspense-verdict.md) folded in
Retain each thread's unsent draft and attachments within the mounted app; prefer React 19 `Activity`; explicit loading for the newly selected thread, never the old transcript; sidebar stays populated; consider Suspense at pane/workspace boundaries generally. B/C/D labels are still not approvals.

Facts that bound an `Activity` design (verified in source):
- React 19.2.7 is installed; `Activity` is exported.
- `useRouteOwner` (`route/use-route.ts:278`) disposes the page store in its effect cleanup (`setTimeout(dispose, 0)`). Activity hide runs effect cleanups, so hiding a thread would dispose the very store that holds the draft (`page/composer` atom, attachments included). An Activity shape must tie disposal to true unmount (ownership released by whoever owns the Activity list), not to effect cleanup.
- Attachment previews are object URLs revoked only when the attachment list changes (`composer.tsx:75`); hide does not revoke; unmount does not revoke either (existing leak on remount).
- `useThreadStream`'s subscription lives in an effect; hide tears it down, reveal re-subscribes and the server opens every attach with a snapshot frame, so a thread that ran while hidden reconciles its display frame on reveal. The body query does not refetch on reveal (effect deps unchanged) unless an invalidating event arrives; a thread that finished while hidden shows its pre-hide body until the next event. That is the reveal-reconciliation gap.
- Hidden Activity subtrees still receive context updates at low priority. With the provider context changing every 5 s, N hidden big transcripts would each re-parse markdown at idle priority: heartbeat cost multiplies by visited threads unless the transcript is outside the retained subtree or unchanged heartbeats stop causing commits.

## Proposed ownership contract (draft for root; no code)
Persistent shell (one per `/chat` mount, never keyed by thread): readings stream and its keys (`host-status`, `inventory`, bare `receipts`), thread list, pane widths/palette/side-expanded, route hotkeys, the Mastra client. Thread scope (one per visited thread, retained while the app is mounted): draft + attachments, lens intent/pin, `sent` reconciliation, approvals-in-flight set, body query and display frame, `thread-head` reading. Transitions: selecting a thread reveals its scope and hides the previous; a first visit mounts the scope in an explicit `loading` state while sidebar and composer chrome stay. Cancellation: a scope hidden mid-fetch keeps its request (it is that thread's) and lands the body into its own scope; nothing lands into another thread because data is addressed by scope, never by "current". Async completions (rename/fork/delete/approve) write to the scope they started in; shell-level `error` becomes per-scope. Outcomes: `agent_end` error text, "host changed under you", and body-fetch failure are per-scope states with a retry, distinct from `loading` and `empty`.
Retention bound: the retained subtree per thread is the scope state plus the composer, not the transcript DOM; the transcript remounts from the scope's body on reveal. This is still Activity (around scope + composer) with the heavy transcript under a thread-keyed boundary. Alternative: Activity around the whole thread pane (simplest, retains DOM, multiplies heartbeat cost until unchanged heartbeats stop rendering).

## Questions narrowed (product, not mechanism)
1. May a transcript that finished while hidden show pre-hide content until the next event on reveal, or must reveal refetch the body?
2. May an unchanged heartbeat stop producing renders, with liveness carried as an observed-at timestamp the lamp reads?
3. If receipts cover only some tool-result shapes (delegate proof pending), is a per-call lazy fetch for the rest acceptable, or must results stay inline?

# Round 2 — checkpoint 3 (~18:30): Activity spike, receipts proof, narrowed questions

## Throwaway Activity spike (my worktree only; `routes/chat.tsx`, `provider/view.tsx`, marked `ponytail: DISPOSABLE SPIKE`)
Every visited thread stays mounted inside `<Activity mode="hidden">`; the thread id is a prop so a hidden instance keeps its own. Measured on my server (tab still hidden, so magnitudes are throttled; the behaviours are not):

| Observation | Result |
|---|---|
| Draft typed in thread E, switch to big thread B | B's composer showed E's draft: the URL `prompt` travelled (`store.ts openThread` patches only `thread`) and B's fresh store seeded its draft from `search.prompt`. Root's second check point, reproduced. |
| Switch back to E | E's composer was **empty**: `useRouteOwner` disposed E's store on Activity hide (effect cleanup), exactly the trap the verdict warned about. Draft retention via Activity fails until owner disposal is tied to true unmount. |
| Heartbeats while B is hidden (16 s, 4 heartbeats) | commits of 40–49 ms, **zero** `Markdown` renders inside the hidden tree. Hidden subtrees pay nothing per heartbeat because their subscriptions (atoms, readings, thread stream) are effect-based and Activity disconnects them. |
| Reveal of retained B | no "Loading thread state" (DOM retained), but **19 full-tree commits of 433–790 ms in 12 s** (each renders all 16 `Markdown`s), 1 body refetch, 2 readings stream reopens. Every reconnecting subscription fires its own update, and nothing in the transcript is memoised, so reveal is slower than a fresh mount today. |
| Readings stream | hide = key leave, reveal = key join, so the reconnect storm is unchanged by Activity. |

Conclusions the spike supports: (1) `memo` on `Markdown`/message by identity is a prerequisite for every shape, including Activity; (2) Activity gives free hidden-time but not free reveal; (3) owner disposal and URL-carried draft/turn must move before Activity can retain anything.

## Tool-result elision: falsified as "receipts only"
Delegate report (Sol low, source-only at `527048f`): `Pe.Tools-unify-runtime-receipts/docs/features/agent/RECEIPTS-FORMATS.md`. Receipts exist only for admitted host operations, workflows and mutating pods; `pe_find`, read-only `pe_read`, route reads/writes, docs tools, `diagram`, media/progress payloads, validation failures and `ask_user` payloads have no receipt, and even admitted actions lack the transcript wrapper (Scope `revision`, resolved `target`, full args, synthesized error, parent message). So elision needs a transcript-owned lazy source keyed by thread and call id; receipts stay the action-detail source where an action id exists. The 1.37 MB question is now "may large results load on expand from a per-call endpoint", not "can receipts replace them".

## Foreground
Still `hidden` at every check; `window.focus()` cannot raise the window. Exact user action unchanged: bring the Chrome window with the tab "Positive Energy — Tools" (Claude-in-Chrome group 584747802) to the foreground. Until then no paint, layout or input-latency numbers are claimed; the round-1 table's absolute figures are provisional.

## Questions for the user (product tradeoffs only)
1. On reveal of a thread that ran while hidden: accept its pre-hide transcript until the next event, or require a refetch (one extra body fetch per reveal)?
2. Liveness: may the host publish `host-status` only on change, with "last heard at" carried on the stream and read by the lamp, so an unchanged heartbeat produces no render?
3. Large tool results: load on expand from a per-call endpoint (transcript shows size and a "show" control), or keep inline and accept the 1.7 MB body and its parse?
4. Draft and `turn` in the URL: keep `prompt`/`turn` as shareable URL state but strip them on thread change, or drop URL drafts entirely now that drafts are retained in the app?

## Disposable state to clean before integration
My worktree: `vite.config.ts` + `dev-web.ts` header, the Activity spike in `routes/chat.tsx` and `provider/view.tsx`. Herdr: pane `w1:p2` (my dev pair, ports 5175/49843), pane `w1:p3` (delegate `receipts`, idle), worktree `Pe.Tools-unify-runtime-receipts` on branch `review/unify-runtime-receipts`. Root's server and Revit untouched throughout.

# Round 3 — checkpoint 1 (~18:50)

## Foreground blocker
Tab 1394038165 (`http://127.0.0.1:5175/chat?thread=aa327a56-…`) still reports `visibilityState: hidden`, `hasFocus: false` at the start of round 3. No paint/layout/input numbers will be collected while hidden. The instrumented benchmark is ready to run the moment the tab reports `visible`; it re-checks visibility before and after each measurement and writes raw JSON to `.artifacts/runtime-bench-20260916/`.

## Work proceeding meanwhile (my worktree, spike only)
1. Reveal reconciliation: `useThreadStream` re-reads the body once when its subscription effect runs again for a thread it already subscribed (a ref survives Activity hide; the first mount does not refetch). One fresh body read per reveal, then the server's snapshot frame restores display. No waiting on a future event.
2. Equal status data: `advance()` keeps the previous `ready` object when a snapshot is deep-equal to the retained observation; `stale`/`failed`/`gap` transitions still allocate, so disconnection semantics are unchanged.
3. `openThread` strips `prompt` and `turn` when the thread changes; `?turn` still addresses a turn on a direct open of that thread. URL drafts remain an open product decision (not removed here).
4. Route-owner census delegated to Sol low (`ROUTE-OWNER-CENSUS.md` in the delegate worktree) to place "dispose on true unmount" at the shared seam.

Cross with the surface prototype (port 5181, `UNIFICATION-SURFACE.md` "draft retention and the loading boundary"): it uses `Suspense` + `use()` on a per-thread cached promise for the body and one `Composer` per visited thread under `Activity`. That matches this lane's contract on boundaries, with two runtime facts it must absorb: the composer's store is disposed on hide today (`useRouteOwner`), and a cached per-thread promise is stale after a hidden run unless reveal re-reads (item 1).

# Round 3 — final (~19:05)

## Foreground
Blocked the whole round: `visibilityState` was `hidden` at every checkpoint (start, idle-end, hide, reveal, end) including after the extension reconnected. The browser extension also dropped once mid-round and came back on the same tab. No paint, layout or input-latency numbers exist. The benchmark script records rAF frame presentation, event timing and layout shift only when `visible`, and writes raw JSON under `.artifacts/runtime-bench-20260916/` (two hidden runs saved: `r3-spike-run1-hidden.json`, `r3-spike-run2-memo-hidden.json`). The only remaining blocker is the same user action: make the Chrome window holding tab "Positive Energy — Tools" (`127.0.0.1:5175`) the foreground window.

## Spike results (my worktree only, all marked `ponytail: DISPOSABLE SPIKE`)
Patches: `readings.ts advance()` keeps the `ready` object when a snapshot deep-equals the retained observation (stale/failed/gap still allocate); `thread-stream.ts` re-reads the body once when the subscription effect runs again for the same thread (Activity reveal); `store.ts openThread` strips `prompt` and `turn`; `prose.tsx` `memo(Markdown)`; the Activity-per-visited-thread wrapper from round 2.

| Case (hidden tab) | Before spike | After spike |
|---|---|---|
| Idle 16 s on the 59-message thread | 4 heartbeat commits, 400–700 ms each | **0 commits, 0 long tasks** |
| Switch away: URL and next thread's draft | `?prompt` travelled, draft leaked | URL `?thread=…` only, no leak |
| Reveal of a retained thread, body refetch | none (waits for an event) | 1 read (2 in dev: StrictMode replays the effect) |
| Reveal render, no memo | 9 commits × 591–721 ms, 16 Markdown parses each, long tasks 649/1523/1455/762 ms | — |
| Reveal render, `memo(Markdown)` | — | 7 commits of 66–228 ms, **0 parses**, longest task 337 ms |
| Draft in the hidden thread after reveal | lost | still lost (owner disposed on hide; seam below) |

The equal-snapshot identity preserves liveness: a `stale`/`failed`/`gap` frame is a different state and still allocates, so the lamp's disconnected/unreachable transitions are unchanged; only "same value again" stops rendering.

## Route-owner census (delegate, source-only): `Pe.Tools-unify-runtime-receipts/docs/features/agent/ROUTE-OWNER-CENSUS.md`
Three runtime callers of `useRouteOwner`: `useRoute` (every route's readings, work document, action state), `DataTablesWorkspace` (apply/failure/conflict/log), `WorkbenchProvider` → `createChatPageStore` (draft, attachments, pane selection, lens pin/intent, world state, timers). All three are broken by Activity hide because `useRouteOwner` disposes from an effect cleanup with a 0 ms timer that only an immediate re-setup (StrictMode) cancels. React exposes no "hidden vs unmounted" signal to the child, so the fix is not a smarter timer.

## Minimal shared ownership proposal (Activity + Suspense, no reset list, no cache layer)
- **What owns retained state:** the persistent `/chat` shell holds a `Map<threadId, ChatPageStore>` (one `createChatPageStore` per visited thread) plus the one readings stream, thread list and pane geometry. A thread's provider receives its store; it never creates or disposes one.
- **What disposes on actual removal:** the shell, when it drops a thread from its visited list (route unmount, explicit close, or a future eviction policy the user chooses), calls `store.dispose()`. `useRouteOwner` keeps its current contract for the callers that are never hidden; the chat caller moves to shell ownership. Attachment object URLs are revoked by that same disposal, which fixes the existing unmount leak.
- **Which fetch path suspends:** the thread body only. `useHostCall`'s effect-fetch cannot suspend; the body becomes a per-thread promise owned by the thread scope (`readThreadBody(threadId)` cached on the scope, not in a generic cache), read with `use()` under a `Suspense` boundary inside the transcript pane. Display frames, thread list, readings and the composer stay outside the boundary, so sidebar and composer never fall back.
- **Boundaries:** one `Suspense` per transcript pane (loading body); one error boundary at the same seam with `retry` = replace the scope's promise; `empty` is a rendered body, not a boundary. The shell, sidebar and composer sit above both.
- **How reveal recovers authoritative state:** on reveal the thread's subscription effect re-runs; the server's attach snapshot restores display, and the scope replaces its body promise once (the spike's `subscribedRef` rule), so a run that finished while hidden reconciles immediately; nothing waits for a future event. First mount does not double-read.
- **Cancellation and stale responses:** the scope's promise carries the thread id; a response can only settle the scope it belongs to, so a switch mid-flight cannot land under another thread. The abort signal is passed to `fetch` for hygiene, but correctness comes from scope addressing.
- **Retention bound:** with `memo(Markdown)` a retained transcript costs nothing while hidden and ~1 s on reveal; without it reveal costs more than a fresh mount. Whether the whole pane or only composer + scope is retained is now a memory question, not a CPU one.

## Cross with the surface prototype (`localhost:5181/prototype-root`, `UNIFICATION-SURFACE.md`)
Agrees on: `Suspense` + `use()` per-thread body promise inside the pane; loading/error/empty as three bodies; one `Composer` per visited thread under `Activity`; no second persistence owner. Runtime facts it must absorb: (1) the composer's store is disposed on hide today, so its Activity claim needs the shell-owned store above; (2) its "cached per thread, revisit is instant" promise is stale after a hidden run and must be replaced on reveal; (3) the readings stream still reopens on every hide/reveal (key leave/join) until the readings subscriptions live in the shell rather than in the thread subtree.

## Still open for the user (product)
1. Large tool results: root is asking; no endpoint added.
2. URL drafts (`?prompt`): keep as shareable state on the same thread, or retire now that drafts are retained in-app. Stripping on thread change is done in the spike either way.
3. Retention policy for visited threads: unbounded within the session, or a cap the user sets. No eviction guessed.

## Disposable state (unchanged): my worktree edits (6 files), Herdr panes `w1:p2` (dev pair 5175/49843) and `w1:p3` (delegate, idle), worktree `Pe.Tools-unify-runtime-receipts`. Root's server and Revit untouched.

## Root's follow-up: two mechanisms compared (no timer/visibility tricks)
**A. Hoist retained owner lifetime above Activity; make subscriptions restartable.** The shell owns `Map<threadId, ChatPageStore>`; thread subtrees receive a store and subscribe in effects that are torn down on hide and re-run on reveal (readings atoms, thread stream, host status already are effect-subscriptions, so they restart for free). Actual removal = the shell dropping the map entry, which calls `dispose()` (atoms unmounted, timers cleared, object URLs revoked). Cost: the store abstraction and registry stay; every thread-local atom is still a registry citizen with labels and inspector rows.

**B. Remove external ownership for React-local state.** Draft text, attachments, palette open, lens pin/intent, world density/open sets are read by nothing outside the thread subtree except the inspector. As `useState`/`useReducer` inside the retained subtree they survive Activity hide natively, need no owner and no disposal; a thread's removal from the shell's visited list unmounts the subtree and React drops the state. Resources that need explicit release: `prompt`/`turn` URL timers (clear in effect cleanup, harmless on hide because the effect re-runs), attachment preview object URLs (replace with the `data:` URL already held in `attachment.data`, so there is nothing to release), the thread stream subscription (already effect-scoped). What remains in the registry: the route owner's action state and log (`useRoute`), which are shared with the Situation and inspector, and the readings stream, which moves to the shell. Actual removal releases nothing but memory.

Comparison: B is smaller (deletes `createChatPageStore`'s owned atoms and the `set`/`core.write` wrappers for local state; keeps `runAction`/log in the route owner) and removes the disposal problem instead of relocating it. Its costs: the inspector loses the `page/*` atom rows unless the store exposes React state some other way, and the URL `prompt` mirror must be written from an effect on the draft state instead of the store setter. A is the right shape for state that must outlive the subtree or be read across panes (pane widths, thread list, readings); B for state that belongs to one thread. Recommendation: B for thread-local state, A only for the shell's own map of visited threads and the shared readings stream; no hide-specific guard anywhere.

# Round 3 — foreground evidence and final contract (~19:40)

## Foreground run (valid): tab 1394038165, `visibilityState: visible` at all five marks
Raw: `.artifacts/runtime-bench-20260916/r3-foreground-spike.json`. Condition: my server 5175/49843, spike ON (equal-snapshot identity, reveal refetch, `openThread` strips `prompt`/`turn`, `memo(Markdown)`, Activity per visited thread). Measures: React `actualDuration` per commit, `longtask`, `layout-shift`, fetch round-trips, and two **proxies** that root has correctly labelled: "task tail" (commit end → end of the same task: DOM mutation, passive effects and whatever style/layout Chrome runs before yielding) and "render-to-frame" (commit → second rAF). Neither isolates CSS, style recalculation, layout or paint; the Chrome tracing counters that would are not reachable from the extension, so **individual CSS/layout/paint attribution remains unproven**.

| Case | Result |
|---|---|
| Idle 10 s on the 59-message thread | 0 commits over 50 ms, one 89 ms long task, no rAF gap over 50 ms |
| Switch to the empty thread (hide big) | body 666 ms (dev double fetch 665 ms), one 65 ms commit, render-to-frame 23 ms, one 83 ms rAF gap, CLS 0.001 |
| Reveal retained big thread | body re-read 368 + 215 ms; commits 119/130/68/52 ms with **0 Markdown parses**; task tails 382/222/138/5 ms; render-to-frame 416/256/171/11 ms; rAF gaps 567/150/67 ms; long tasks 95/73/61/61 ms; CLS 0.001 |
| Fresh mount of an unvisited small thread | body 585 ms (×2 dev), one 85 ms commit, render-to-frame 19 ms |
| Typing 94 keys | the extension delivered the burst in ~550 ms; per-key commits 3–6 ms; one 514 ms task processing the burst. **Not human input latency**; event durations overlap the burst |

Reading: with the spike, a switch to a retained big thread is one ~570 ms frozen frame at the click plus ~250 ms of tail, and idle costs nothing. The 382 ms task tail after a 119 ms render is the one place style/layout of a 2.7 k-node tree plausibly lives, but that is inference, not measurement.

## Baseline: no valid visible run
Two baseline attempts (memo and equal-snapshot reverted) both reported `hidden` at every mark (`r3-baseline-nomemo-HIDDEN.json`, `r3-baseline2-nomemo-HIDDEN.json`); the window lost foreground as the runs began, and each run froze the renderer past the tool's 45 s limit. They show the same shapes as rounds 1–2 (heartbeat commits of 435–659 ms re-parsing 16 Markdown parts; reveal 18 commits with long tasks up to 2.3 s) but **no comparative speedup claim is made** until one visible baseline exists. To take it, the window must stay foreground for ~35 s while my tab is driven; I will not repeat hidden baselines.

## Attribution corrections
- **Takeover claim withdrawn as unproven.** `host-program.ts:29` passes `hostOwnership.serviceName` to `evictLiveHost`, and `host-lifecycle.ts:127` evicts only the same-name predecessor; the root checkout's service is `host-source-3a8196893e0b`, and another checkout cannot name it. The 17:01 line in `host-source-3a8196893e0b.log` ("supervisor … spawning 'vp' lane=dev") is root's own supervisor respawning, consistent with `dev-watch` restarting on a host source change. What stands: root's host was replaced twice (17:01, 17:12), the in-flight turn died, the UI showed `Run failed.` without a reason, and the transcript later stuck on `Thread sync failed (502)`. Cause of the restarts: unproven.
- The equal-snapshot identity works because `readings.ts` `makeAtoms` already skips `setSelf` when `advance` returns the same object (`if (next === reading) return`), so it is a two-line change at an existing seam, not a new gate.

## Inspector/Pea readers of exposed thread state (root's check)
`core.expose({ page: { lensInspectKey, draft } })` in `store.ts:131` is read by exactly one consumer: the in-app owner inspector (`state/owner-inspector.tsx` via `inspectAtomRegistry(...).inspect()`). Pea reads `/pe/route-state/:route` (`agent-controller-web.ts:198`), which is the host's route workspace, never browser atoms; the composer, composer head, lens model and `sendPrompt` read the draft atom from inside the thread subtree. So moving draft/lens to React-local state loses only the inspector rows. Preservation without duplicate ownership: the route owner that stays (`useRoute`) already exposes references through `inspector.expose(id, references)` (`use-route.ts:227`); the thread subtree can hand its React state to that existing expose call (a value, refreshed on change) rather than owning an atom for it. That keeps inspectability at the existing seam; the tradeoff is that the inspector sees a snapshot, not a live atom, which matches what it shows today (cached owner outputs).

## Suspense integration: `useAtomSuspense` traced
`@effect/atom-react` `Hooks.ts:400` suspends on an `Atom<AsyncResult<A,E>>`; `Reading<T>` is a different sum type (`absent | loading | ready | stale | failed`) produced by `advance()` from SSE frames, and `useHostCall` is an effect-fetch that never yields an atom. Real adaptation paths: (a) build the thread body as an `Atom` that produces `AsyncResult` (`Atom.make` over a fetch effect keyed by thread id, `autoDispose`), read it with `useAtomSuspense`, and keep `Reading` for stream subjects; (b) map `Reading` → `AsyncResult` (`absent/loading` → Initial/Waiting, `ready` → Success, `failed` → Failure, `stale` → Success with the previous value) and suspend on that. (a) fits: the body is a one-shot read, not a stream subject, so it should not be a `Reading`; (b) would make every stream subject suspend and is wrong for the lamp. Registry ownership stays with `appAtomRegistry`; no promise cache is added; reveal reconciliation is "reset the body atom for this thread" at the same seam as `invalidate()` today.

## Large tool result, load on expand (approved; minimal proposal, no code)
Transcript authority: `readThreadState` keeps message and part identity but replaces any tool-invocation `result` larger than a threshold with `{ elided: true, bytes, threadId, callId }`; nothing is truncated in place. Expand fetches `GET /pe/thread/:threadId/part/:callId` (same `queryThreadMessages` source, one part), which returns the original full content; the transcript swaps it in for that call only and the trace lane reads the same object. Identity preserved end to end (thread id + call id, not array index). Sizes seen: two results of 655 KB and 335 KB out of 1.70 MB; a threshold near 32 KB keeps every result the transcript renders inline today except those two.

## Ownership: decision after the readers check
B (React-local thread state) for draft, attachments, lens pin/intent and world state; A (owner lifetime above Activity) only for the shell's own visited-thread list and the shared readings stream. Inspectability kept via the existing `expose` on the route owner. Actual removal = the shell dropping a thread from its list, which unmounts the subtree; nothing else needs releasing once previews use the held base64 instead of object URLs.

## State of my worktree and panes (unchanged): 8 files with disposable edits; panes `w1:p2` (dev pair), `w1:p3` (delegate idle); worktree `Pe.Tools-unify-runtime-receipts`. Root's server and Revit untouched.
