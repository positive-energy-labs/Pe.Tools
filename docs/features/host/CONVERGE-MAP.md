# Converge: one durable command path, owned where the truth lives

Rewritten 2026-11-18 from the kernel map agreed by the Converge root and the field root. The earlier map, with the Effect Workflow target, its slices S0-S9, open decisions OD1-OD9, gates FND-01..03, evidence register and role charters, is in Git at `d00b801f`. Draft and evidence sit in the root checkout under `.artifacts/runs/converge-20261118-kernel/`, `.artifacts/runs/converge-20261117-bspike/` and `.artifacts/diagnostics/maddo-20261117-*/`. This map does not need them to be read.

## Nouns and invariants

### Root cause

Only Revit knows whether an edit landed, but the host rebuilt that fact for each feature. So every consumer inherited infrastructure work it should not own: a per-feature `recover` that guessed from receipts, two names for one session translated per door, and Work retirement that each feature had to opt into. The native side had the primitive (SDK `MutationAdmission`), but the bridge treated it as best-effort diagnostics, so real Revit ran a resent id twice.

The general rule: **effect identity belongs to the owner of the effect.** A native edit gets it from SDK `OpAttempt`. A host file effect gets it from a create-only or content-addressed write at its own store, because Revit cannot dedupe it. [ADR 0049](../../adr/0049-effect-identity-belongs-to-the-effect-owner.md) holds this rule.

### Direction

The journal (`ts/apps/host/src/action-journal.ts`) stays the one durable owner of commands. Both Family Foundry applies keep the same `runApply`, and native truth comes from the SDK's recorded attempt response (`readNativeReceipt`). The Effect Workflow core is rejected ([ADR 0050](../../adr/0050-workflow-owns-durable-commands.md)). Field failures from release 0.7.33 order the work, not architecture layers.

### Nouns

| Noun | Meaning | Owner |
|---|---|---|
| Attempt | One request id with one intent digest: op key, stable document identity, canonical payload text. | SDK `OpAttempt`, below every door into Revit |
| Outcome | What Revit recorded for an attempt, bound to the process incarnation, the document open instance and saved-after-commit. `unknown` stays an honest outcome, because native identity prevents a second run but does not make the edit and its record atomic. | SDK `OpAttempt` |
| Action | One admitted command in the journal, with its steps and its state. | Journal |
| Receipt | The journal's durable record of an action and its steps, which History and the Timeline project. | Journal, `receipt-services.ts` |
| Claim | A reservation an action holds on a resource, such as a document or a `session-slot`. Only a running action excludes another. | Journal (`holdsClaims`) |
| Held | An act that waits on the person: sync and discard only (ADR 0038, ADR 0052). | Journal and the person |
| Blocker | Named by the kernel map with no definition yet. The first row that needs it defines it here. | Open |
| Freshness | Whether the model changed since a reader last read it, from the document's change number (`TrackedDocument.ChangeRevision`, row N2). | SDK answer, field root |
| Work | Editable intent with revisions. Family Foundry retires only cells that successful receipts confirm (`confirmedRetirement`). A newer edit is never retired. | Host Work owner |
| Session | Today the SDK session id and the private bridge id, still translated per door. One session name is parked. | SDK session row and the bridge |
| Reading | A native read. Today `reads/read-ownership.ts` and `native-reads.ts` own shared reads. Shared reads on `RcMap` are parked. | Host read owner |
| Contract | C# DTOs and op metadata are the authority. The generated Effect Schema is inactive staging (TC-005), and runtime decoding still compiles native schemas (TC-004). | C# and the generator |
| Door | HTTP, Pea/MCP, web, CLI. A door should decode, call one method and map the typed failure once. Thin doors are parked. | Each door |

Dropped words: Act, Hold, Exit, Admission service, Command (Workflow), Feature adapter, Host effect as a Workflow Activity.

### Invariants and their current proof

Stamps are copied from the earlier map and not re-verified here.

