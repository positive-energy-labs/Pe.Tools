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

1. The first-fix table above.
2. Plan, rehearse, apply (ADR 0030 rules 4 to 7): the linker and `OpCallGate` change; the one write button (`ts/packages/kit/src/components/lang/preview-action.tsx` is the seed) adopted by /ducts and /fans; the Timeline as a projection with invocation starts and consent windows.
3. StateCell as the one drawing in production (`ts/packages/kit/src/components/lang/cell.tsx`); Pea stages, the suggestion lane is deleted; batch and in-place review over the same cells; Pointers as a shell list.
4. Work identity (ADR 0030 rule 9): one handle per stored Work, every read returns it; foreign cells edited in place with the "from /owner" label; retired-into-model as a resolver layer. A census of the write ops with stable-keyed inputs gives the first route-free write set (ADR 0030 rule 2).
5. Catalog export and the DAG linker, then Pea projection (ADR 0028); subject, selection and directory; Pod registration so Pod routes mount like builtins; one reading engine; the value resolver.
6. Purge and fold (2026-11-02 list, where not yet done): the two reading engines, `prototypes/` behind manifest-declared variants, the hand rows and `z.custom` decodes in `capabilities.ts`, the hand dispatch in `capability-tools.ts`.
7. Recording (ADR 0031 step order): services first, then the recording source behind a Lane union, then epochs and the History rail, then keyed diff, then recompute, then cloud.
8. The Manual D Load Driver proves each route in the browser on its controlled Chadds copy. Driver green, with no objection from kaitpw, gates a fast-forward merge to main. A driveable step starts the next step while that merge waits; from step 6 the Driver includes chaos runs.

Kit has one owner thread per wave; route threads add red `kernel gap:` tests, never local kit patches. Merge main daily.

## Phase 1a checkpoint (2026-11-02)

- Ducts loss, heal and fan commands accept only a Work handle with `expectedRevision`. The host derives requests, returns an inspectable seal, checks the seal on apply, and keeps ActionJournal retirement conditional on captured cells and native receipts. Domain refusals keep the journal wire state `failed` with `notDispatched` and `refusal`; the typed Timeline outcome enum is a later cutover.
- Sheet reads no longer apply edits or proposals. Data Tables Open is an explicit Work verb. Schedule binding is an explicit ActionJournal command. Pod inventory reads no longer reconcile setup or cleanup.
- Owed: migrate the remaining family, schedule, data-table and takeoff ModelWrite contracts to Work-only inputs and plan seals; replace legacy caller-payload forwarding tests. Browser and Revit behavior of the seal remain UNPROVEN (ledger Owed `s3-native-seal`).

## Open questions for kaitpw

- Remaining split details after the archive ruling: /open (session administration), /pods (Pod administration), /schedules (definition authoring).
- The default home of a cross-document correspondence: a Pod member or a local Work member (ADR 0031).
- An explicit "accept baseline" verb for compare, or none (ADR 0031).
- First-Pod authoring preference (a recipe or a text editor) is deferred; it does not change the shape.
