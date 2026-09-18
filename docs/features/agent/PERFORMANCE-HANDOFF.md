# Performance handoff: runtime spike vs baseline (foreground, direct CDP trace)

Disposable measurement handoff for root, 2026-09-16. Measurement only; no design claims.

## Proof lane

- **Lane:** development build (Vite 5175 + host 49843, owned by Herdr `unify-runtime` w1:p2), React StrictMode on, attached session in owned Chrome 152 instance `pe.tools-unify-runtime-01` (port 9222, target `EA084DCC…`). Revit not touched. No prompts sent, no host mutations.
- **Validity:** each run checks `document.visibilityState` right before tracing starts and again right after the scenario ends. All 8 runs recorded `["visible","visible"]`. The user brought the window forward twice; it went hidden once between runs, and that run was aborted and redone.
- **Not proven:** production timings, human input latency (keys are CDP `Input.insertText`), compositor/GPU raster cost (only renderer main-thread work is bucketed).

## Configurations

| Lane | Files | Behaviour |
|---|---|---|
| **spike** | all 8 dirty files as found (baseline 527048f + spike) | `advance()` returns the same ready object when a snapshot is equal; `memo(Markdown)`; every visited thread stays mounted in `<Activity>` with `thread` passed as a prop; revealing a thread refetches its body once; `openThread` removes `prompt`/`turn` |
| **baseline** | the 6 web `src` files (`readings.ts`, `routes/chat.tsx`, `workbench/prose.tsx`, `workbench/provider/{thread-stream.ts,view.tsx}`, `workbench/store.ts`) restored to HEAD; `host/scripts/dev-web.ts` and `web/vite.config.ts` stayed spiked, since they hold the port pair | HEAD: a new snapshot object on every heartbeat, no memo, `WorkbenchProvider key={thread}` remounts on switch, no Activity, no reveal refetch, `openThread` keeps prompt/turn |

So the baseline turns off **all** runtime spike behaviour, not only memo and equal-readings. Root cannot separate the effect of each change from these runs.

**Restoring the spike files:** before switching, the files were copied to `.artifacts/runtime-bench-20260916/spike-bytes/source/pe-tools/apps/web/src/…` and the diff was saved as `spike-bytes/spike.patch`. The baseline switch ran `git restore --source=HEAD` on those 6 paths only. Afterwards the copies were written back. SHA-256 of each of the 6 files matches its saved copy, and `git diff --stat` again shows the original 8 files, 46+/11−.

## Results (renderer main-thread self time, ms)

Self-time check on the saved traces: 8,229–21,281 duration events, 0 with negative self time, 0 children that end after their parent, 0 begin/end pair events skipped. The numbers are still **approximate**: only the busiest main thread in the renderer is counted, buckets are by event name, and compositor/GPU work is excluded. Buckets: script = FunctionCall/EvaluateScript/microtasks/timers/events/GC; style = UpdateLayoutTree; layout = Layout; paint = Paint/PrePaint/Layerize/Commit on the main thread; other = RunTask self time.

| Scenario | Lane | script | style | layout | paint | long tasks ≥50 ms (count / max) |
|---|---|---:|---:|---:|---:|---|
| **idle 10 s** | baseline | 897 | 66 | 33 | 12 | 4 / 367 |
|  | spike | 3 | 4 | 0.3 | 2 | 0 |
| **select: both transitions, 9 s** (hide the 1.70 MB thread → `/chat` draft for 4 s → back to the big thread for 5 s) | baseline | 1395 | 207 | 64 | 29 | 6 / 508 |
|  | spike | 680 | 160 | 30 | 20 | 4 / 194 |
| **typing** (41 trusted chars at 120 ms, then clear) | baseline | 618 | 40 | 31 | 41 | 4 / 130 |
|  | spike | 397 | 8 | 19 | 50 | 1 / 55 |
| **reload** (initial fetch, 9 s) ⚠ | baseline | 2892 | 410 | 148 | 51 | 16 / 561 |
|  | spike | 760 | 155 | 37 | 46 | 9 / 276 |

### Style and layout

- **Baseline idle:** each heartbeat triggers `UpdateLayoutTree` over about **880 elements** (≈7–8 ms, 8 times in 10 s), next to ~775 ms of `FunctionCall` and 4 long tasks. That is the repeated Markdown work. It does not happen in the spike: no style recalc over 5 ms and 3 ms of script in total.
- **Select, both lanes** (the window covers both transitions): the return to the big thread costs 3 style recalcs of **≈2,900–2,980 elements** (27–41 ms each) and one layout of **5,832–5,919 objects** (≈16 ms). The spike's recalcs are slightly *larger* (37.6/40.9/30.2 ms vs 34.3/27.4/27.0 ms). Style and layout are not what the spike improves. Across the whole select window, script is 680 ms in the spike vs 1,395 ms in the baseline, and style+layout is 190 ms vs 271 ms. The window includes the hide and the draft mount, so none of this is reveal-only cost.
- **Reload, both lanes:** style recalcs of 2,747–2,865 elements (24–30 ms each) and one layout of 5,583/5,779 objects (≈14 ms).
- **Typing:** style/layout per key is small in both lanes. The baseline's 4 long tasks (115–130 ms) line up with heartbeat-driven 880-element restyles, not with keystroke handling.

