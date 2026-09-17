# Unification review, 2026-09-16

## Shared authority and baseline

Root conduit: `C:/Users/kaitp/source/repos/Pe.Tools`, main at `527048f` when launched. Initial working tree was clean. History after `fb5643d6a15b9470273e55c3ad926850d99d6f99` contains 47 commits and supplies good and bad signal, not a boundary. Follow deeper causes and record unrelated findings. Product decisions live in the owning ledger. This document is the shared brief, not a chosen architecture.

The user participates actively and may speak directly to partners. Ask meaningful unresolved questions; never interpret silence as a verdict. Root reconciles direct rulings before cross-lane changes. Smaller code and fewer owners are preferred; deletion must preserve required behavior and honest unresolved outcomes.

## Settled requirements

- Chat's head stays attached to the composer, beside targeting, proposals and approvals; one header height by default.
- Thread selection appears in the sentence and the sidebar projects that same route-owned state.
- Shared pane gutters include the inside viewport perimeter. Halos and resize handles fit in the gutter. 8px/6px are guesses to tune visually.
- Standard pane spacing, child fill, viewport height and responsiveness must become shared contracts. Interim route breakage is acceptable during an authorized cutover.
- Route verb hover exposes the bound hotkey; consider composer help halo and complete Chat tutorial participation.
- Reconsider pane/artifact identity, nesting, header defaults with explicit opt-out, rail height and controls, title-only heads with instructions in tutorial, modes/tabs, state-related foot rails, legend, colors and hover. These are questions, not settled API choices.
- Measure blank states on navigation, reload, send and connection changes, and sluggishness in visible Chrome. Include CSS, style recalculation, layout, paint, render work, transport, subscriptions, lifecycle and recovery.

## Partners and scope

| Partner | Herdr session | Checkout | Report |
|---|---|---|---|
| surface, Fable 5.1 low | unify-surface | `C:/Users/kaitp/source/repos/Pe.Tools-unify-surface` | `docs/features/design-system/UNIFICATION-SURFACE.md` in that checkout |
| runtime, Fable 5.1 low | unify-runtime | `C:/Users/kaitp/source/repos/Pe.Tools-unify-runtime` | `docs/features/agent/UNIFICATION-RUNTIME.md` in that checkout |

Both may use bounded Opus/Sol low delegates and Terra high swarms through Herdr. No additional Fables and no harness subagents. Each delegate needs one mission, stop condition, time box, report path and explicit file ownership. One writer per checkout; create sibling worktrees for writers. Root owns integration and the shared brief. Do not edit another line's checkout or retire its sessions. Keep fresh judgment separate from implementation context.

## Round one

Stop after an evidence-backed census, candidate comparison, and decision frontier. Checkpoint within 15 minutes; initial round budget 30 minutes. If measurement is blocked, report the exact missing capability and proceed with independent source work. Do not silently substitute synthetic tests for visible Chrome measurements.

Surface partner uses ground, protoui, house, purge and demiurge where contracts demand it. Runtime partner uses ground, diagnose and demiurge. Read repo-local instructions and current tooling. Shared contract changes and product cutovers wait for the design verdict. Read-only review, reports, disposable instrumentation and isolated exploration are authorized. No Revit mutation or lifecycle changes in this round.

Each report records source/commit evidence, reproduced versus suspected failures, retired-owner and LOC opportunities, alternative shapes with failure conditions, and numbered user questions. File every finding compactly, including broader discoveries. Do not send a chronology or an unranked patch list.

Runtime partner owns the Chrome benchmark session so interactions do not collide. Publish its actual browser/server/checkout identity early. Surface partner may inspect its own Chrome tab; never interact with the benchmark tab. Discover ports and protect existing services. Browser evidence must name actual bytes and conditions; fixtures prove rendering only.

Cross the independent reports at thread selection, route state, composer context and container lifecycle before choosing the final contracts. Terra swarms perform bounded normalization only after those contracts and their acceptance journeys are settled.

## Round two

Final first-cutover behavior rulings: 24px shared rails; one table artifact header with optional filter row; composer has its own halo/help region; Chat shows actual turn state rather than selectable workflow stages. Threads/Trace/World remain view modes. User-approved shape may now be implemented in isolated lanes; gutter/halo color refinement remains visual tuning.

Visual verdict: user selected A emphatically, accepts the overall direction, and wants gutter/halo color refinement. B has a table/composer stacking defect visible in the supplied screenshot. A's in-flow composer and pane treatment are selected, with 24px rails. Full large tool results load on expansion, with original content preserved. Runtime must verify its actual benchmark tab is visible.

New user ruling: retain unsent text and attachments per thread; avoid a separate persistence source. Evaluate React Activity for retention. The newly selected thread shows explicit loading, not previous-thread content. The sidebar must not empty during the transition. Evaluate Suspense generally at pane/workspace boundaries. The native mechanism is the user's preferred direction; validate its fit and lifecycle constraints before selecting an implementation.

The apparent runtime terminal draft naming B/C/D was Claude's suggested response, not user input. It has no authority. The subsequent explicit user rulings above govern implementation.

## Current execution frontier

