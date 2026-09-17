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

- Root code is integrated through `5e32a43`. Shared Surface/Pane/Rail contracts replace route-specific layout owners; obsolete SidePane is removed. Chat uses the shared compact rails, route-owned thread selection, retained per-thread composers, explicit body loading, and deferred full tool results.
- All visual rulings are settled: A in-flow composer, 24px rails, one table header with optional filters, composer-owned help, actual turn-state readout, scroll-away route head, spatial tutorial with horizontal scrolling, and line-tone halos painted above the gutter.
- Deterministic validation: full web suite at `6b0ddb4` passed 425 tests with 1 skipped; final prose change passed 21 focused tests. Changed-file checks passed formatting for 95 files and lint/type checks for 93 files. These checks do not prove Revit or reconnect behavior.
- Current-root browser evidence proves real SPA A/B draft-text retention, exact large-result retrieval on expansion, narrow Chat prose containment, and halo paint above both gutter edges. Takeoffs at 1280 has 24px rails and 8px margins after the head scrolls away. Its narrow width fits; narrow fully-scrolled height and tutorial horizontal scrolling were not observed in the final pass.
- User accepts current performance as good enough; performance experiments are stopped. Returning to a long transcript still produced about 410ms of main-thread work in one development capture. A five-entry recently visited transcript Activity set is a feasible future option, not implemented or required this wave; its eviction must not discard independently retained drafts. Five is a count limit, not a measured memory budget.
- The content-visibility experiment reduced one return task from 427ms to 298ms but changed scroll height from 17,710 to 13,229. It was removed; turn navigation and focal-map safety remain unproven. Current-root measurements and raw evidence paths are in [PERFORMANCE-HANDOFF.md](../agent/PERFORMANCE-HANDOFF.md).
- Remaining browser proof: attachment retention, plugin continuity, send/proposals, genuine disconnect/reconnect and full resync. Network emulation did not close existing SSE and cannot prove reconnection. Opening a pinned result in Trace fetched its original again; no extra cache was added.
- Final narrow capture noticed the collapsed keys tab obscuring the start of the composer sentence; this remains a filed visual finding, not a proven cause or fix. Code blocks have internal overflow containers, but trusted horizontal scrolling and tables were not exercised in that thread.
- Dev watcher restarts were observed, but their triggering path/event was discarded. Real transient writes versus spurious notifications remain unproven; the next diagnostic is to include event and path in the existing restart log, not add a metadata cache.
- Five routes still lack deterministic fixtures: Data Tables, Ops, Parameter Links, Runs, Schedule Grid. Review URL coverage does not close that gap.
- Root review server is `http://127.0.0.1:5176`, Herdr `unify-root` pane `w1:p1`, Host port55177. Last verified Host pid68132; re-read the checkout receipt before reuse. The original 5175 spike server was stopped. Opus completed its bounded checks, released Chrome at 1280 on Chat, and stopped performance work. No finished-turn watcher is promised.