### Transport and lifecycle

- **Correction to the first write-up:** its first-byte and total times came from the timestamps on CDP Network events. The first-byte time was taken when the renderer handled the response, which includes waiting for a busy main thread; the total came from the network stack. Mixing the two produced the impossible pair "total 25 ms, first byte 115–165 ms". Those numbers are withdrawn. The corrected numbers below come from the traces' `ResourceSendRequest`, `ResourceReceiveResponse` and `ResourceFinish` events, matched by request id. "Headers" is `timing.receiveHeadersEnd`; "finish" is `finishTime − requestTime`; "renderer saw response" is when `ResourceReceiveResponse` fired, measured from the send.
- **Big thread body** `/pe/thread/aa327a56…`, 1,700,456 bytes, none served from cache:
  - Spike reload (request 46980.1217): headers 649 ms, finish 657 ms, renderer saw the response at 650 ms.
  - Select return, fetched **twice in both lanes**. The spike's two requests are its reveal refetch run twice by StrictMode; the baseline's two are its remount run twice by StrictMode.
    - Spike (requests 46980.1231 and .1233): headers 16 ms, finish 24 and 23 ms; the renderer saw the responses at 165 and 115 ms, so ~100–150 ms was spent queued behind main-thread work.
    - Baseline (requests 46980.3696 and .3697): headers 31 and 49 ms, finish 41 and 56 ms; the renderer saw them at 33 and 51 ms.
- **Draft thread body** (a new random id each time, 30,940 bytes) was fetched **4×** in both lanes.
  - Spike (requests 46980.1223–.1226): headers 570–634 ms and finish 572–636 ms, so the slowness really is on the network/server side.
  - Baseline (requests 46980.3688–.3691): headers 5–8 ms, finish 6–9 ms.
  - Why the spike's draft fetch was slow is not established.
- **`/pe/resources` EventSource** reopens with a new key set whenever the thread changes. The old stream is aborted. Both lanes show 2–3 aborted-then-reopened streams per select.
- **Mastra `…/stream` fetch** is aborted and reopened per switch in both lanes. `…/threads` returns about 27 KB each time.
- **Stream messages** (EventSource/WebSocket) during idle: 13 messages / 3.0 KB in the baseline vs 2 / 1.7 KB in the spike. The heartbeat window was not aligned between runs, so this is not a rate claim.
- **Every page load:** `/host/install` and `/host/update` return 404, and a `css2?family=var(--font-body)` request is `ERR_BLOCKED_BY_ORB`. That is an unexpanded CSS variable in a Google Fonts URL, and it repeats on every select.

### ⚠ Reload is not a matched comparison

The baseline reload ran right after 6 source files changed, so Vite re-transformed the modules: 1,121 requests vs 553, and `DocumentLoader::CommitNavigation` took 518 ms vs 99 ms. The reload row mixes cold-module cost into the baseline. Use its style/layout element counts, not its script totals.

## Answers for root

1. **Idle heartbeat:** the spike removes essentially all idle main-thread work (≈900 ms per 10 s → 3 ms) and the 880-element restyles. Confirmed with direct trace attribution.
2. **Select (both transitions together, not reveal alone):** the spike cuts script from 1,395 to 680 ms and style+layout from 271 to 190 ms; its longest task drops from 508 to 194 ms. Both kinds of cost remain in the spike: 680 ms of script and 190 ms of style+layout, including restyles over ~3,000 elements and a 5,900-object layout. This window does not show which one dominates reveal alone. The earlier ~567 ms frozen frame was not reproduced as a single frame.
3. **Typing:** the spike reduces script by 36% and long tasks from 4 to 1. Most of the baseline's typing jank is heartbeat interference, not the key path.
4. **Open, not measured:** how much of the gain comes from each change (memo vs equal-snapshot identity vs Activity); production numbers; why the spike's draft-thread fetch took ~600 ms at the server.

## Evidence

