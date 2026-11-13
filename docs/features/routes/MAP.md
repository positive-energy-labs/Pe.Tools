# Kernel crusade 2 map

Live frontier for [ADR 0042](../../adr/0042-handles-host-timeline-honest-answers.md), which amends [ADR 0028](../../adr/0028-seven-nouns-two-clients-one-catalog.md), [ADR 0034](../../adr/0034-timeline-per-work-places-on-host.md), [ADR 0035](../../adr/0035-route-slots-subjectref-one-notice-feed.md) and [ADR 0037](../../adr/0037-three-content-homes-one-write-door.md). Rebuilt 2026-11-12 from the first kernel crusade's map; git holds that map at 46aeca3a. Written from a read-only review of `crusade/homes` at e02163e0 by twelve sealed readers, then nine plan checks against the code. Nothing here is built. Delete this file when the last slice lands, and promote what survives into the [routes ledger](LEDGER.md). Terms are in the [glossary](GLOSSARY.md).

Evidence: `.artifacts/runs/mega-review-20261112/` (`signed.md`, the three packages all twelve readers signed; `digest.md`, every owed line from the review; `crusade/RULES.md`, the owner's rulings in their words; `crusade/plan/`, nine plan files with each plan row's exact file set; `crusade/SLICE-INDEX.md`, the 58 plan rows this map folds). Keep that run while this map exists. The Folds column below names the plan rows by their ids there.

Stamp for the whole plan: UNPROVEN[nothing is built; each slice names the lane that proves it]. Three limits on the evidence:

- The plans cite `path:line` at e02163e0 and a418c8e2. The base is main at 46aeca3a or later, so every line number is a locator to re-check, not a fact.
- The Findings and Storage plans were amended after their threads changed model late in the plan check. Their rows in slices 1, 8 and 9 are testimony until the implementor's plan check re-reads the code.
- Every hour below is a planner's writer-hours with no measured rate.

The goal, in the owner's words: "architecture first, where it serves Pea, imposes standards, cuts boilerplate, or adds reliability." Restated: this crusade changes the kernel's primitives so that a route declares less, Pea reads a smaller and truer world, and no stored byte is lost. It does the least to each route that keeps it compiling and working. kaitpw: "any overly specific product code that its related to the deep primitive stuff can be left out too".

## Nouns and invariants

- **Handle**: the one name a route uses for a read or a command. A command handle is a minted key; one generated table per key holds its effect, axes and plan key. A read handle holds its schemas, what it uses, and which collections are keyed.
- **Verb**: a command handle placed on a route, in the band or in one pane. A verb's plan decides whether it is reviewed. Its effect decides which door it goes through.
- **Effect**: `Read`, `TransactRead`, `SessionWrite`, `WorkWrite` or `ModelWrite`. Closed. An op does not declare its effect; the effect is the scope the runner hands it.
- **Touched**: what an operation changed, stated by the runner on the terminal receipt. An op cannot assert it.
- **Timeline**: the host's one ordered list of steps across the Works of a Place, with one read and one step door. A person and Pea use the same door.
- **Reading state**: `ready`, `refreshing`, `stale`, `reading`, `refused` or `not-yet-run`. The shell draws every value-less state. A route body sees only a present value.
- **Evidence**: what a native answer observed and how much of it: payload, observed, coverage. Missing evidence means unavailable.
- **Kind**: a declared class of stored file. A kind mints the file's path. A bare string is not a path.
- **Binding**: a domain plus a home. A **setting** is a home with the tiers `user`, `project` and `firm`. The static shape of the domain decides the decode.
- **Finding**: a statement plus a ruling, keyed by SubjectRef, in one Work per document. It has no `place`.
- **Subject namer**: the one function from a SubjectRef to the words a person reads. Stored data holds kind and subject, never a label string.
- Invariants:
  - Safety is structure and notices, never a pause. Nothing in this crusade adds an approval gate. kaitpw: "it must be through structure and notices, not approval gates that pause pea until the user notices them."
  - A file is set aside only after its bytes are preserved. A file that cannot be read is kept.
  - No migration code. Changed Work is set aside with its bytes kept and one notice.
  - ADR 0035 rule 1 stays closed: five slots, and no new route knob.
  - A non-test file in a route folder imports no other route folder.
  - The host imports no code from a Pod.
  - A positive spatial claim (clear, complete) needs a predicate that can make it. Without one the answer says unknown.

## Ordered deletable slices

Each slice is stated as what it deletes. "Lane" is the cheapest lane that can falsify it. "Folds" names the plan rows in `SLICE-INDEX.md`. Slice numbers are not strict landing order; the Wave column and the landing notes below hold the order. Writing is parallel from the first day.

