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

- Root integrated diagram font fixes through `a2fe7ba`, shared foundation and parent-sized Surface through `17dfd34`, workspace consumers through `f0c9bf7`, standalone routes through `97cc548`, and fixed-split grid correction `e883b34`. RootComponent owns viewport height; embedded surfaces fill their parent. Table-only panes retain semantic names without duplicate visual headers. Rail owns compact action refusals.
- PROVEN[deterministic, root before `e883b34`]: focused pane/table/Family/Families/Takeoffs/Settings run passed 161 tests across 16 files. Foundation partner additionally proved the split correction with 17 pane tests. Root browser validation remains active, not certified by those tests.
- Terra high `chat`, Herdr `unify-chat`, remains sole writer for Chat runtime/layout in `Pe.Tools-unify-chat`. Checkpoints include per-thread Activity drafts, URL seed-only handling, thread-keyed body atoms, live display before delayed body hydration, and transcript-only Suspense. Root review and integration remain pending; report `docs/features/agent/CHAT-CUTOVER-REPORT.md` in that checkout.
- Terra high `workspaces`, Herdr `unify-workspaces`, is checking root browser geometry in its own Chrome tab on 5176: viewport gutters, parent sizing, one table rail, 24px rails, resizing and narrow layouts. Report `ROOT-BROWSER-REPORT.md` in its checkout. No Revit actions.
- Terra high `routes`, Herdr `unify-routes`, now owns bounded shared keyboard/tutorial work: existing key presentation, hover/focus verb chords, tutorial chart rendering and factual route instructions. Chat files remain with Chat. Report `KEYS-TUTORIAL-REPORT.md` in its checkout.
- Sol low `receipts`, Herdr `unify-runtime`, owns a bounded deferred-result contract census in `Pe.Tools-unify-runtime-receipts`. Full original tool results must remain transcript-authoritative; wire metadata and exact-result endpoint need root review before implementation. Web integration is pending Chat closure. Report `docs/features/agent/DEFERRED-RESULTS-REPORT.md`.
- Surface Fable and runtime Fable are idle after their design/handoff work. Fresh Opus low completed foreground profiling in `Pe.Tools-unify-runtime`; report `docs/features/agent/PERFORMANCE-HANDOFF.md`, raw `.artifacts/runtime-bench-20260916/cdp`. All eight baseline/spike runs were visible. Idle/select/typing traces support less repeated script work; combined-spike numbers do not isolate interventions. Reload is confounded by Vite transformation. User no longer needs to keep Chrome uncovered.
- Root proof server: Herdr `unify-root`, pane `w1:p1`, root `source/pe-tools`, `vp run dev:no-revit`; browser `http://127.0.0.1:5176`, backend `http://127.0.0.1:55177`, service `host-source-cfac28d8dd61-no-revit`. Verify current receipt before reuse. Browser5175 is the runtime spike, not root. Service `host-source-3a8196893e0b` belongs to `Pe.Tools-pod-feature-review`, not root.
- Owed baseline failures, proven before foundation at `1406e70`: `vp test scripts/fixture-census.test.ts src/schedule-grid/seams.test.tsx` yielded 3 failures/4 passes. One canonical fixture is missing; receipt seam cannot read schedule capture `837acb27a0b40e690b5a8435ad905d4395ea5b103577e2ca4985d461cfafc682.json`; apply queue gets `stale-revision` for its first result. These are not waived final acceptance.
- Remaining closure: Chat integration and browser journeys; deferred-result implementation; shared keyboard/tutorial acceptance; gutter/halo color tuning with user; remove obsolete SidePane after all consumers/specimens migrate; full validation and retire owned disposable runners/servers. Foundation baseline-proof processes were checked and none remain.
- Root checks actual Herdr states during the active turn. No claim that a watcher wakes a finished conversation turn.