- Driver: a disposable Node CDP script at scratchpad `…/scratchpad/cdp.mjs`, copied to `.artifacts/runtime-bench-20260916/cdp/cdp.mjs`. It uses a persistent WebSocket to `ws://127.0.0.1:9222/devtools/page/EA084DCCBDF2D57642CF9AACF247CB8D`, with `Tracing.start` (devtools.timeline, disabled-by-default-devtools.timeline{,.frame}, blink.user_timing, v8.execute, loading, latencyInfo) and `Network.enable`.
- Commands: `node cdp.mjs run <spike|baseline> <reload|idle|select|typing>`, run in the order reload, idle, select, typing for each lane. The spike's `select` was rerun after the visibility abort.
- Files: `.artifacts/runtime-bench-20260916/cdp/{spike,baseline}-{idle,select,typing,reload}.json` (summaries) and the matching `.trace.json` files (full traces).
- **To view in Chrome:** DevTools → Performance → *Load profile…* → pick any `*.trace.json`.
- The correction and the self-time check used only the saved traces, read by a one-off Node script; no new Chrome scenarios were run.
- Earlier proxy evidence (`r3-foreground-spike.json`) is still valid as spike-only; the `*HIDDEN*` files are still invalid.

## Custody

The browser `pe.tools-unify-runtime-01` is preserved on the chat thread URL, and the spike files are restored. **The user may now cover Chrome**: measurement is finished. The servers and the w1:p2/w1:p3 panes were not touched.

## Prepared: benchmark of the current root build (waiting for tab custody)

Status on 2026-09-16: **ready, not run. Waiting for workspaces to hand off custody of the tab and for root to release the thread lock** (root is stopping the spike server in w1:p2). The browser was not touched. The checks below used only `chrome-agent status` and `curl` against the servers.

### Target

| Item | Value |
|---|---|
| Browser tab | `6DD36FB304CFB2E1F938130A2E771608` in instance `pe.tools-unify-runtime-01` (port 9222), at `http://127.0.0.1:5176/chat?thread=4bbeabfe-c9ae-41cd-8fb2-7bfa8cd34cb4` |
| Servers | web root 5176 and host 55177, receipt `host-source-cfac28d8dd61-no-revit`, source root `Pe.Tools` @ `0987cca` |
| Spike tab | `EA084DCC…` on 5175, left untouched |

### Blocker: the large thread cannot be compared yet

- `GET 5176/pe/thread/aa327a56…` returns **500**: `Thread aa327a56… is locked by another process (PID 68420)`. The spike host holds that lock.
- The same thread through 5175 returns 1,700,039 bytes.
- Root cannot open the 1.70 MB thread while the spike host is running.
- Root's current thread `4bbeabfe…` is 30,747 bytes, with 512 ms to first byte from `curl`. That is too small to reproduce the big-thread reveal/restyle costs.

**Before a comparable large-thread run, one of these is needed:**
- (a) Root releases or stops the spike host 49843. It is a foreign server, so I won't touch it.
- (b) Root provides another thread of comparable size that is not locked.

**Tab suitability:**
- The root tab is fine for idle, typing and small-thread transport runs.
- For select, the tab would need a large thread id to switch to.
- It has to be visible during every measured window, and I won't bring it forward while root's browser acceptance is running.

### Procedure, once root hands over the tab

The driver is `.artifacts/runtime-bench-20260916/cdp/cdp-root.mjs`. It is a copy of `cdp.mjs` with these changes:
- `CDP_TARGET` and `CDP_OUT` come from the environment. The defaults are the root tab above and `.artifacts/runtime-bench-20260916/root/`.
- Two new scenarios: `expand` clicks the first element matching a CSS selector; `reconnect` emulates 3 s offline with `Network.emulateNetworkConditions`, then goes back online for 8 s.

Each run aborts unless the tab is visible both before and after the scenario. No scenario sends a prompt or touches Revit. `select` with no argument opens a new draft via `/chat`; that navigation creates no thread on the server.

```powershell
$d = "C:\Users\kaitp\source\repos\Pe.Tools-unify-runtime\.artifacts\runtime-bench-20260916\cdp"
# 0. The user makes the root tab visible; confirm with:
node "$d\cdp-root.mjs" eval "document.visibilityState"
# 1. Matched scenarios (same order as the spike/baseline runs)
node "$d\cdp-root.mjs" run root reload
node "$d\cdp-root.mjs" run root idle
node "$d\cdp-root.mjs" run root select "<exact sidebar title of large thread B>|<exact title of starting thread A>"
node "$d\cdp-root.mjs" run root typing
# 2. Read-only extras
node "$d\cdp-root.mjs" run root expand "<selector for a collapsed stored tool result>"
node "$d\cdp-root.mjs" run root reconnect
```