| # | Slice | Settles | Deletes | Red falsifier, and the paths it observes | Lane | Folds | Wave |
|---|---|---|---|---|---|---|---|
| 0 | Journey baseline | what "no regression" means for every later slice | the one baseline expectation that contradicts the 2026-11-10 ownership ruling (Fans edits Ducts criteria, `pane-bodies.test.tsx`) | the full web, host, kit, runtime and agent-contracts suites and the e2e journey pack are recorded on the base tip (the homes ledger owes those suites past 7750811e); two known holes stay driver rows: F1 omits its reload, J6 never reads back the native ESP. Observes `ts/tests/e2e/` | deterministic suites; driver lane for the pack | PA-P0 | 0 |
| 1 | The store keeps bytes | a read error keeps the file; set-aside copies, verifies, then removes; a kind mints every stored path | the delete-on-read-error path and the delete after a failed copy in `ts/packages/host-contracts/src/store.ts`; the Work `upgrade` hook (`work-settings-upgrade.ts`, `preservePrior`); `StoredPolicy` and caller class arguments; bare state, pod, home and package paths | lock a Work file and read it: the file exists and one notice posted. Make the blob root unwritable and discard: the original stays. Plant a Work record at the previous `schemaVersion`: the blob holds its exact bytes and the route opens empty. A witness file with `@ts-expect-error` fails typecheck if a bare string or a home path reaches the state reader. A new guard goes red on an added `writeFileSync` in a zero-baseline host file. Observes `store.ts`, `route-workspace.ts`, `route-document-store.ts` | host and package tests | ST1, ST3, ST4a to d, ST5 | 0 to 2 |
| 2 | The host imports no Pod code | a Pod contributes data, never host JavaScript | the plugin import block and `hooksOnly` in `ts/apps/host/src/package-lifecycle.ts`; `plugin-receipts.ts`; `hook` and `emit` in the plugin runtime and the five emit sites with no listener; the pre-provider shim in `thread-store.ts` | a test Pod with `plugins/x/index.js` that writes a sentinel on import: the sentinel never appears and the Pod's package contribution still installs. The slice 1 guard names `harness/` (threads and providers) as a written exception with an end condition; removing the comment turns it red. Observes `package-lifecycle.ts` | host tests | ST2, ST8 | 0 |
| 3 | Effect is the scope | the runner hands an op its scope and states what it touched; a focused capture is a `SessionWrite`; a script's save hold knows whose script it is | `OpAttribute.Intent`, `RollsBack`, `UsesTransactions` and the positional `OpEffect` argument; "rolled back" and `RollsBack = true` on view-image; the throw that replaces a capture's result when its restore fails; the doc comment that every run scope is Pea's (`ScriptRunScope.cs`) | a mutant op with no scope commits a transaction: the call fails with `touched: unauthorized`. Each TransactRead op run once leaves no non-sandbox change event. Make "PE restore crop" fail: the answer names the view left cropped. A script with `Caller = Person` saves the open project: the file changes and `Held` is null; with `Caller = Agent` or omitted it is unchanged and `Held` is set (mutants "caller ignored" and "default flipped" both fail). A Pea script whose result carries `held` produces one `waits` row and a `succeeded` receipt with nothing pending. Observes `Op.cs`, `RevitViewImageExporter.cs`, `ScriptRunScope.cs`, `gateway-actions.ts`, `notice-feed.ts` | `pe-revit test`, controlled, rung from `--plan`; host tests | SI-S0, SI-S1, SI-S4, ST9 | 0 to 1 |
| 4 | Handles and verbs | one generated table of effect, axes and plan key; `verb()` with placement; one send door that picks its transport | `handAxes` and `route-axes.ts`; the cast in `command-axes.ts`; `command`, `sessionCommand`, `catalogAction`, `commandContract`, the `row` and `pane` flags; `queryAction`, `rpcAction` and their fabricated axes; `invoke` on a command; browser command schemas | change a native effect and regenerate: the browser table changes with no hand edit. Type tests: `ctx.verb("nope")` does not compile; a verb in neither the band nor a pane makes `route()` throw; a route file with a typo in a command entry fails `tsc`. A Pod bundle holds no command zod schema. `/ops` receipt control reads `SessionWrite` in the generated table. Drive `/schedules`: `push` is drawn once, plans, seals and applies; `/ops` cancel still cancels. Observes `command-axes.generated.ts`, `typed-route.ts`, `typed-actions.ts`, `typed-mount.ts` | TS package and web tests; dev session for the two drives | K1, K2, SH-S1, SH-S2, SH-S5, K6 | 0 to 1 |
| 5 | Reading states | the shell draws reading, refused and not-yet-run; a body sees a present value | the `failed` status; the value-less fallbacks in 23 body sites across 16 routes; `retainedValueLabel` call sites; "computing" in the sheet and goal panes | a fixture that refuses a route's core read: every pane shows the same refusal line and a body that throws on a missing value does not throw. Type test: inside `draw`, `ctx.value.value` is not `undefined`. Drive `/ducts` with pricing refused: the systems pane still lists systems. Observes `typed-shell.tsx`, `typed-mount.ts`, `route-kernel-bodies.ts` | web tests; dev session | SH-S6 | 0 |
| 6 | One read | one read declaration in `contract.ts`; the host owns a read's lifetime; `ctx.files`; keyed collections; clock and id as recorded leaves | `hostRead` and `valueRead` as two constructors; each per-route `reads.ts`; body-local identity and `runPods` plumbing; the direct field-options bridge path; duplicate cancel ownership; `firm()` and `settings()` on `ReadContext` | change a read's output schema in `contract.ts` only: the host body and the pane both fail `tsc`. A composition whose `uses` cannot join throws at host registration. The last consumer leaving signals only the read, never a submitted write. A recorded read that calls `ctx.files.tiers` replays with no disk. `findings.say` twice mints two ids from `ids.mint()`. Observes `reads/evaluator.ts`, `reads/door.ts`, `reads/inputs.ts`, `reads/history.ts`, `read-ownership.ts`, `native-recording.ts` | host tests; `pe-revit test` for Stop | PI-P2, K3, ST6, K4, F9 | 1 to 3 |
| 7 | Evidence | a native answer carries payload, observed, coverage and touched; Sweep claims clear only with a capable predicate; seeing ops answer with `lens` and `hidden` | `Fresh`; the lossy optional miss path; bare-id exclusions; unsupported CLEAR and infinity; `effect` as catalog-stamped testimony on a step; `LensClutter` as a private list | partial, unread, empty and failed evidence each survive cache reuse and generated decode. Kill the socket during a focused capture: the recovered terminal says `restored` or `restoreFailed` and one notice posts. A lens around a duct under linked framing lists `Links` in `hidden` with a count. An unfocused `view-image` runs through the read door with no transaction. Observes `dotnet/Pe.Revit.Space/`, `Evidence.cs`, `BridgeRequestEvidence.cs`, `action-journal.ts`, `RevitDataRequestService.cs` | `pe-revit test`, controlled; host tests | PI-P1, SI-S2, SI-S3 | 1 to 2 |
| 8 | Host Timeline | one host read and one step door; undo per author on every Work, stopping at a consumed Revit write; findings Work and a tier save are members | `ts/apps/web/src/shell/journal.ts` and `restore`, `history`, `revert`, per-cell `undo` in the mount; the nested History popup; `undoOwnFinding`, `ownFindingsLeft`, `findingMoves`; `ductsCellAccepts` and the `owner !== "ducts"` check | host tests: two Works, two undos then one redo through the door succeed; after a Revit write consumed an edit the door refuses the undo for Pea and for a person and names the receipt. Save a tier value, then undo through the door: the file's bytes equal the prior blob. An unknown setting owner is refused with 422. Drive `/fans` with a Ducts edit then a Fans edit: undo, undo, redo names the right Work each time. `createWorkJournal` has no importer under `ts/apps/web/src`. Observes `runtime/work-timeline.ts`, `route-workspace.ts`, `tiered-settings.ts`, `typed-mount.ts` | host and web tests; dev session | C1 to C4, F7, ST7 | 0 to 3 |
| 9 | Findings | a statement plus a ruling with doors `say`, `rule`, `retract`, `list`; the kernel draws notes and pointers once; one subject namer | `findings.write`, `place`, `editable`, caller-supplied ids, the "person" stamp for every non-Pea caller; `readFindings` and the mount's private load; per-route `FindingVerb` and `PointerCite` mounts; the raw-code namer; the false sentences in `contracts/rooms.ts` and `pe-api.ts` | Pea says a claim, a person rules it, and `findings.list` still shows `said.by: "pea"`; a note with a verdict fails to parse; a caller that is neither is refused. On `/families`, which has no picture, a person's note survives a reload with text, author and time. Pea points at a type and it lights within one stream frame with no poll. No file under `web/families/` or `web/fans/` imports `route/slots/findings`. Observes `host/slots/findings.ts`, `contracts/slots/findings.ts`, `notes.tsx`, `subject-name.ts`, `kit/attention.tsx` | host and web tests | F1 to F6, F8, F10 | 1 to 3 |
| 10 | Binding is domain plus home | every binding declares `domain` and `home`; a setting is a home; options come through the one read door | `"setting"` in `BINDING_KINDS`; `SettingCell`; `BindingDraw`'s value flags; `SheetChoice`; the 24 hand-written schemas; the orphan `slot-picker.tsx` | type test: a binding with no `domain` does not compile. `sheet.plan` with a staged value outside its domain is refused before any native call. A project-tier save on `/settings` sends `tier: "project"` and the read's hash; a second tab's stale hash draws the 409 on the cell. A stored option the read no longer offers draws standing as "not in the model now". Observes `contracts/slots/sheet.ts`, `slots-sheet.test.ts`, `tiers.test.ts` | TS package, host and web tests | B1, B2, B3 | 1 to 3 |
| 11 | The shell projects | stages become gates; keys, reference teaching and Pea's route read are projected from the declaration | `stages` and `stageOrder` emission; `ducts/proto/e/teaching.ts` and the `/ducts` pathname special case; the 19 generated graph JSON files under `packages/mcps/src/pea/generated/`; `bindGraphChords` | type test: `when("stage","nope",…)` does not compile. `/ducts` with no system: the tree pane is absent and its read is not requested. A chord on a pane verb fires with focus in that pane and not in a sibling. Projected ducts facts name `design`, never `e-inputs`. Pea's `pe_read route:fans` on a running host: the `losses` verb carries the sheet-apply input schema. Observes `typed-route.ts`, `shell/keys.ts`, `route/teaching.test.tsx`, the host response | web tests; dev session for `pe_read` | SH-S3, SH-S4, PA-P1, K5 | 1 to 3 |
| 12 | One band, chat as a route, Places on the host | the shell draws the one band; the dock head carries the docked route's controls; chat is an ordinary route folder; Places are stored on the host per device (ADR 0034 rule 4) | `ChatSituationHead`; `web/route/hosted-chrome.ts`; the dock's inline band row; chat's second page contract and its transport imports; the `pe.places` reader and writer in `web/workbench/tabs.ts` and `web/route/url.ts` | mounting two typed routes yields one `[data-slot="situation-band"]`. Drive `/fans` with Pea docked: two chrome layers on each side. Slice 13's guard, narrowed to `web/chat`, reports zero offenders. Two Places opened in one window are listed in a second window and after a host restart. `pe.places` has no match under `ts/apps/web/src`. Observes `typed-shell.tsx`, `route-panes.tsx`, `host/places.ts` | web tests; dev session | C5, C6, C7, C9 | 3 to 4 |
| 13 | Closed route folders | the rule holds by a guard | every `../ducts/` import under `fans/` and the two in reverse; the cross-route and shared-to-route production edges; dead `shell/use-work-scope.ts` | one repo guard goes red on a planted `fans -> ducts` import, a planted `navigation -> chat` import and a planted `callOp` in a body, and reads zero offenders on the tip. The slice 0 pack is green with only import paths changed in tests. Observes `ts/tests/repo-guards/`, `ts/apps/web/src/fans/`, `ducts/`, `ducts-ui/` | repo guards; the slice 0 pack | SH-S7a, PA-P3, SH-S7b | 0 to 3 |
| P | Bent-cut section editor | a cut is `sceneView.section` Page pose with one named commit at release | React `sectionDraft` and the replaced control branches | the plan's witnesses P3-D, P3-C and P3-B: no extra renderer, no recapture, no per-frame Page write, no camera snap. Observes `agent-contracts/src/scene-view.ts` and the scene controls | web tests; dev session | PI-P3 | parallel track |

