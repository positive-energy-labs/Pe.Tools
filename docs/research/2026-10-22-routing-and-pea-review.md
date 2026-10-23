# Routing and Pea review, October 18–23, 2026

The system has six distinct owners. That separation is worth keeping. Most defects found in this review were adapters crossing an owner boundary incorrectly. The repair is convergence on those owners, not another state framework.

| Owner | Question it answers | Human reason |
| --- | --- | --- |
| [Route address](../../ts/packages/agent-contracts/src/route-address.ts) | Which view can be linked, restored or requested? | A pasted link and Back should return to the expected place. |
| [Page](../../ts/apps/web/src/route/view-owner.ts) | What is this browser presenting and editing now? | Moving between systems should preserve orientation without preserving another source's confirmation. |
| [Reading](../../ts/apps/web/src/readings.ts) | What was observed, and is it fresh? | Keep the picture useful during refresh without pretending old evidence is current. |
| [Work](../../ts/packages/runtime/src/route-workspace.ts) | What has the person or Pea authored? | Effort survives navigation, permission changes and interrupted attempts. |
| [Visible view lease](../../ts/apps/web/src/route/view-bridge.ts) | Which mounted Page can Pea address? | Pea and the person can refer to the same visible situation. A rendered acknowledgement does not prove a new model read. |
| [Admission and receipts](../../ts/apps/host/src/action-journal.ts) | May this exact attempt execute, and what happened? | Inspectable intent, exact document lifetime and durable outcomes protect real model changes. |

Thread targets connect these owners without merging them. A thread may name several documents. A particular route binds one current document. Authored proposals need thread membership; native execution also needs admission. Full access does not turn every retained view or proposal into permission to execute.

## What changed and why

| Repair | Result and reason |
| --- | --- |
| Acquire the event-only `world` Reading | Host sends an initial null snapshot before later events. A quiet subscription no longer looks unanswered to the 30-second watchdog. This addresses the reported periodic Ducts blanking without disabling stall detection. |
| Retain presentation through stale reads | The same Reading key can keep its previous picture and rows. Freshness still gates leases, native scope and actions. A different target does not inherit the old target's picture. |
| Restore dependent Page fields atomically | URL and initial restoration run manifest transitions. Changing a Families source clears its confirmation and sheet, so Back cannot display B while retaining A's reviewed plan. |
| Resolve document-owned Work explicitly | Multi-target Pea threads can propose Work for an exact member document. The host validates membership and current lifetime. Removing a target preserves the authored proposal and staged cells. |
| Align discovery with invocation | `set-view` describes both opening and mounted instance/revision-fenced updates. ReadOnly script prose matches its deliberately narrower permissions. Offline discovery uses generated native vocabulary; the bridge supplies availability. |
| Repair recorded exits | Schedules records `workspaceId`; Open action lines retain a receipt fallback. Ducts joins canonical document-route registration so accumulated Work can produce an exact-current-document resume link. Missing or ambiguous bindings keep the Work and explain why it cannot resume. |
| Check native authority at dispatch | Full→Guarded or removal of a grant-backed target can refuse an operation still waiting in the host queue. An operation already dispatched finishes and retains its receipt. Cancellation stops that attempt, not authored Work. |
| Make transport failures visible | Lease publish, remove and acknowledgement failures enter browser diagnostics instead of disappearing. |
| Keep native catalog metadata out of browser imports | The generated catalog has its own `@pe/host-contracts/catalog` entry. All 90 records stayed identical. A measured Vite response fell from 2,995,696 to 449,522 bytes; this is transfer evidence, not a measured interaction-speed claim. |
| Respect retained list state | Kit rows survive pending/failed reads, expose busy/failure state, and pass freshness to callbacks. Web owns previous values and refuses pending/failed choices as mutation evidence. |
| Isolate reproducible browser runs | The launcher owns its no-Revit host, product home and visible Chrome. `--no-tray` prevents it from replacing the person's shared dev-tray receipt. Cold HTTP document readiness is separate from the unchanged CDP command deadline. |
| Keep feedback in its existing place | Automatic action status no longer takes focus. Refresh uses the reserved readout cell; the current composer reserves its existing refusal row. Both avoid moving the person during a reread. The kit's later Send-owned outcome replaces that interim composer row. |
| Retain unsent drafts at their owner | A browser-issued draft does not subscribe to a nonexistent persisted thread body. A real persisted empty thread still fences while its body reread is held. Pea and tool pages share one ChatShell, and ComposerBank uses the issued address, so Home/Back preserves the exact textarea and text. |

The user ruled that Work should accumulate visibly. Removing permission does not delete it. Existing Work/navigation surfaces remain the way back; a new global Work manager was not built in this wave. Per-pane skeletons and separate Ducts/pricing Suspense boundaries remain lower priority than navigation continuity.

The route primitive census found existing owners for the proposed effect/settings work: `RouteAction.does`, semantic actions, manifest options/globalOptions and SettingsProjection. This wave adds no effect runner or settings store. That does not claim every consumer has completed every possible adoption.

## Pea's context

Pea gets a progressively disclosed world. The kernel and admitted source describe the product. `pe_find` exposes vocabulary, thread targets and live availability. `pe_read` supplies bounded source, Work or a leased Page. Invocation rereads the current thread/admission state rather than trusting earlier prose. A target chip is not a model snapshot; a Page acknowledgement is not a fresh Reading; a proposed edit is not a native write.

This reduces both human and agent ambiguity. It still needs actual-agent quality testing. Generated C# metadata is vocabulary authority, but metadata alone cannot prove that a bridge, document or native effect is available now. K9 sibling-document ReadOnly rollback remains a separate native obligation in [ADR 0021](../adr/0021-one-access-switch-and-document-targets.md).