**How to read the results:**
- Compare `root/*.json` with `cdp/{spike,baseline}-*.json` on the bucket fields (script/style/layout/paint), long tasks, the big style-recalc and layout lists, `streamMsgs` and `requests`.
- For transport, take the numbers from the trace's `ResourceSendRequest`, `ResourceReceiveResponse` and `ResourceFinish` events matched by request id, as in the correction above. The `requests` timing fields in the summaries are the withdrawn mixed-clock values.
- **`select`** switches threads only through trusted mouse clicks on real sidebar rows, matched by exact title. It never uses `Page.navigate`; only the separate `reload` scenario loads a page. The run fails explicitly if a row is not visible. Retained Activity drafts are expected only within the same page load.
- **`typing` preserves drafts.**
  - It moves the caret to the end of the visible composer and types a unique marker, ` PEBENCH-<time>-quick-brown-fox`, as trusted input.
  - It clears the marker only if the value is exactly the earlier draft followed by the marker, and then only with that many trusted Backspace presses, so React sees the change.
  - It then verifies that the value equals the earlier draft exactly.
  - It never clears any other text. If a check fails, it stops and reports the value instead.
  - Nothing is sent.
- **The `expand` selector must be found first.** Read the DOM once the tab is handed over (no clicks) to find the collapsed stored tool-result control.

### Read-only wire check after the spike host stopped (2026-09-16, `curl` only, no browser)

| Request | Result |
|---|---|
| `5176/pe/resources?keys=[{"kind":"host-status"}]` (first SSE frame) | `controllerId: "pea"`, `resourceId: "pea:QzpcVXNlcnNca2FpdHBcT25lRHJpdmVcRG9jdW1lbnRzXFBlLlRvb2xz"` (base64 of `C:\Users\kaitp\OneDrive\Documents\Pe.Tools`), `serviceName: host-source-cfac28d8dd61-no-revit`, `sourceRoot: C:\Users\kaitp\source\repos\Pe.Tools\source\pe-tools`, `capabilities.revit: false`, `bridgeIsConnected: false`, pid 40296 |
| `5175/pe/resources…` | no response (spike stopped) |
| `5176/pe/thread/aa327a56…` | **200, 718,016 B.** It was 500 (locked) before the spike stopped, and the spike served 1,700,039 B for the same thread. The difference is not attributed here; it may come from root's runtime cuts. |
| `5176/api/agent-controller/pea/sessions/<resourceId>/threads?sessionScope=4bbeabfe…` | **200, 27,535 B, `{threads:[146]}`**, including `aa327a56` ("Revit API docs links", `updatedAt` 2026-09-17T01:03:21Z). The response is identical with `sessionScope=aa327a56…`. |

**What this shows:**
- Root's host uses the **same `resourceId`** as the spike run (the spike's earlier `/threads` URL used the same encoded id), and its list includes the large thread.
- The sidebar showing 0 threads is therefore on the browser side: `refreshThreads` did not run, or it ran and its result was dropped. The wire does not show an empty list.
- **Obstacle for the click-driven select:** thread `4bbeabfe…`, the tab's current thread, has an **empty title** (`""`). Its sidebar row can't be matched by exact title, so the return click needs a titled start thread A, or a different row locator.

**Resolved (root, 2026-09-16):**
- After the delayed refresh, the browser shows all 146 threads, so no inventory bug is proven.
- Untitled rows use the `shortId` fallback label (`workbench/provider/use-workbench.tsx:123`): `4bbeabfe...` and `a503f11e...`, with three ASCII periods.

**Select arguments for the run.** The tab starts on `4bbeabfe…`. The run clicks the large titled thread, then clicks back:

```powershell
node "$d\cdp-root.mjs" run root select "Revit API docs links|4bbeabfe..."
```

**Rules until the journey completes:** root is not hot-reloading. Wait for root to hand over tab custody.

## Current-root results (stable build `6b0ddb4`, 2026-09-16/17)

**Setup and custody:**
- Chrome tab `6DD36FB3…` on 5176. Host pid 68132 on port 55177, process start 2026-09-17T01:13:34.399Z, source root `Pe.Tools/source/pe-tools`.
- Development build with React StrictMode, attached CDP session, window 1280 css px, "threads" view (no plugin pane).
- Nothing was sent, no threads were deleted, Revit was not touched.

**Validity rule:** a run counts only if the tab was visible before and after, **and** the page load time (`performance.timeOrigin`) was identical before and after, i.e. no reload during the run. Evidence is in `.artifacts/runtime-bench-20260916/root/`, produced by `cdp/cdp-root.mjs` and analysed with `cdp/tt.mjs` (transport), `cdp/lt.mjs` (long-task breakdown) and `cdp/geo.mjs` (layout).

### Invalid runs, kept as failure evidence
- `root-idle` and `root-select` ran on the empty `4bbeabfe` thread while the host restarted (20:13:34). `root-idle` contains `ERR_CONNECTION_REFUSED` and 0 stream messages.
- `root-typing` aborted because the page did a full reload at 01:13:45Z, so it found no visible composer.
- That reload also cleared the in-memory test drafts.