### Timing plan

Replaced 2026-11-12 by the implementor's plan check: four readers re-read every row against the code at ee2d30fd (results in `.artifacts/runs/kernel2-20261112/plancheck/A.md` to `D.md`). The Wave column of the slice table is superseded by this section. Every writer starts as soon as its inputs exist; the order below holds only at landing. A batch is when a writer launches, not a gate. Hours are active writer-hours from the measured rates (about 400 added lines per writer-hour; a heady slice's median 1.6 active hours), and past plans ran 1.1 to 6 times over. Each writer's time box is twice its estimate. Shared contracts are in [CONTRACTS.md](CONTRACTS.md); a reader's writer letters there map to the branches below.

Slice 0 is a baseline, not a gate. The integrator's full suite on ee2d30fd, the driver's e2e pack and the purger's test fix (merged at b215fc69) make it.

Batch 1, at the plan's agreement:

| Branch | Rows | Slice | Tier | Lands after |
|---|---|---|---|---|
| k2/freeze-ts | handle.ts, `Publication` to `C/value.ts`, `ctx.files` (ST6), wire additions | 4, 6 | heady | nothing |
| k2/freeze-native | `Evidence.cs` lift, `Touched`, `ScriptCaller`, `read-ownership.ts` interfaces, the receipt response shape | 3, 7 | heady | nothing |
| k2/folders | SH-S7a deletions and moves (`open/bay.tsx`, `lifecycle.tsx`, `typed-owner.ts`), dead `use-work-scope.ts` and `route-environment.ts` | 13 | slog | nothing; first web landing |
| k2/store | ST1, ST3, ST4a | 1 | heady | nothing |
| k2/pods | ST2, ST8's written exception (the pre-provider shim stays) | 2 | slog | nothing |
| k2/timeline-host | C1 (types first, frozen), C2 with the `web/route/host.ts:59` patch, the findings Work as a member | 8 | heady | nothing |
| k2/shell-states | commit 0 (split the band head and layout view in `typed-shell.tsx`), then SH-S6 | 5 | heady | k2/folders |
| k2/findings | F1 with the clock and id leaves (F9 folded), F2 | 9 | heady | k2/shell-states on `typed-mount.ts` |
| k2/script-hold | ST9 | 3 | slog | k2/freeze-native |
| k2/native-scope | SI-S0 reduced, SI-S1, SI-S2's C# half, SI-S4 | 3, 7 | heady | k2/freeze-native |
| k2/evidence-native | PI-P1 native | 7 | slog | k2/freeze-native |
| k2/generated-table | K1 (with `pe-api.ts`), K6 | 4 | slog | k2/freeze-ts |
| k2/chat-route | C7 | 12 | slog | k2/folders |
| k2/bent-cut | PI-P3 | P | slog | nothing |

