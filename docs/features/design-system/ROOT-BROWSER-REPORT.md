# Root workspace browser proof — 2026-09-16

## Scope and custody

- Classification: **browser evidence** (not source-only analysis).
- Browser: existing `pe.tools-unify-runtime-01` CDP `9222`; proof used only owned target `6DD36FB304CFB2E1F938130A2E771608`.
- Receipt: port `5176` resolves to `C:\Users\kaitp\source\repos\Pe.Tools\ts` (`dev` lane). No server or Revit session was launched.
- Existing spike target `EA084DCCBDF2D57642CF9AACF247CB8D` at `5175` remained present and untouched.
- Method: native WebSocket CDP, DOM rectangles/roles, console and network events, and PNG captures. Normal was `1280x900`; narrow was `720x900` on the owned tab only. This is geometry evidence, not a performance measurement.

## Result

| Claim | Result | Evidence |
| --- | --- | --- |
| 24px rails | **PROVEN** | Every inspected route rail/pane-title rail measured `h=24`: e.g. Takeoffs global, Zones, Plan, and Rooms rails; Family Anatomy, Doc, and Parameters rails; Settings files rail. |
| Shared content gutter | **PROVEN** | Workspace panes begin at x=8 and end 8px from the right edge on Takeoffs, Families, Family, Runs, and Settings. Schedule has x=8 with its right scroll-bar reservation. |
| Pane overlap | **PROVEN** | Pairwise pane-rectangle intersections were zero on all six routes at both widths. |
| One table title rail | **PROVEN** for mounted table workspaces | Takeoffs has one `ROOMS IN SCOPE` 24px rail directly before its grid/filter row; Families has one `FAMILIES IN SCOPE` rail before its grid; Family has one `PARAMETERS` rail before its grid. These table panes have no duplicate `pane-header`. |
| Fixed and resizable split behavior | **PROVEN** | On Takeoffs, Zones remains a fixed 288px pane with no separator at its right edge. The horizontal `Resize pane` separator accepted a trusted ArrowDown: `aria-valuenow` `354 -> 370`, and moved `y=461.4 -> 477.4`. |
| Full-height parent containment | **FALSIFIED** | A `Surface` fills 900px even when it begins below route chrome: Takeoffs/Families/Family `y=99.4,h=900`; Runs `y=130.8,h=863.2`; Schedule `y=12,h=900`. Each extends below the 900px viewport. At narrow widths, Takeoffs/Families/Family begin at `y=147.8,h=900`, and Runs at `y=160.8,h=863.2`. Settings alone is `y=0,h=900`. |
| Console/network health | **PROVEN** for this capture | All 12 captures recorded zero `Runtime.exceptionThrown`, `Network.loadingFailed`, and console `error` events. |

## Root-cause finding for containment

The new parent-sized `Surface` behavior is visible, but the parent chain is not uniformly the reserved viewport region. Route chrome consumes vertical flow before several surfaces, while the surface remains viewport-height. The result is additive height, not the remaining height.

Composition is inconsistent at the source boundary: `routes/settings.tsx:132-135` nests `RouteShell` inside `Surface`, while `routes/runs.tsx:17-19` wraps `RunsPage` in `RouteShell`; Takeoffs, Families, and Family exhibit the latter rendered ordering (route chrome before the surface). Root should make the Outlet/route-shell/workspace ownership a single bounded flex/min-height chain rather than restore any consumer-level viewport positioning.

## Route captures

| Route | Exact URL | Normal screenshot | Narrow screenshot |
| --- | --- | --- | --- |
| Takeoffs | `http://127.0.0.1:5176/takeoffs?demo=sync` | `.artifacts/runs/root-browser-20260916/takeoffs-normal.png` | `.artifacts/runs/root-browser-20260916/takeoffs-narrow.png` |
| Families | `http://127.0.0.1:5176/families?demo=apply` | `.artifacts/runs/root-browser-20260916/families-normal.png` | `.artifacts/runs/root-browser-20260916/families-narrow.png` |
| Family | `http://127.0.0.1:5176/family?demo=capture` | `.artifacts/runs/root-browser-20260916/family-normal.png` | `.artifacts/runs/root-browser-20260916/family-narrow.png` |
| Runs | `http://127.0.0.1:5176/runs` | `.artifacts/runs/root-browser-20260916/runs-normal.png` | `.artifacts/runs/root-browser-20260916/runs-narrow.png` |
| Settings | `http://127.0.0.1:5176/settings?demo=save` | `.artifacts/runs/root-browser-20260916/settings-normal.png` | `.artifacts/runs/root-browser-20260916/settings-narrow.png` |
| Schedule | `http://127.0.0.1:5176/schedule-grid` | `.artifacts/runs/root-browser-20260916/schedule-normal.png` | `.artifacts/runs/root-browser-20260916/schedule-narrow.png` |