- Root integrated shared geometry through `6243b33`, keyboard/tutorial `794ee2c`, workspace/route consumers through `97cc548`, stored tool-result deferral through `e959fa0`, equal-reading heartbeat suppression `3903970`, Chat runtime/layout through `3a74472`, and the compact Chat Situation/thread picker `9da87d7`. Drafts use retained composers; transient views reset without remounting the shell. HTTP body and live display are distinct authorities.
- Root deterministic checks: 161 workspace/primitive tests passed before later Chat integration; 26 pane/help/schedule tests passed; 5 runtime deferred-result tests passed; 19 deferred/readings/images/diagram/copy/census tests passed; latest combined Chat/primitive run passed 69 tests. Full web run at `3a74472` found 9 failures, 414 passes, 1 skip: old lens/image test compositions lack CurrentThreadViewOwner. Chat lane must migrate those tests without weakening behavior. Full acceptance is not yet green.
- Chat Terra high (`unify-chat/chat`, `Pe.Tools-unify-chat`) owns final native composer keyboard/help integration and affected test composition. Head Terra high (`unify-chat-head/head`, `Pe.Tools-unify-chat-head`) delivered the shared 24px rail and thread selector, now integrated; root owns browser acceptance. Reports: `docs/features/agent/CHAT-CUTOVER-REPORT.md`, `CHAT-HEAD-REPORT.md`.
- Shared foundation Terra (`unify-foundation/foundation`, `Pe.Tools-l0-surface`) is deleting obsolete SidePane and its specimen/test references after production callers disappeared. Table fill, compact action scrolling and null-side hit testing are integrated; viewport head behavior remains a separate pending user choice.
- Browser Terra (`unify-workspaces/workspaces`, `Pe.Tools-unify-workspaces`) rechecks root Takeoffs geometry and Chat draft/thread/plugin journeys in owned CDP target `6DD36FB304CFB2E1F938130A2E771608`. Initial 12 route captures proved 24px rails, horizontal gutters, no pane intersections and resizing; falsified full viewport containment. Root report: `ROOT-BROWSER-REPORT.md`. Raw paths resolve in that sibling checkout. No Revit actions or prompts sent.
- Root no-Revit proof server remains Herdr `unify-root` pane `w1:p1`, browser `http://127.0.0.1:5176`, host port55177. Receipt `host-source-cfac28d8dd61-no-revit.json` verified source root and pid40296 after runtime rebuild. Re-read before reuse. Browser5175 is the separate runtime spike, not root.
- Foreground performance capture is complete and archived in `docs/features/agent/PERFORMANCE-HANDOFF.md`; all eight runs were visible. Combined-spike idle/select/typing improvement is development evidence, not production or per-change attribution. Reload is confounded. Current-root performance rerun remains owed after browser correctness. User no longer needs to keep the original benchmark window uncovered.
- Independent Opus review in `Pe.Tools-unify-runtime/docs/features/agent/CHAT-RUNTIME-REVIEW.md` rechecked F0-F3 (wire display gate, keyed-shell draft loss, unsent draft pruning, plugin remount) and finds all four fixed by `1176706`/root `fe81172`. Archive refresh remains owed. This is source review, not browser proof.
- Deferred results: successful stored results over64KiB become typed summary/size metadata and load exact originals on expand. No second result store. Shared useHostCall hides prior-target data immediately. Live SSE can still deliver full results; measure active/reconnect payloads before any stream projection. Report: `docs/features/agent/DEFERRED-RESULTS-REPORT.md`.
- Baseline schedule failures were shared-test-document contamination, fixed in `b257e57`. Fixture census now uses real demo keys and truthful live URLs through `266cc9f`; stale Families links corrected in `5e33cb4`. Zero missing review URLs, but five routes genuinely lack deterministic fixtures: Data Tables, Ops, Parameter Links, Runs, Schedule Grid. This coverage gap remains explicit; no fake fixture or debt allowlist was added.
- User settled narrow tutorials as spatial maps with horizontal scrolling and preserved scroll-away route heads. Judge workspace containment after the head scrolls away. Surface Fable prepared prototype A colour treatments `tone=fill` and `tone=line` at5181, documented in its UNIFICATION-SURFACE report. Colour review waits for integrated Chat shape; no production palette change assumed.
- Root at `1183877`: obsolete SidePane removed, composer help moved into its retained Activity, and tests migrated to the real current-thread owner. Full web test output reports 424 passed, 1 skipped (80 files passed, 1 skipped). PowerShell wrapped Node stderr warnings as NativeCommandError and returned 1 despite the green Vitest summary; no test failure is reported. Keyboard descendant default handling still under review.
- Narrow Chat browser check reproduced overlapping document/thread targets and theme controls; the head lane is correcting it. The first draft-retention browser script used full document navigation, so it cannot prove mounted Activity retention; the browser lane must repeat with real SPA thread selection.
- Remaining closure: composer native help and full test suite; root browser acceptance and responsive containment decision; current-root performance/payload measurement; colour verdict; deletion acceptance and owned-runner/server cleanup. Root actively checks Herdr states. No claim that a watcher wakes a finished conversation turn.
