# Unification wave 2: map

Live frontier for wave 2 (ADR 0027, [ADR 0028](../../adr/0028-seven-nouns-two-clients-one-catalog.md), [ADR 0030](../../adr/0030-pea-first-goal-core-plan-statecell.md), [ADR 0031](../../adr/0031-recording-at-host-input-services-history-in-the-shell.md)). Delete this file when the wave closes; promote what survives into the routes ledger. The nouns and rules live in the ADRs. This file holds only the frontier: the route census, the first-fix defects, the cutover order and the open questions. Every stake is a source read at bb447ddf unless stamped otherwise. Evidence: `.artifacts/tmp/unification-2/` (wave 2 reviews and census), `.artifacts/runs/kernel-muse-20261104/` (rep evidence), `.artifacts/runs/spook-20261104/` (hub argument), `.artifacts/runs/time-travel-20261104/` (census and precedent). Rebuilt 2026-11-04 after the kernel muse; git holds the 2026-11-02 shape tables.

## Route census (bb447ddf)

`ts/packages/agent-contracts/src/generated/route-directory.ts` held 25 route keys; the 2026-11-04 archive deleted 7 of them. `ts/packages/agent-contracts/src/admitted-builtin-keys.ts` names the 5 on the new kernel.

| Shell | Count | Routes |
|---|---|---|
| admitted (new kernel, `shell/admitted-*`) | 5 | captures, schedules, families, ducts, fans |
| legacy mount (`shell/mount-*`), ruled for archive and kept for an import boundary ([ledger 2026-11-04](LEDGER.md#decided)) | 3 | takeoffs, instances, session-admin |
| legacy mount, still to migrate | 10 | chat, design-system, duct-loss, family, index, ops, bind, pods, rooms, settings |

`takeoff` and `schedule-specs` are named in the archive ruling but are not directory keys. Witnesses with real use (ledger 2026-11-03): /ducts with /fans, /families, /schedules; /family and /rooms are candidates. The behavior of every other legacy route is not a spec; a migration may drop it and log the loss.

## First fix (data integrity before anything else, ADR 0027 rule 15)

Found by the hub (`.artifacts/runs/spook-20261104/ROUND2.md`) at 8c3d6158 and re-read at bb447ddf.

| # | Defect | Stake at bb447ddf | Fix |
|---|---|---|---|
| V3 | The host filters every admitted route out of Pea's Work tools, so Pea has no Work door on /ducts or /fans. | `ts/apps/host/src/app.ts:263` drops `admittedBuiltinKeys` from `registrations`; `ts/packages/mcps/src/pea/routes.ts:24-30` skips the same keys. | Project Pea's Work tools from the catalog for every route and delete both filters (ADR 0030 rule 1). |
| V2 | The MCP preview preflight demands the old `groups` scope and sends Pea to `route:ducts.analysis`, which the sheet guide forbids. The fan walk scope moved to fans Work at the split. | `ts/packages/mcps/src/shared/admission.ts:193-195`; `ts/packages/agent-contracts/src/ducts-sheet.ts:237`; the test pins the bug at `ts/packages/mcps/tests/admission.test.ts:387`. | The preflight reads the fans Work scope; rewrite the test. |
| V1 | `ducts.apply.preview` declares `TransactRead, RollsBack = true` and opens no transaction. The gate and the linker forced the false declaration. | `dotnet/Pe.Revit.Global/Services/Host/RevitDataRequestService.cs:117-121`; `dotnet/Pe.Shared.HostContracts/Operations/Op.cs:514`; `ts/packages/agent-contracts/src/catalog.ts:71,84-89` (`previewBy` must be TransactRead). | The linker binds a ModelWrite to a plan whose effect is Read or TransactRead; `ducts.apply.plan` becomes a Read; the seal binds to the plan (ADR 0030 rule 4). |
| X04 | /ducts and /fans lost browser attention at the admitted shell. | Historical exemption: `git show bb447ddf:ts/apps/web/src/fans/parity.test.ts`; current witness: `ts/apps/web/src/shell/admitted-attention.test.tsx` (delivered Pea intent and attention publication). | The admitted shell publishes attention for routes with an agent block (ADR 0030 rule 10). The test-name parity census is retired; the real Chrome witnesses own resume and join behavior. X04 holds for /ducts and /fans only; four routes publish none on purpose ([ledger 2026-10-22](LEDGER.md#decided)). |

## Migration parity rule (kaitpw, 2026-11-03)

A parity gap that is presentation only, with no data or write consequence, is dropped by default with one ledger line. Only integrity or write-path gaps escalate ([ledger line](LEDGER.md#decided)). The migration gate for a route is its Pea doors, its Work doors and its attention; a silent loss of one of those is an integrity gap. Price every legacy migration with a real-host drive: two routes cost U1 to U4, MOUNT-CUT and four fix units, and real drives still found nine defects.

## Cutover order (ADR 0027 rule 15)

Progress 2026-11-05: steps 0–5 landed on main at the Driver's exact GREEN SHA `0b63d5d8`; Step 6 then landed at exact GREEN `c03d720c`, including current main and T1 cb88e274. The fresh controlled ke277 drive proved write/data and full-reload apply History; prior chaos proof stands at 5728ab22. The two dependency engines and empty hook Page remain Owed to the legacy route cutover. Step 7 remains kernel-only and incomplete. Navigation memory growth, the Pea plan's Ducts-handle prompt and Work row status wording are carried presentation findings, not reopened merge gates.

1. The first-fix table above.
2. Plan, rehearse, apply (ADR 0030 rules 4 to 7): the linker and `OpCallGate` change; the one write button (`ts/packages/kit/src/components/lang/preview-action.tsx` is the seed) adopted by /ducts and /fans; the Timeline as a projection with invocation starts and consent windows.
3. StateCell as the one drawing in production (`ts/packages/kit/src/components/lang/cell.tsx`); Pea stages, the suggestion lane is deleted; batch and in-place review over the same cells; Pointers as a shell list.
4. Work identity (ADR 0030 rule 9): one handle per stored Work, every read returns it; foreign cells edited in place with the "from /owner" label; retired-into-model as a resolver layer. A census of the write ops with stable-keyed inputs gives the first route-free write set (ADR 0030 rule 2).
5. Catalog export and the DAG linker, then Pea projection (ADR 0028); subject, selection and directory; Pod registration so Pod routes mount like builtins; one reading engine; the value resolver.
6. Purge and fold (2026-11-02 list, where not yet done): the two reading engines, `prototypes/` behind manifest-declared variants, the hand rows and `z.custom` decodes in `capabilities.ts`, the hand dispatch in `capability-tools.ts`.
7. Recording (ADR 0031 step order): services first, then the recording source behind a Lane union, then epochs and the History rail, then keyed diff, then recompute, then cloud.
8. The Manual D Load Driver proves each route in the browser on its controlled Chadds copy. Driver green, with no objection from kaitpw, gates a fast-forward merge to main. Test-, support- or ledger-only fast-forwards skip the Driver gate if they touch no production file and carry a deterministic stamp at their SHA. A driveable step starts the next step while that merge waits; from step 6 the Driver includes chaos runs.

Kit has one owner thread per wave; route threads add red `kernel gap:` tests, never local kit patches. Merge main daily.

## Phase 1a checkpoint (2026-11-02)

- Ducts loss, heal and fan commands accept only a Work handle with `expectedRevision`. The host derives requests, returns an inspectable seal, checks the seal on apply, and keeps ActionJournal retirement conditional on captured cells and native receipts. Domain refusals keep the journal wire state `failed` with `notDispatched` and `refusal`; the typed Timeline outcome enum is a later cutover.
- Sheet reads no longer apply edits or proposals. Data Tables Open is an explicit Work verb. Schedule binding is an explicit ActionJournal command. Pod inventory reads no longer reconcile setup or cleanup.
- Owed: migrate the remaining family, schedule, data-table and takeoff ModelWrite contracts to Work-only inputs and plan seals; replace legacy caller-payload forwarding tests. Browser and Revit behavior of the seal remain UNPROVEN (ledger Owed `s3-native-seal`).

## Exemplar lane: /ducts and /fans (kaitpw, 2026-11-06)

kaitpw: "The map is not complete until both fans and ducts are the exemplars." The goal is that both routes use every kernel pattern and primitive, and that the kernel makes a bypass impossible to write. This lane runs in parallel with step 8. Everything in it is canon.

Exit condition:
1. No item in `.artifacts/runs/kernel-crusade-20261104/meta/BORROWED-BODIES.md` is open.
2. A route body imports only `ts/apps/web/src/shell/admitted-body.ts`. The narrowest rung that holds enforces this: stop exporting the reading hooks first, and add an import rule only if that refuses.
3. ADR 0032 is landed for the cells of both routes, including its storage amendment.
4. No prototype names remain: `proto/e`, `proto/b`, the `e-*` pane ids, `data-e-coverage`.
5. A fresh agent re-audits both routes against the kernel's duties, without seeing BORROWED-BODIES, and finds nothing new.
6. The Driver drives both routes GREEN on Chadds after the last landing.

| Step | Rule it enforces | Content | Depends on |
|---|---|---|---|
| E0 | names say what survives | Rename only, in one commit. | nothing |
| E1 | one status source (`shell/admitted-chrome.tsx:621`); transitions through the cell door (`shell/admitted-cells.ts:197`) | Bodies stop writing their own status text. Clear uses the kernel clear. Selections are arrays. Delete the old page shape at `fans/kernel.tsx:58`. | E0 |
| E2 | a body reaches the kernel only through the body contract | Close the door (exit 2). | E1 |
| E3 | every value Pea can touch is a StateCell, and the field owns its domain (ADR 0030, ADR 0032) | Change these into domain cells: ESP, the flow slots, the free-text slots, unit kinds, roles and fitting tables. One fill-count domain replaces three counters. "Stub reach" and "Equipment hop" become declared route-wide cells. Placement is derived, so the pane gear is deleted. | the kernel routes option reads through the recorded door (`ts/apps/host/src/resource-adapters.ts:327`, ADR 0031 rule 1) |
| E4 | document settings travel in the model through plan and apply (ADR 0032 storage amendment) | The owners of both routes persist their document tier. Takeoff and Partition move onto `ProjectInfoText`. The duct-loss entity gets its version. | E3 |
| E5 | an edit across owners is one kernel verb (ADR 0030 rule 9) | Delete the split at `ducts/sheet/mount.tsx:67-85`. | kernel design |
| E6 | proof is a drive | Run a Driver drive after each landing, then the fresh re-audit and the final drive. | E0–E5 |

Already landed on `settings/adr-0032`:
- ADR 0032 is accepted.
- The field-options throttle key includes the document (`dotnet/Pe.Revit.Global/Services/Host/RequestService.cs:42`).
- AutoTag no longer uses extensible storage.

Owed after E5:
- F25 in the reverse direction: setting fan inputs from /ducts without a route switch.
- F31 and F32 are kernel chrome.

## Open questions for kaitpw

- Remaining split details after the archive ruling: /open (session administration), /pods (Pod administration), /schedules (definition authoring).
- The default home of a cross-document correspondence: a Pod member or a local Work member (ADR 0031).
- An explicit "accept baseline" verb for compare, or none (ADR 0031).
- First-Pod authoring preference (a recipe or a text editor) is deferred; it does not change the shape.
