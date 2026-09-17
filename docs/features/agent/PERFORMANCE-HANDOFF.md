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

Root archive note: relative raw-evidence paths in this report resolve under C:\Users\kaitp\source\repos\Pe.Tools-unify-runtime, the measured spike checkout. They do not describe root production bytes.