Root carry keys (`thread`, `target`, `work`) remain separate from typed Page codecs. Consumer validation and generated C# link producers still need adversarial URL coverage. The bounded open-to-lease wait also needs slow native-mount proof. A rendered acknowledgement proves the Page changed; it does not prove a new Reading arrived.

## Evidence and limits

Source review began at `a553a15a`. The completed demo Chrome journeys loaded clean source `9da061c3`, observed as `x-pe-web-build=9da061c332d6`. Kit certification is limited to wave 3, `dc832ed6`; later kit waves have separate acceptance.

The real controlled dev session `acc-route-polish-20261023`, Revit PID 41836, ran copied Snowdon HVAC A/B with payload stamp `8351da434a23`. Chrome observed web build `cc720203d9d8`. Trusted UI edits and two confirmation applies produced **A15/B15 → A16/B15 → A15/B15** for the selected diffuser type's NC parameter. Independent exact-target reads verified all six values; the parent independently re-read final A15/B15. Nonempty staged Work survived A→B→A and Home/Back. The extra stage was explicitly unstaged. A remains modified because family reloads changed native identities; neither copy was saved. [Native evidence](../../.artifacts/handoffs/2026-10-23-route-native-crossing-r5.md).

That run found familyId and parameterElementId changes across reload. Fresh plans/readbacks must reacquire identity. The evidence compares document lifetime plus family/type/parameter meaning; it does not claim whole-model byte equality. The user's Revit PID 36024 and host 53123 were not driven.

The Chrome journey runs through actual controls and observes DOM identity, focus and its scroll parent, pane scroll, URL, pose, layout shifts, action arming and network traffic. A 36-second quiet witness accepted seven identical five-second lease renewals at revision 2 with SSE unchanged at 2. A deliberate disconnect failed the actual SSE continuity assertion, 2→3. A zero-request lease oracle was rejected because healthy renewals are required. [Oracle evidence](../../.artifacts/handoffs/2026-10-23-route-chaos-journey-r4.md).

The integrated default journey passed all eleven selected steps on seeds `20261023` and `20261024`. Both crossed refresh, offline/online recovery and a genuinely paused pricing worker before Home/Back. Each quiet dwell kept SSE at 2 and accepted seven identical lease renewals. Focus, scroll-parent identity, camera pose, drawing continuity and layout-shift checks stayed strict during disruptions. The deliberate disconnect control on seed `20261025` failed the network assertion at SSE 2→3. [Checked witnesses](../../.artifacts/runs/browser-20261023-route-polish/journeys-checked.json).

The run found and fixed actual focus theft, a 44 px readout shift, a 20 px composer shift, false draft freshness fencing, and unsent text lost across Home/Back. The test also overclaimed Activity retention across a thread change. Activity retains route DOM within one thread; global Open Pea starts another context. Returning must restore the exact URL, picture, readout, selection and pose, without stale action arming. The corrected test checks that boundary. An independent issued-UUID regression proved the same textarea and text survive Home/Back, with a red control on the old source. Unsent text remains React-owned and does not survive a full reload; revisioned Work has a separate durable owner.

Full `pnpm verify` passed at `c3acd75f` before these final continuity repairs. Final verification of the integrated source is pending; the earlier formatting, cold readiness and obsolete log-locator failures are repaired.

Replay from `ts`: `vp run --no-cache journey:routes`. The default requires refresh, reconnect and a paused real pricing worker. `--seed 20261024` reproduces the second sequence. Two-thread identity and native Preview arming need their stated preconditions; omitted coverage makes the receipt `partial` even when every selected step passes. Actual native Apply is proved by the independent A/B crossing above, not by the journey's arming check. [Commands and contracts](../../ts/tests/e2e/README.md).

Queued cancellation is proved through the production journal/FIFO bridge with a fake socket and a deliberate red control. Real Pea native refusal, target-removal retention in Chrome, K9 rollback, installed behavior and general agent context quality remain unproven. They must not inherit the human/local apply stamp.

## Documentation and worktrees

Two review editing rounds measured 14,635 words removed, 22.5%, across eleven touched documents. The integrated distillation folds seven reports into three owning ledgers and cuts obsolete chronology and duplicate obligations. Uncertain successors and native proof obligations survived. Concurrent instruction-map and user skill edits were preserved separately. Code remains the behavior specification; these documents retain reasons, rejected choices and remaining proof.

The initial nine-worktree census found recent adjacent activity branches plus three reconciliation candidates: `rooms-astra-w2`, `goal/pea-ducts` and `entity-wave-c`. The latter had two dirty guard tests. The goal branch was 847 commits behind and entity branch 975 behind at the review baseline. Squashed ancestry is not a missing-feature count, so none was blindly merged or deleted. [Exact paths and heads](../../.artifacts/handoffs/2026-10-22-route-review-worktrees.md). New delegated implementation worktrees are temporary and must be retired after their evidence and commits are integrated.

The final [registered-worktree census](../../.artifacts/runs/browser-20261023-route-polish/worktrees-final.json) distinguishes those older branches from the kit's active integration work. This run's copied-model Revit session, hosts and Chrome instances are stopped; the person's Revit remains running. Interrupted browser attempts are retained as interrupted evidence, not acceptance.

PROVEN[browser + controlled dev session, copied A/B UI apply/readback at cc720203 + payload8351da434a23, 2026-10-23].

PROVEN[browser, two selected demo journeys and deliberate SSE disconnect red, clean source/build 9da061c3, 2026-10-23].

FALSIFIED[browser, old source lost issued-thread draft on Home/Back; deliberate disconnect is detected by the final network oracle, 2026-10-23].

UNPROVEN[final integrated repository verification pending; native Pea authority, K9, installed, two-thread switching and native arming in the replay, and actual-agent quality require their own lanes].