### Draft retention across sidebar clicks: PASS (`root-drafts`, before the restart)
- Threads were switched only by trusted clicks on sidebar rows, with the click point hit-tested against the row label (`4bbeabfe...` / `a503f11e...`).
- Before each typing step, the script waited for the URL to settle on the right thread and for a visible composer.

| Step | Visible composer text |
|---|---|
| A, after typing | ` TEST-OWNED-DRAFT-A` |
| B, first open | empty |
| B, after typing | ` TEST-OWNED-DRAFT-B` |
| Back to A | ` TEST-OWNED-DRAFT-A` |
| Back to B | ` TEST-OWNED-DRAFT-B` |
| A, final | ` TEST-OWNED-DRAFT-A` |

### Valid large-thread runs

All on `aa327a56` ("Revit API docs links"): 59 stored messages, a 718,267 B stored projection, page load time 01:13:45.523Z throughout.

| Scenario | script | style | layout | paint | long tasks ≥50 ms | stream messages |
|---|---:|---:|---:|---:|---|---|
| idle, 10 s | 32 | 0 | 0 | 3.5 | none | 2 / 1.7 KB |
| typing (45-char marker at 120 ms per char, then exactly 45 Backspaces; draft verified restored) | 576 | 6 | 37 | 87 | none | 2 |
| select: both transitions (click `4bbeabfe...` → 5 s → click "Revit API docs links" → 5 s) | 767 | 117 | 32 | 32 | 86, 68, **410**, 65 | 56 / 10.2 KB |
| expand (first collapsed `tool-run` group summary) | 2.5 | 0 | 0 | 0 | none | 1 |
| reconnect (3 s emulated offline) | 2.1 | 0 | 0 | 0 | none | 2 |

**Typing is not directly comparable to the old runs:** the old marker was 41 characters and cleared through the native value setter; this one is 45 characters cleared with trusted Backspaces, so there are more input events.

**Select, large-thread style/layout:** 2 style recalcs over 2,961 and 2,849 elements (44 ms each), and one layout of 5,702/5,978 objects (17 ms).

**The 410 ms task** (`lt.mjs`, at +30,171 ms in the trace):
- It is a single `RunMicrotasks` task that starts **1 ms after** the app's `/pe/thread/aa327a56` request finished. That request was sent at +30,097 and finished at +30,170, with headers at 16 ms and finish at 19 ms by network timing, and the main thread handled the response at 65 ms.
- Its self time is script (`FunctionCall`) 272 ms + style (`UpdateLayoutTree`) 97 ms + layout 23 ms + GC ≈ 8 ms. Network time is not part of this task.
- So the dominant work is rendering the resolved body: script, then restyle and layout of a transcript DOM of about 2,900 elements.
- **Trade-off, recorded but not asserted as the cause:** in root, only composers are retained in Activity and the transcript remounts on every switch. The old spike kept the whole thread body mounted and had a 194 ms maximum there, although its network timing was worse and its build differs (its body was 1.70 MB).

**Select transport** (trace request events matched by request id):
- `4bbeabfe` body: headers 519 ms, finish 520 ms, 30,909 B. It is fetched once; no fourfold StrictMode fetch was seen.
- `aa327a56` body: headers 16 ms, finish 19 ms, 718,267 B, fetched once by the app.
- Several `/pe/resources` host-status SSE streams were aborted and reopened, as before.

**Measurement noise:** in every root run after the restart, a *final* `/pe/thread/aa327a56` request of 718 KB is the driver's own identity read, made after the scenario and before capture stops. It is not app traffic. This includes the reconnect run's only request.

**Limits:**
- **Expand did not reach a stored full result.** Opening a `tool-run` group showed no per-call expander; the only visible controls were action buttons ("read status", "recover native receipt", "resume original action"), which were not clicked.
- **Reconnect was not exercised.** `Network.emulateNetworkConditions` offline did not close the open SSE streams, so no resync payload was observed.
- No production build, and no human input latency.

### Composer head and halo at 720px, then 1280px (`geo.mjs`, window resized by CDP; screenshot `root/720.png`)

| Width | Head | Halo (SVG) | Composer | Gutter (separator) | Horizontal scroll |
|---|---|---|---|---|---|
| 720 | x317 y919 395×24, hit-test inside | x458 y839 56×56, hit-test inside | x325 y961 379×36, hit-test is the textarea | x308–316, full height | none |
| 1280 | 955 wide, hit-test inside | unchanged position, hit-test inside | 939 wide | unchanged | none |

- **Retracted:** the 56px "halo" above is the floating Pea avatar SVG, not the focus halo, and a head hit-test is not a narrow-layout pass. See the correction below.
- The window was left at 1280 on `aa327a56`.