Each PNG has a same-named JSON companion containing the DOM rectangle and console-event capture. No source files were changed.

## Follow-up — Chat head, browser evidence only

- Receipt used: root `5176`, source `C:\Users\kaitp\source\repos\Pe.Tools`, receipt PID `40296`, service port `55177`.
- Loaded-state boundary: `chat-ready-720` was captured after its React-ready gate (`complete`, textarea, thread selector, and document target all mounted; no loading state) while source HEAD had been observed at `546fe57`. The root source advanced to `0987cca` during this follow-up, so later HMR observations are not merged into the stable capture.
- Correction: the route head is intentionally scroll-away. A pane bottom below the initial viewport is not containment failure; judge only for extra overflow after the head leaves.
- Stable 720px capture: the actual composer Situation rail is 24px high but measures x=`316.5`, w=`699.0`, right=`1015.5` at a 720px viewport. The thread UUID selector and document target themselves hit-test to their own buttons; the earlier target/theme overlap was stale-coordinate evidence and is retracted.
- **FALSIFIED:** the Theme control is an interactive head slot at x=`964.6` and is offscreen. The UUID/title lane is ellipsized. This is true narrow head overflow, not the permitted tutorial spatial-map horizontal scroll.
- Stable capture had zero `Runtime.exceptionThrown`, `Network.loadingFailed`, console errors, or `useCurrentThreadView`/missing-provider text. This distinguishes the mounted runtime from the stale provider test failure.
- Later HMR sample only: the composer inner grid was 386px wide while its implicit grid column computed to 550.258px, making that implicit auto column the likely causal owner. Recheck this diagnosis against the next settled source state.

Artifacts: `.artifacts/runs/root-browser-20260916/chat-ready-720.png`, `chat-ready-720.json`, and (later HMR sample) `chat-minwidth.json`.

## Follow-up — SPA Chat journey, browser evidence

- Loaded source: `f979704`. The journey made one initial navigation to A, then attempted every subsequent selection through the mounted Picker only; it did not call `Page.navigate` again.
- React was ready: `complete`, composer and Picker mounted, and no loading/connecting state. Console recorded zero exceptions, network failures, and console errors.
- A (`4bbeabfe-c9ae-41cd-8fb2-7bfa8cd34cb4`) started with an empty composer. The proof typed `TEST-OWNED-DRAFT-A — UNSENT`; it was not sent.
- **BLOCKED:** the rendered sidebar remained its empty-state prompt (`PICK OR START A THREAD…`, `NEW THREAD`, `SEARCH ALL THREADS`) with no thread rows. The real Picker opened, but exposed only A and did not expose owned B (`a503f11e-9c1a-46a7-b28c-624b507e2fb8`). The script stopped before a B selection.
- Therefore A/B/A persistence, attachment persistence, plugin mounted continuity, selected-pane loading stability, and sidebar population are **UNPROVEN**. No attachment, send, approval, deletion, or Revit operation occurred.

Artifacts: `.artifacts/runs/root-browser-20260916/chat-spa-journey.png` and `chat-spa-journey.json`.

## Follow-up — thread inventory wire evidence