| # | Rule | Proof now |
|---|---|---|
| I1 | At most one native commit per attempt id, across both doors and across a session restart. | PROVEN[session, acc-dedupe-b, Pe.Tools 965e2ae9 + SDK beta.222, 2026-11-16T08:17Z] for the bridge across restart and for both doors in one incarnation (`sdk-dedupe/REPORT.md` phase E). The phase E replay-classification fault is fixed: PROVEN[session, acc-dedupe-d, Pe.Tools 12bd0cfd + SDK beta.224, 2026-11-16T09:24-09:48Z] the digest uses the SDK document key and both doors answer a post-restart resend with the typed ended outcome (phase F). |
| I2 | A changed intent under the same id is refused, never joined and never forked. | PROVEN natively (409 `AttemptConflict`, phases C and E). Host half: the spike graded the journal true on case 2, changed intent (`converge-20261117-bspike/COMPARISON.md`); testimony here. |
| I3 | The host never reports applied for an edit that is no longer in the document without saying so. | Native half PROVEN[session, acc-dedupe-d, Pe.Tools 12bd0cfd + SDK beta.224, 2026-11-16T09:24Z]: a resend after restart without save answers `AttemptEnded` with `savedAfterCommit:false` and the readback shows the edit gone; after a save it answers `savedAfterCommit:true` and the readback shows the edit. Limit: proven only for a controlled stop, because Revit's fatal-error dialog can write recovery copies. Host half UNPROVEN. |
| I4 | A retired request is in the model or saved. | PROVEN[deterministic TLC, `muse-d0/retire-model/`, no code, 2026-11-16] only for an abstraction where every save is observed, never fails and is never undone. UNPROVEN[real save observation]. |
| I5 | A newer Work edit survives retirement of consumed intent. | Source testimony: conditional retirement at `action-journal.ts:1558`, with `work-write-boundary.ts`. Not modeled. |

### Kernel rules

Agreed between the two roots, 2026-11-18:

1. **No kernel change without a named field failure or a driven false answer.** Each row lands alone on main, is replayed against that failure, and rides the next release. Principle wins only when it deletes code or removes a failure someone hit.
2. **Open means running.** Only a running action excludes another. `unknown` and `incomplete` are terminal for exclusion, and a claim ends at any terminal state. K1a's one departure: a succeeded action still holds its claims, because a succeeded `instances.open` keeps its `session-slot` claim while that Revit lives and a later step's `releases` ends it.
3. **A reply settles a step forever.** Observation asks the SDK only about a step that was dispatched and has no reply about the model. A reply of `missing-touched` or `invalid-touched` says nothing about the model, so it counts as no reply and gets the one SDK read.
4. **Size stop.** Each row carries a line estimate. A row past twice its estimate stops and is re-planned. The kernel rows together end net negative.

## Ordered deletable slices

Line counts are unmeasured estimates of production lines. Order: K1a first and alone. N1a and N2 run beside it with no shared files. Then K1b, K1c, K2, K3. K1b waits for guard 3's commit `3ef17a4b` to merge, because that commit edits the journal. An export from Maddox proves a row only when the case occurred in it: the replay fixture is the proof, and the export is the check that it holds on his machine.