Batch 2, when the freeze commits land:

| Branch | Rows | Slice | Tier | Lands after |
|---|---|---|---|---|
| k2/verbs | SH-S2 with K2, then SH-S5 | 4 | heady | k2/generated-table, k2/shell-states, k2/findings |
| k2/read-contract | K3's contract and host half | 6 | heady | k2/freeze-ts |
| k2/bindings | B1, B2, ST7's owner-registry half | 10 | slog | k2/freeze-ts; B2 after k2/shell-states on `sheet/pane.tsx` |
| k2/projection | SH-S1, then SH-S3 | 11 | slog | k2/freeze-ts |
| k2/read-lifetime | PI-P2's helper, `native-output.ts` policy, field-options | 6 | slog | k2/script-hold on `gateway-actions.ts` |
| k2/evidence-ts | SI-S2's TS half, `native-receipts.ts` included | 7 | slog | k2/script-hold on `notice-feed.ts` |
| k2/places-host | C9's host half | 12 | slog | k2/store's kinds |

Batch 3, as each input lands:

| Branch | Rows | Slice | Tier | Lands after |
|---|---|---|---|---|
| k2/journal-delete | C3 with F7, then C4; the browser journal owners the purger found (`application-work-registry.ts`, `work-scope-acceptance.ts`, `work-writes.ts`, `situation-band.tsx`) | 8 | slog | k2/timeline-host, k2/shell-states |
| k2/tier-row | ST7a, the home-write row | 8 | slog | k2/timeline-host |
| k2/store-sweeps | ST4b, ST4c, ST4d | 1 | slog | k2/store |
| k2/lens | SI-S3 | 7 | slog | k2/native-scope, k2/read-lifetime |
| k2/evidence-decode | PI-P1's TS decode | 7 | slog | k2/evidence-native |
| k2/read-sweep | K3's sweep of 15 `route.ts`, PI-P2's consumer edits, `bindGraphChords` deletion | 6 | slog | k2/verbs, k2/read-contract |
| k2/projection-pea | PA-P1 without chat, K5's host half | 11 | slog | k2/projection |
| k2/findings-rest | F3 (its kit edit is in this file set), F4, F5 reduced, F8, F10 | 9 | slog | k2/findings, k2/verbs |
| k2/verbs-follow | SH-S4 reduced, P1, C5, C6 | 4, 11, 12 | heady | k2/verbs |
| k2/places-web | C9's web half | 12 | slog | k2/places-host |