### Recommended next bounded root fix, only if the 410 ms reveal matters
Measure one variant that avoids remounting the transcript for a thread that was already visited, or that defers styling of the off-screen transcript (for example `content-visibility` on message rows). Compare it on this same large-select scenario, looking at the maximum task and at style over the ~2,900 elements. The draft custody proven above must be kept.

### Correction: 720px narrow layout and focus halo (`geo2.mjs`, `geo3.mjs`; screenshots `root/720-focus.png`, `root/720-halo.png`; DPR 2)

**Transcript prose overflows: FAIL at 720px.**
- The document itself does not scroll sideways (`scrollWidth` 720), but **64 of the 150 visible `main p` paragraphs extend past the right edge of the viewport**.
- Example: a paragraph at x 346–890 (544 px wide) inside a transcript pane at x 316–712. The pane's `[data-slot=scroller]` (`overflow-x: hidden`, `scrollWidth` 574 vs `clientWidth` 396) clips it, so text is cut mid-sentence.
- At 1280px there are 0 overflowing paragraphs.

The measured ancestor chain at 720px, from the paragraph outwards:

| Element | Width (px) | Measured CSS |
|---|---:|---|
| `p` | 544 | |
| `div.prose max-w-none …` | 544 | `min-width: auto` |
| **`div.grid gap-[3px]`** | **282** | `grid-template-columns` resolves to **543.766px**: an implicit auto track sized from the child's min-content |
| `section[data-slot=moment]` | 292 | |
| `div[data-slot=chat]` | 332 | `min-width: auto`, `scrollWidth` 574 |
| `div[data-slot=grid]` | 396 | columns `332px 64px` |
| `[data-slot=scroller]` | 396 | clips the overflow |

**Probable owner** (not verified by an edit):
- The moment's `grid gap-[3px]` wrapper has no `grid-cols-[minmax(0,1fr)]`/`min-w-0`, and its prose child keeps `min-width: auto`.
- That lets one wide, hard-to-break item (long code or URL text) size the track for the whole message. The same moment contains a `code` with `scrollWidth` 2,514 at 1280px.
- This matches root's hypothesis that `min-width: auto` in the chat grid is the cause.

**Focus halo on `[data-slot=pane][data-active=true]`: PASS at 720px.** Focus was put on the visible composer textarea after a trusted Shift key, so `:focus-visible` is true.

| Pane | `data-active` | Outline | Outline offset | z-index |
|---|---|---|---|---:|
| composer | `true` | `solid 2px rgb(134,132,129)` | 2px | 20 |
| threads, transcript | `false` | `solid 1px transparent` | 2px | — |

- **Composer pane box:** x 316–712, y 918–1031.
- **Gutter:** `[role=separator]` at x 308–316, z-index 10, background `rgb(39,37,31)`.
- **Left outline band:** x 312–314, which lies over the gutter. The composer pane's z-index 20 is above the gutter's 10, and the zoomed screenshot shows the gray line painted over the gutter.
- **Right outline band:** x 714–716, within the 720 viewport (`rightClipped: false`) and visible in the screenshot.
- **Why a hit-test can't prove this:** outlines receive no hits, so a hit-test at x 313 returns the separator. The paint evidence is the screenshot.

**Help popup ("COMPOSER KEYS"): observation, not judged.**
- It is open at x 86–308, y 923–952 for its header row, to the left of the gutter over the sidebar footer.
- In the screenshot it covers the sidebar's "NEW THREAD" and "SEARCH ALL THREADS" controls.
- Its own computed outline is `none`, and its border is `0px`.
- Whether the "help open → 2px ink-mute" rule belongs to the pane outline (as measured above) or to the popup, root decides.

**State after the checks:** the window is back at 1280 (`innerWidth` 1280) on `aa327a56`, and composer focus was left on the composer.

### Opening a large stored tool result (root `6b0ddb4`)

**Target:** the stored call `call_UFaEHIGn4kqa5KKxWE7l5jGI` in message `e9af1b13…` of thread `aa327a56`. Per root, its stored result is 652,988 B.

**How the call was opened:**
1. Located its `ToolCallView` (`[data-tool-id]`, `workbench/moments.tsx:318`). It is **not** inside a `details[data-annotation=tool-run]`.
2. The transcript follows the tail and undid a programmatic `scrollIntoView`, so the transcript was scrolled with trusted mouse-wheel events until the call sat at y≈290.
3. Clicked its `[data-annotation=tool-marker]` `role=button` with a trusted click, after a hit-test on the marker. This click only calls `setLensPinKey`; no recover/resume or other action controls were touched.

**Run `root/large-opencall.*`: VALID.** Visible before and after, and one page load throughout (01:18:39.460Z).