- Source identity: current root receipt resolves the web server to `C:\Users\kaitp\source\repos\Pe.Tools\ts` on `5176`; root source was `f979704` for the SPA proof.
- Exact refresh trigger, read from the loaded root source: `workbench/provider/view.tsx:81-86` defines `refreshThreads()` as `session.listThreads()`, and `view.tsx:111-114` schedules it with `setTimeout(..., 1_000)` only after `loading` is false and no stream fault exists.
- Browser body after that delay: `THREADS 146`, with visible entries `a503f11e…`, `4bbeabfe…`, `Revit API docs links`, `4eaaf432…`, `34da89b1…`, and `+141`. This falsifies an empty server inventory.
- Wire capture: Network observation was attached after the first refresh window, then the visible `threads` inventory control was invoked twice. Both samples recorded **no HTTP request, no HTTP response, and therefore no status/body to report**; the control is not the `listThreads()` refresh trigger. The first sample saw one WebSocket frame; the second saw none. No endpoint/status is inferred from this.
- Consequence: the original zero-thread browser sample was a timing race with the deliberate one-second refresh, not evidence of provider absence. Capturing the one-shot list request now would require another initial navigation/reload and risk the unsent test draft, so this bounded pass stops here.

Artifact: `.artifacts/runs/root-browser-20260916/chat-thread-wire.json`.

## Follow-up — loaded Picker SPA attempt

- No reload/navigation occurred. The proof waited for the loaded inventory and used the rendered short labels `4bbeabfe...` and `a503f11e...` rather than inventing full-ID selectors.
- The mounted sidebar remained valid at `THREADS 146`. A real Picker interaction mounted an `A503F11E... / LOADING A503F11E...` pane, proving in-app selection dispatch reaches the selected-pane loading state without a URL change.
- **BLOCKED, no further clicks:** the subsequent Picker attempt for `4bbeabfe...` did not yield a stable active-label transition within the bounded settle. Five seconds later the UI was settled on `a503f11e...`, and its composer contained the copied `TEST-OWNED-DRAFT-A — UNSENT`. The DOM exposed repeated short labels across sidebar, current selector, and Picker, so another scripted click would not be an attributable real-Picker selection.
- Therefore A/B/A draft retention, plugin continuity, and attachment retention remain **UNPROVEN**. No send, attachment, approval, deletion, Revit operation, reload, or non-test draft mutation occurred.

Artifacts: `.artifacts/runs/root-browser-20260916/chat-spa-live.json`, `chat-spa-final.json`, and `chat-settle.json`.

## Handoff checkpoint — bounded SPA attempt

- CDP target released: `6DD36FB304CFB2E1F938130A2E771608`, last observed URL `http://127.0.0.1:5176/chat?thread=a503f11e-9c1a-46a7-b28c-624b507e2fb8`. No further browser calls will be made from this lane.
- Owned test threads left intact: A `4bbeabfe-c9ae-41cd-8fb2-7bfa8cd34cb4` and B `a503f11e-9c1a-46a7-b28c-624b507e2fb8`. The only text entered was `TEST-OWNED-DRAFT-A — UNSENT` and (where B was empty) `TEST-OWNED-DRAFT-B — UNSENT`; nothing was sent. The last stable B composer displayed the A marker. The terminal error state prevented a final draft read, so both markers must be treated as potentially present and are deliberately not cleaned up here.
- Automation limits, **not product findings**: the first empty sidebar sample preceded the deliberate one-second `listThreads()` timer; the full-UUID/ellipsis selector mismatch and the expectation that SPA selection changes the URL were test-harness assumptions; repeated short labels made an unambiguous synthetic Picker target unavailable. `trace` is a view mode and is not plugin-mount evidence.
- Observed terminal runtime surface, **cause unproven**: a read-only current-DOM capture after the bounded SPA interaction returned exactly `{"status":500,"unhandled":true,"message":"HTTPError"}` and no rendered thread rows. This is recorded for provider diagnosis only; it does not prove a draft-retention defect or attribute the HTTP error to the SPA automation.
- No attachment, prompt send, proposal approval, thread deletion, Revit mutation, reload, or non-test draft edit occurred.

Artifact: `.artifacts/runs/root-browser-20260916/chat-thread-rows.json`.

Root integration correction: the terminal HTTPError coincided with the temporary Rail merge-conflict parse failure during integration at 20:09. The conflict is resolved; the root dev runner restarted its host as pid37508 on port55177 and subsequently served the app normally. This sample does not establish a product navigation failure. Retained Activity composers also mean an unfiltered `document.querySelector('textarea')` can read a hidden thread's draft; those earlier script readings do not establish cross-thread draft leakage. Opus owns the replacement journey against settled root source `6b0ddb4`, using visible controls.