The purger holds the guards as its assigned seams, because they are repo guards: ST5's write ratchet (after k2/store), the web import guard on `runtime/work-journal.ts` (after k2/journal-delete), and slice 13's route-closure guard (D1), landed early with the existing edges as a frozen list that ratchets down.

Estimate: k2/freeze-ts 1h
Estimate: k2/freeze-native 1h
Estimate: k2/folders 1h
Estimate: k2/store 4h
Estimate: k2/pods 1.5h
Estimate: k2/timeline-host 3h
Estimate: k2/shell-states 4h
Estimate: k2/findings 3h
Estimate: k2/script-hold 2.5h
Estimate: k2/native-scope 8h
Estimate: k2/evidence-native 7h
Estimate: k2/generated-table 2.5h
Estimate: k2/chat-route 2h
Estimate: k2/bent-cut 3h
Estimate: k2/verbs 4h
Estimate: k2/read-contract 3h
Estimate: k2/bindings 3h
Estimate: k2/projection 3h
Estimate: k2/read-lifetime 3h
Estimate: k2/evidence-ts 4h
Estimate: k2/places-host 1.5h
Estimate: k2/journal-delete 3h
Estimate: k2/tier-row 2h
Estimate: k2/store-sweeps 3h
Estimate: k2/lens 3h
Estimate: k2/evidence-decode 1.5h
Estimate: k2/read-sweep 2h
Estimate: k2/projection-pea 3h
Estimate: k2/findings-rest 4h
Estimate: k2/verbs-follow 4h
Estimate: k2/places-web 1.5h

Total: about 90 active writer-hours over 31 writers, against the planners' 425 to 463. The critical path is k2/folders, then k2/shell-states, then k2/verbs, then k2/verbs-follow and k2/read-sweep: about 13 active hours. The native chain (k2/freeze-native, k2/native-scope, k2/lens) is about 12. Revit's add-in lease admits one controlled session at a time, so native writers prove on deterministic tests where reader B says that holds, batch their fresh runs, and ask the driver for the lease.

Landing order on the two shell files (reader D measured it): k2/shell-states's commit 0, then SH-S6, then k2/findings, then three lanes in any order against each other: verbs (k2/verbs, then k2/verbs-follow and k2/findings-rest), timeline (k2/journal-delete), and small (SH-S3 in k2/projection, B2 in k2/bindings). The forcing collisions: SH-S6 rewrites the snapshot shape read at 33 lines of the mount; `typed-mount.ts:456` reads `FINDINGS_DOORS.write` inside the block SH-S2 rewrites; `placement()` and `verb()` exist only after SH-S2; C3 before C4 and F7 at `typed-mount.ts:641` and `typed-shell.tsx:151`; C5 before C6 at `typed-shell.tsx:156`.