| Row | Change | Failure it removes | Replay fixture | Next export must show | Est. | Owner |
|---|---|---|---|---|---|---|
| K1a | `isOpen` is running only; claims end at any terminal state except succeeded (`holdsClaims`). | A failed write script locked every later write script (`0cde3cc0`). A dead Revit's year claim blocked "open Revit" (`c86a4225`). | Revision 7 of `0cde3cc0`: a later script is admitted. `c86a4225`: "open Revit" is admitted. | No `refused` record naming another action as unknown or incomplete; no "Resource is reserved by" naming a terminal action. | +10 / -10 | Converge |
| K1b | Rule 3 in `recover`. Admission answers a known id from its row, and Pea's four call sites stop asking first (`admission.ts`, `host-rpc-caller.ts`, `takeoff-action-client.ts`, `capability-tools.ts`). Delete the Recover and Resume doors (`call-route.ts`) and web controls (`apps/web/src/ops/route.ts`). At reconnect, one SDK read per no-reply step; the row stays `running` only while that read says so, and stays stoppable. Cut the boot read if it costs more than about ten lines. Fix the retry that drops `retirementOnly`. | Recover flipped a failed step to succeeded and looped. "Action recovery failed (403)" from another thread. | The same row plus a resend of its id: the step stays `failed` and no revision is written. | No `/actions/recover` call; no step that changes state after its reply; no "Action recovery failed". | +60 / -200 | Converge writes, field root reviews |
| K1c | Release a succeeded launch's `session-slot` claim when the machine census no longer sees the session. The writer first finds when a succeeded `instances.open` keeps the claim and when it does not. | A session that ends other than by a journaled stop holds its slot forever (action `89878f76`). | Dev-lane only; Maddox's exports do not hold the case. | n/a until the case occurs | unset | Converge, after K1b |
| K2 | Store `sourceBundle` once by hash; compact on bytes, not lines; stop writing a stale `state` into step files, after a census of their readers. | `partition-operations.json` grew from 1 MB to 65 MB in 52 minutes. All 51 step files said `running`. | His tail file: bytes before and after. | Under 200 KB added per Pod run, against about 5.7 MB today. The target is a guess. | +80 / -30 | Converge |
| K3 | Port the spike's Stop-after-write fix, with its drive rebuilt on main. | After a Stop that lands post-write, the receipt reads "cancelled before dispatch" and Undo restores a value the model contradicts (driven twice). Ledger Owed `FFX-CANCEL-WROTE-01`. | The spike's 4c drive. | n/a | +40 / -10 | Converge |
| N1a | Project the first error diagnostic into `action.error` (`operation-script.ts`). Run scripts through `RevitDialogs.NoModal`. End a transaction the script left open before closing its group. | A failed script's receipt had no error text. A script's modal froze Revit for 3.5 minutes. A throw with a transaction open leaves the document mid-transaction. | His failing script; a script that raises a modal. | Error text on a failed script's action; a script's dialog appears in its result as answered. | +60 / -5 | Field |
| N1b | Roll back the transaction group on a throw, report `rolledBack`, and tell Pea that a throw undoes the run and that a script keeping partial work catches its own errors. | A failed script left 23 added, 1,326 modified and 110 deleted elements. | The rollback spike's 12 rows (`t3/notransaction-rollback-vs-assimilate-spike`, `b4bd4100`). | `rolledBack` on a failed script, or `incomplete` with its counts where the run could not be grouped, and nothing refused after it. | +80 / -15 | Field |
| N2 | Every native answer carries `TrackedDocument.ChangeRevision` in the existing revision slot. One line in Pea's tool result says whether the model changed since this thread last read. A write's answer carries the number after its own commit. Prove first that an undo bumps the number. | Pea called claims proven after the person's own undos had changed the model. | A controlled session: read, undo by hand, read. | The line present after a hand edit. | +60 / -0 | Field |

Status, 2026-11-18: K1a merged to local main at `d00b801f`, +5 / -36 production lines, not pushed. K1b has one writer on `t3/kernel-k1b-reply-settles` from `d00b801f`.

**File split.** Converge owns `action-journal.ts`, `command-*.ts`, `native-receipts.ts`, `receipt-services.ts`, `call-route.ts` and SDK `OpAttempt`. The field root owns `Pe.Revit.Scripting`, `OpRunner`, `OperationMonitor`, `operation-script.ts`, web, products, Pea skills and homes. K1b's writer also holds Pea's four call sites and the two web controls for that one change.

**Parked.** Each waits until it names a field failure or a driven false answer: one session name; activating the generated schemas; the consumer sweep; shared reads on `RcMap`; thin doors; derived step ids; held-for-sync and held-for-discard across a restart (one drive on main decides); one document name and the SDK `DocumentKey` fix for two locals of one central; the SDK queue naming a blocking dialog; reading another thread's terminal row on the same document (the 403 on `GET /actions`).

**Standing regardless.** Delete the `humanOnly` call flag. Whoever releases SDK branch `fix/fnd01-document-observation` moves the `op result` decoder in `native-receipts.ts` in the same change.

**Not in this map.** Held by the field root: `view.ack` reports "rendered" for a subject that does not exist; "Invariant failed" on kept routes; the Pod compile DLL leak (CS0433); fans seams R and S; project-home UX; Pea's seven failed attempts on a live project document before the one that wrote; up to 24 s before Pea's first output; token cost per turn, up to 2.9M. No owner yet: `rooms.draw` landing partway, whose long-term answer is one transaction group per command on the native side.

**Not verified.** What each of Pea's four callers does with a recovered row. That an undo bumps `ChangeRevision`. That Revit's queue serializes an op still running across a host restart with a newly admitted one. That a group rollback is clean on a workshared model (ADR 0044 lists it as unproven). What feeds `IObserved.Revision` (`dotnet/Pe.Shared.RevitData/Evidence.cs`). The line estimates. K1c's premise on an installed machine. A second field shape for K1a: `5768f811`, a `failed` launch still holding its slot claim on 0.7.33.