| Measure | Result |
|---|---|
| Fetch | exactly **one** `GET /pe/thread/aa327a56…/tool-result/e9af1b13…/call_UFaEHIGn…`, status 200, 653,337 B on the wire; headers 12 ms, finish 15 ms, handled by the page at 29 ms |
| Other traffic | the only other request was the driver's own identity read (718,267 B) |
| After the click | marker `data-open`; the deferred summary reads "key, kind, revision, ok, target, result, elapsedMs · 637.7 KB"; the call wrapper holds 65,852 characters of rendered text |
| Main thread | script 149, style 69 (one recalc of 2,856 elements, 47.6 ms), layout 27, paint 39 ms; long tasks 60 and 87 ms |

**Switching to the trace view with that call pinned** (trusted click on the ModeDial "trace" button, same page load):
- The pinned inspector (`[data-annotation=inspect][data-pinned]`, `ToolCellBody`) rendered 65,830 characters.
- The network log showed **two** new `requestWillBeSent` for the same `tool-result` URL and **one** `loadingFinished` of 653,337 B.
- So the trace inspector fetches the full result **again** instead of reusing the fetch the transcript already made. One of the two starts did not finish within 5 s. It is probably the StrictMode duplicate being aborted, but I did not capture `loadingFailed`, so that is not proven.
- Afterwards the view was switched back to "threads" with a trusted click.

**Reloads seen:** the page load time moved from 01:13:45Z to **01:18:39Z** between the earlier large-thread runs and this one. The cause was not observed; no driver step navigates. Every run above has identical load times before and after.

**Not done:** `call_nEi0adZtF9ZMl8QuR7APDYP8` (329,485 B, a `Do` `op:scripting.execute` call in message `d58937ec…`) was located but not opened; one proof was enough.

### Throwaway experiment: `content-visibility` on transcript moments (injected style only, removed afterwards)

**Setup:**
- **Selector:** `section[data-annotation="moment"]` (47 on the page). `[data-slot=moment]` matches nothing.
- **Injected rule:** `<style id="pe-cv-exp">section[data-annotation=moment]{content-visibility:auto;contain-intrinsic-block-size:auto 200px}</style>`. Nothing was changed in the repo.
- **Runs:** both variants ran the same scenario, large → `4bbeabfe...` → "Revit API docs links" by sidebar clicks, in the same page load (01:18:39.460Z), one after the other. The control ran first.
- **Evidence:** `root/cv-control/` and `root/cv-on/`.
- After the run the style was removed (checked) and the scroll height returned to 17,710.

| Variant | script | style | layout | paint | long tasks (ms) | largest restyles (ms / elements) | layout (ms, dirty/total objects) |
|---|---:|---:|---:|---:|---|---|---|
| control | 798 | 130 | 33 | 40 | 94, 51, 79, **427**, 51 | 47.5/2,962 · 43.9/2,849 | 19.7 (5,702/5,978) |
| content-visibility | 658 | 92 | 35 | 23 | 73, 62, **298** | 25.2/1,601 · 13.3/788 · smaller | 13.7 (3,642/6,273) |

**Where the reveal task's time goes:**

| Variant | Total | Script | Style | Layout |
|---|---:|---:|---:|---:|
| control | 427 | 281 | 104 | 26 |
| content-visibility | 298 | 243 | 29 | 10 |

The saving is mostly style and layout. Script, which is React rendering the body, remains the largest part.

**Scroll behaviour:**
- After the return, the transcript was at the tail in both variants (distance to bottom 0), with no jump observed 3 s later.
- With the experiment on, the scroll height was **13,229 instead of 17,710**, because the `200px` intrinsic-size estimates replace the real heights of off-screen moments. The scrollbar geometry therefore changes, and anything that maps turns to scroll offsets would see estimated positions.

**Verdict: the performance gain is real for this one run pair, and scroll safety is UNPROVEN.**
- The focal map, turn navigation (`?turn=`), and scrolling up through estimated moments were not exercised.
- Single run pair; development build.
- **Do not commit on this evidence.** A committed version would first need turn-jump and focal-map checks.

### Final 720px geometry recheck after root's narrow-layout fix (root HEAD `5e32a43`, "Keep chat prose inside its column")

**Setup:**
- **No reload.** The page load time was still 01:18:39.460Z, and HMR had already delivered the fix.
- **Fresh modules confirmed in the live DOM before capture:** 92 moment wrappers use `flex min-w-0 flex-col`; old `grid` wrappers and `[data-tool-id].grid`: 0; every `.prose` has `min-w-0`; computed `overflow-wrap` is `anywhere`.
- **Scripts and screenshots:** `cdp/geo4.mjs`, `geo5.mjs`, `geo6.mjs`; `root/720-fixed.png`, `720-fixed-focus.png`, `720-fixed-halo.png`. Thread `aa327a56`, DPR 2.