Other landing orders: ST9 before PI-P2 on `gateway-actions.ts:376-387` and before SI-S2 on `notice-feed.ts`; SI-S1 before SI-S3 on `RevitDataRequestService.cs`; SI-S1 before K1's regeneration of `host-typegen.ts`; PI-P2's `native-output.ts` edit before SI-S3; SH-S7a's moves before SH-S6 and SH-S2 edit those files. Generated outputs: the landing that changes a generator's source regenerates its output.

### Plan check corrections, 2026-11-12

The implementor took these defaults from the four readers and the purger's first scour. Each is re-openable.

- Cut: K4's `history.compare` door and extractor (no reader in this crusade; `keyedBy` stays, written in K3). SH-S4's key-scope capability and `chord` on the wire (`bindGraphChords`'s deletion stays). B3's six duct slot names (product code; B1's `options` arm stays). `contract()` for K3's 13 host-only recipes. PA-P1's chat projection (C7 rewrites chat). ST1's C# rename. ST5's separate census (the guard's first run is the baseline). C4 only if k2/journal-delete has no room. SI-S3's enum members with no falsifier (`Annotations`, `Rows`, `TemplateLocked`, `FilteredBySheet`, `LensUse`). The `pea/index.ts` split of `document` from `target`. The margin coercion deletion (no row owns its wire default). The three-doc spatial rewrite, reduced to the false sentences. F6 picture inks. F5's `pointers.keep` op and person-facing list. The explicit-read demand state, S6's evidence fields and F3's `data-noted` mark.
- Kept against a reader's cut: PI-P1's qualified exclusions (witness P1-C), because slice 7 deletes bare-id exclusions on purpose. The bent-cut editor, at the lowest priority, because the owner ticked it and it shares no file. Places (C9), the first to drop if the run is long.
- Kept against the map: the pre-provider shim at `thread-store.ts:95-96`, because deleting it hides a person's chat with only a log line. ST8 writes the exception at the site.
- Moved: ST7's owner-registry half to slice 10. F7 into C3's writer. F9 into F1. SH-S3 beside SH-S1. K3 split into its contract and host half, and its route-file sweep. One writer takes both C# halves of SI-S1 and SI-S2 (`Op.cs:101-139`, `BridgeAgent.cs`). `RollsBack = true` leaves with SI-S1's capture split, because `Op.cs:514` refuses a TransactRead without it.
- Assumption B holds: the read-lifetime helper lands in k2/read-lifetime before both consumers. Assumption C is half false: `touched` rides in the response file `BridgeAgent.cs` writes, so `pe-revit op result` carries it with no SDK change; only a typed field on the SDK receipt stays an Owed line. Assumption A holds: spike A (fresh Revit 2025, spike/kernel2-a 55cfb68c) saw a crop or scope-box commit list the view itself, the sheet-filter flip list its ViewSchedule, a FailuresProcessing handler force "PE restore crop" to roll back with no failures (the injection seam for slice 3's restore falsifier), `Document.Equals` tell family.loadTest's scratch document apart while `ReferenceEquals` never does, and ProjectInformation.UniqueId collide across two documents from one template (never a document key). A views-only classifier of a capture's changed ids is falsified: the crop commit also modifies non-view auxiliary elements (49831, 1235368).
- The browser journal has three owners, not one file: the purger found `createWorkJournal` in `application-work-registry.ts` and the `acquireWorkJournal` map in `shell/journal.ts`. `runtime/work-journal.ts` stays as the host engine; slice 8 deletes every web importer.
- File sets grew where readers found them short: K1 gains `pe-api.ts`; SI-S2 gains `native-receipts.ts`; SI-S3's callers gain `captures-route.ts`, `captures/list.tsx`, `ops/renderers.ts`, `rooms/rooms-plan.ts`, `takeoff/plan.ts`, `HostProtocolContracts.cs` and the recorded fixtures; SH-S6 gains `rooms/plan.tsx`, `typed-route.ts:367`, `route-environment.ts` and `route-kernel-environment.ts`; F1 gains `typed-mount.ts:456`, `graph-history.tsx:35`, `ducts/sheet/types.ts`, `findings/verb.tsx`; C3 gains `input-history.neutral.test.ts` and `fans/native.test-support.ts`; C9 gains three tests that seed `pe.places`. Each writer's brief carries its reader's file set.
- The purger's first scour (P2 to P20, checked against the code at ee2d30fd; full list in `.artifacts/runs/kernel2-20261112/` and the purger's thread) lands in these file sets:
  - k2/store: preservation is carried by the kind, never by a caller's optional `blobRoot` (`store.ts:51,188`; ten discard sites pass none), and the falsifier plants a kind with no blob root. A person's clear (`route-document-store.ts:46`) is a set-aside with bytes kept, so slice 8 can undo it. One path table mints machine-state paths: `host-contracts/src/service-identity.ts`; `host/src/product-paths.ts` stops minting its own. `work-upgrade.test.ts` and `ducts-analysis.test.ts:250` are this slice's intended reds, rewritten or deleted in its file set.
  - k2/read-contract: one firm-settings reader, `tiered-settings.ts`; the raw reader in `ducts-files.ts:39,48` goes.
  - k2/script-hold: the hold is caller-blind at construction (`ScriptRunScope.cs:29,35`, `RevitScriptExecutionService.cs:72`), so the caller is carried through execution, not only named in a comment.
  - k2/native-scope: `host/src/input-context.ts:47-49` (it reads `intent` and `rollsBack`); the sheet-filter flip in `RevitViewImageExporter.cs:158-166` is classified like the crop, a `SessionWrite` with a restore outcome; the dead `HostOperationContracts.cs:111,130` factories.
  - k2/freeze-native: `Evidence.cs` is a new file (evidence lives in `Space/Types.cs:219` and `Scene.cs:106` today); the bridge terminal's `restored` and `restoreFailed` field in `BridgeContracts.cs:145` is part of the receipt response shape.
  - k2/evidence-native: `Fresh`'s consumers outside Space (`Pe.Revit.Partition/Verbs.cs:269`, `Pe.Revit.Takeoff/RegionMeasurements.cs:69`); dead `Partition.cs:123` `CaptureScene`.
  - k2/generated-table: the inline hand-axes `sheetContract` at `route/typed-route.ts:22-30`.
  - k2/projection-pea: extract `DUCTS_LAYER_OPTIONS` before `ducts/proto/e/teaching.ts` is deleted.
  - k2/findings-rest: slice 9's falsifier also covers `ducts/proto/e/screen.tsx:251` and `ducts/sheet/view.tsx:86`; F10's one namer replaces the family and type rule in `ducts/claims.tsx:15` and `ducts-domain/src/loss-breakdown.ts:27`.
  - k2/journal-delete: dead `shell/work-scope-acceptance.ts`.
  - The purger's guards: the write ratchet counts every fs mutator spelling (37 files, 108 calls in CENSUS.md), not `writeFileSync` alone; the route-closure guard's frozen list holds every production route-to-route edge the scour found, `open/`, `sessions/`, `settings/` and `__root.tsx` included.
  - `route/slots/sheet/pane.tsx` joins the landing-order list: it is touched by k2/verbs, k2/tier-row, k2/findings-rest, k2/bindings and the route-closure guard, in that order after k2/shell-states.
  - The map's counts that no list backs ("23 body sites", "24 hand-written schemas") are not acceptance counts; each slice's compile break is its census.

### Assumptions that no run has checked

| # | Assumption | Spike | Fallback if it fails |
|---|---|---|---|
| A | Revit's change event for a crop commit lists the view, so the runner can tell a held restore from a failed one without a third effect | inside slice 3, on the fresh rung | the owner reopens a `Restored` effect; nothing else in the map depends on its absence |
| B | The read-lifetime helper can land before both of its consumers | the implementor's plan check of slice 6 | slice 6 lands as one piece, and slices 7 and 9's leaves wait on it |
| C | `touched` can reach `pe-revit op result` | none here: the SDK's `OpReceipt` is outside this checkout | `touched` is on the host receipt only, and one Owed line goes to the SDK |
| D | 58 plan rows fold into 14 slices without hiding a collision | the implementor's plan check lists each slice's file set | the implementor splits a slice and logs it here |

### Deliberately unbuilt

- Fans numbers: the one table, the total as a claim, `ENCOUNTERS`, and the group engine's deletion. A later, smaller crusade; the ducts ledger holds its signed package and its three open rulings.
- The ducts tutorial and its 60 cases. `ducts/proto/e`. The seven view prototypes. Scene presets as named lenses. Fans declaring a setting of its own. A verb that binds a project or firm home.
- A containment-capable clearance solver. Slice 7 says unknown where none exists.
- The `CloudProvider` contract and stub (ADR 0031 rule 9).
- Threads and providers under the store's rules. Slice 2 writes the exception at the site, with its end condition.
- A recorded clock and id for the host files outside findings. Slice 6 converts findings only.
- Decoding a staged value on the host for the `/fans` and `/ducts` losses executors. Slice 10 guards the door.
- A script's `Close(false)` on a modified project, and the other save doors the homes ledger lists as untested. Whether `DocumentClosing` can cancel is unproven.
- Merging the resource-stream `Reading<T>` with the route reading state.
- A lint against raw transactions outside ops.

## Deletion criteria

- A slice merges into the integration branch when its writer's typecheck and touched tests pass. Its falsifier is a driver row stamped on a merged tip, and the end gate reads it. A slice is done when every item in its Deletes column is gone or was cut in the plan check above.
- A guard is admitted only when a named mutant or a planted offender turns it red.
- No slice writes migration code or a compatibility shim. A compile break is the census.
- No slice adds a prompt, an approval window or a wait on the person.
- A kit change is made inside the file set of the slice that needs it, as F3 does; no other thread patches the kit.
- The crusade ends when slice 13's guard and slice 1's write ratchet hold, the browser journal engine and the hand-typed axes are gone, and every proof row is stamped on the final tip or ruled Owed by the owner.

## Risk tier per surface

| Surface | Tier | Why |
|---|---|---|
| The store (slice 1), tier saves as Timeline rows (slice 8) | integrity | a wrong set-aside or undo loses a person's bytes |
| Timeline undo (slice 8) | integrity | undo must stop at a consumed Revit write, for both authors |
| Effect scopes, the script hold, Stop (slices 3, 6) | integrity | they decide what may change a project document and who is held |
| Pod code admission (slice 2) | integrity | host code run from a content home |
| Evidence (slice 7) | contract | a machine claim an engineer acts on |
| Handles, verbs, reads, bindings (slices 4, 6, 10) | contract | generated keys and schemas cross every boundary and reach Pods |
| Findings (slice 9) | contract | authorship and rulings on shared Work |
| Reading states, projection, the band, closed folders (slices 5, 11, 12, 13) | presentation | drawing and import structure; no data path |
| Bent-cut editor (P) | presentation | Page pose only; no Work binding |

## Decision log

- 2026-11-12, kaitpw: "I want to scope all of your 'crusades' into a single huge one, possibly with some of fan's stuff scoped in as well." And: "I will do the fans crusade later as a separate smaller one once the kernel is complete and can serve as a stronger base."
- 2026-11-12, kaitpw, on the review page: the host owns the Timeline ("A · Host owns it"); the Work `upgrade` hook is deleted ("A · Delete it"); settings tiers are user, project, firm ("model is the same as project in principle."). The setting as a home was deferred ("im not sure i understand, I defer to u") and taken as the default all six route readers signed.
- 2026-11-12, kaitpw, scope correction: "the ducts tutorial can probably wait for fans crusade, sorry for the confusing answer. any overly specific product code that its related to the deep primitive stuff can be left out too".
- 2026-11-12, kaitpw: "no restored i agree with if u do too". Sight and Picture had answered that a focused capture is a `SessionWrite` and the restore outcome is a value of `touched`, at the cost of splitting the capture op in two. Assumption A is its falsifier.
- 2026-11-12, kaitpw, on the script save hold: "i agree on as long as it doesn't cause approval friction. this is often a ux 'feature' that regresses. safety should be built it, but it must be through structure and notices, not approval gates that pause pea until the user notices them." Taken as an invariant of the whole map.
- 2026-11-12, kaitpw: "i agree with basically all your recommendations". That is: delete the Pod plugin import; move Places to the host in this crusade, late; undo answers per author on every Work; a finding loses `place`; the `CloudProvider` seam is out.
- 2026-11-12, on `place`: ADR 0035 rule 9 gave a finding a `place` for symmetry with a pointer's `target: SubjectRef | Place`. The keep verb writes `{}` into it and nothing reads it. It returns with a reader when a finding about an empty spot is needed.
- 2026-11-12, kaitpw: "crusade is literally merging to main like right now so we'll b cutting from main." Homes closed on main at 26189fe5.
- 2026-11-12, kaitpw: "take the defaults". Five points the plans left open: slice 8 owns the edit that registers the settings source with the Timeline; an unknown setting owner stays a 422 refusal, as `tiered-settings.ts` does today; a subject is stored as kind and subject and named by the one namer, and the teaching walk reads that namer; the read-context rename needs no adapter patch; the ADR 0038 guards exist (`ts/apps/host/src/guards.ts`, `ScriptRunScope.cs`), and slice 3 builds on them.
- 2026-11-12, kaitpw, on this map's shape: "i wont nitpick this stuff, I dont think it matters much, please make all the stuff according to the docs skill." The 58 plan rows were folded into 14 slices and one parallel track by the mediator. The fold is re-openable by the implementor (assumption D).
- 2026-11-12, kaitpw, on the implementor's plan check: "I'd walked away for a while. Anything that needs me? also btw, going forward I wont be around for most of the time that your running so when Im away just capture what needs me in a queue. I trust your defaults tho". Taken as agreement of the plan at f38543da with every default in "Plan check corrections"; owner items go to the run's OWNER-QUEUE.md and the run never waits on them.
- 2026-11-12, kaitpw, clarifying: "I wasn't saying 'I trust your defaults' in reference to something you said that I read. I moreso meant 'i trust your judgement'. what were the defaults you accepted? no need to stop the runs unless I object to any of them". So the plan stands on the implementor's judgment, reviewed by the owner after launch; any default the owner objects to is reopened then.
- 2026-11-12, kaitpw, on the owner queue: Fable children: "you will be the primary fable user, and purger maybe sometimes. i think neither driver nor integrator should use fable". Second implementor: "I leave the decision ... up to you. I agree that a second one might cause undue merge friction"; taken as none. The route-closure ratchet: "untangle is really more fans crusade material anyways. yes to ratchet too, dont let it rise meaningfully". A person's clear: "whatever is occam. I said delete because i want absolutely no legacy support or migration stuff. here, but also as a general principle. set aside is fine with me, i dont think i care about it being undo-able tho, especially since pea can perform edge case fixes since its a coding agent". So a clear goes through the one discard door (set aside, bytes kept) and the Timeline owes no undo of a clear.