## Deletion criteria

### Canonical temporary-coexistence inventory

Owner, 2026-11-16: "this needs to be tracked methodically so that by the end of the crusade its all gone." Completion requires zero open rows, by final code, caller, test and config reconciliation. Only an explicit owner ruling closes a row as permanent. The full anchors, owners and census gaps per row are in Git at `d00b801f`.

| Row | Item | State |
|---|---|---|
| TC-001 | Legacy journal (`action-journal.ts`) | CLOSED PERMANENT, owner ruling 2026-11-17: the journal is the one durable owner. |
| TC-002 | Executor and per-feature recovery (`command-executor.ts`, `command-registry.ts`, `family-actions.ts`) | Family Foundry recovery and scanner CLOSED by removal `638fe9c9`. Shared executor CLOSED PERMANENT by the same ruling. `family.attach-spec` recovery in `family-spec.ts` and other-family caller closure stay unreconciled. |
| TC-003 | Host native recovery and inference (`native-receipts.ts`) | OPEN. SDK observation and lifecycle holds not lifted; full caller closure UNKNOWN. |
| TC-004 | Transitional native schema bridge (`native-schemas.ts`, `native-output-read.ts`) | OPEN. Its cutover waits on schema activation, which this map parks, so it has no end date. Needs an owner ruling: activate or delete. |
| TC-005 | Inactive generated staging (`native-effect.generated.ts` and its generator) | OPEN. Same as TC-004: parked activation, no end date, owner ruling owed. |
| TC-006 | Inactive Workflow kernel (`ts/apps/host/src/commands/`) | CLOSED by removal `8e107a58`. |
| TC-007 | Activity result reconstruction | CLOSED by removal `8e107a58`, no replacement. |
| TC-008 | Recover and resume doors (`action-dispatch.ts`, `call-route.ts`, web ops route) | OPEN, being removed by row K1b. |

## Risk tier per surface

| Surface | Risk and proof before landing |
|---|---|
| Journal admission, claims, settlement (K1a-K1c, K3) | High. Replay fixture from the named failure; non-author review. |
| Journal storage size (K2) | High, data-loss path. Census of step-file readers first; bytes before and after. |
| Script transactions and rollback (N1a, N1b) | High. Rollback spike rows; workshared case driven before release. |
| Freshness line (N2) | Medium. Controlled-session drive with a hand undo. |

## Decision log

Standing owner rulings, verbatim:

- 2026-11-16, on temporary coexistence: "this needs to be tracked methodically so that by the end of the crusade its all gone."
- 2026-11-16: "sdk is at ~/source/repos/pe.revit.sdk. changes are allowed an encouraged." The SDK is in scope.
- 2026-11-16: "i dont want to handroll anything at all that we can avoid, which goes for our leases among many others too". A library primitive at the pin beats a hand-rolled owner, when it makes the hard part easy (see the 2026-11-17 ruling).
- 2026-11-16, Effect quality: "please make sure the relevant agents are loading and dogmatically abiding by the effect skill as well. code quality is paramount".
- 2026-11-17, the Workflow core after the spike: "no, youve convinced me B is not worth. principle needs to meet pragmatism, the current journal was hardened over hundreds of agent writer hours and if effect doesnt make the hard part easy then is just an aesthetic choice." The journal stays; ADR 0050 is rejected; TC-001 and the shared part of TC-002 close as permanent.
- 2026-11-17, delete the `humanOnly` call flag: "it gates pea at the wrong layer entirely and it serves no use to us anymore". The `requireHuman` guards stay.
- 2026-11-18, a script that throws rolls back: "100% yes, is that not what happens now. workshare rollback should b pretty easy". Row N1b. The workshared case is still unproven.
- 2026-11-18, delete the Resume and Recover controls: "100% yes, they always smelled to me". Row K1b.
- 2026-11-18, live Revit wins over any value Pe stored (fans decision D1): "100% yes, this is why we started unwinding local storage and browser in mem". It governs fans seam R, outside this map.
- 2026-11-18, Pea's first-output lag and token cost per turn: "they should handle pea lag, theyll know how to drive it better. on expensive turns i think them too." Both belong to the field root.
- 2026-11-18, "yes all": merge K1a to main (done, `d00b801f`), start K1b, add row K1c.