**Transcript prose: PASS.**
- **At 720px:** 0 of 150 visible paragraphs extend past the viewport (before the fix: 64). The document `scrollWidth` is 720. A sample paragraph sits at x 346–628, inside the 316–712 pane.
- **At 1280px:** 0 overflowing paragraphs.
- The screenshot shows wrapped text with no clipping mid-sentence.

**Code and tables: contained.**
- At 720px, 40 elements still extend past the right edge. All are `code` lines inside `pre` blocks. The parent of each `pre` is a `max-h-[32rem] overflow-auto` scroll container, which is inside the pane, so they scroll within their block instead of overflowing the page. For example, one `pre` has `clientWidth` 272 and `scrollWidth` 522.
- The `code` targets in tool markers are intentionally single-line (`nowrap` + `ellipsis`, `overflow: hidden`).
- No `table` overflowed in this thread, so tables were not exercised.
- **Not done:** I did not scroll a code block with a real input to prove it scrolls; the containment is shown from computed style and sizes only.

**Pane focus halo over the gutter: PASS.** Two measurements:

| Case | Composer pane outline | Offset | z-index | Left band | Right band |
|---|---|---|---|---|---|
| Help open (first pass) | `solid 2px rgb(134,132,129)` | 2px | 20 | x 312–314 | x 714–716 |
| Help closed (second pass) | `solid 1px` line color at 26% alpha | 2px | 20 | x 313–314 | x 714–715 |

- In both, the composer pane was `data-active=true` with `:focus-visible` true.
- **Gutter:** x 308–316, z-index 10. The left band therefore paints above it (z 20 over 10).
- **Right band:** inside the 720 viewport (`rightClipped: false`).
- The inactive panes' outline is `1px transparent`.
- This matches the chosen spec: 1px line, 2px offset, and 2px ink-mute while help is open.
- Outlines receive no hits, so the paint evidence is `720-fixed-halo.png`.

**New observation, not judged:**
- In `720-fixed.png`, the collapsed "? keys" help tab (x≈592–648 in the screenshot, 1,386 px wide as viewed) overlaps the left start of the composer head, so "Pea in" shows as "a in".
- The composer was not focused in that frame.

**State after the recheck:** the window was restored to 1280 (`innerWidth` 1280) on `aa327a56` in the threads view. **The browser is released to root.**

### Takeoffs shared-layout regression check (`/takeoffs?demo=sync`, `cdp/tko.mjs`; screenshots `root/takeoffs-1280-top.png`, `-1280-scrolled.png`, `-720.png`)

**Scope:** the demo seed "Syncing RHVAC" (from `takeoff/manifest.ts`) mounted with Revit off; no host actions were taken. Performance work is **stopped** at the user's decision (current performance is good enough).

**1280 × 900: PASS.**

| Measure | At the top of the page | After scrolling the head away |
|---|---|---|
| Page scroll | 0 | the page scroller (`main`, `scrollHeight` 999 vs 900) moved to 99.5 via 6 trusted wheel events |
| Page rail | 24px (y 0–24) | off-screen (y −99…−75), as intended |
| Pane rails | each 24px tall: zones y 107–131, plan y 107–131, rooms y 485–509 | unchanged heights |
| Gutters | 8px horizontal between plan and rooms (`[role=separator]`, y 477–485); 8px gap between zones (x 8–296) and plan/rooms (x 304–1272) | unchanged |
| Pane extent | bottom at 991, past the 900 viewport | zones y 8–892, plan y 8–378, rooms y 386–892: **8px viewport margin top and bottom** |

- Pane bodies scroll internally: zones 1,447/860, rooms 3,673/482.

**720 width (viewport height 1,039 in this window): partly verified.**
- Everything stays within the width (document `scrollWidth` 720; panes end at x 712; 8px gutter at y 426–434), and rails are 24px.
- The page scroller kept its earlier position of 99.5 while its maximum is now 148 (`scrollHeight` 1,187). At that position the pane bottoms were at 1,079, which is 40px below the viewport.
- The panes are 1,023 tall, which is exactly 1,039 − 16, so they *should* fit with 8px margins once fully scrolled. That is **arithmetic, not observed**: I did not scroll again at 720.

**Spatial map: not verified as horizontal overflow.**
- The plan SVG scales to the pane width: x 304–712 at 720 versus 304–1272 at 1280. No horizontal scroll container owns it.
- Whether the *tutorial* route keeps a horizontally scrolling map was not checked; this was the Takeoffs route only.

**Help control:** no keys/help button was found on Takeoffs by title, label or text, so it was not opened.

**Browser state:** the window was restored to 1280 and returned to `/chat?thread=aa327a56…` (visible) by one full navigation. **The browser is released to root.**
