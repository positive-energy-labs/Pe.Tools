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

Writer-hours as the nine plans stated them, with no measured rate. The implementor replaces this table after its own plan check.

| Slice | Hours | Lands after |
|---|---|---|
| 0 | 2 to 3 | nothing; gates landing and proof, never writing |
| 1 | 22 | nothing for the loss fix; the kinds after it |
| 2 | 4 | nothing |
| 3 | 32 | nothing for the capture fix and the script hold |
| 4 | 38 | slice 9's record and Work Reading (F1, F2) before `verb()` on the shared shell files |
| 5 | 12 | nothing |
| 6 | 61 to 73 | slice 4's `handle.ts`; the read-lifetime helper (PI-P2) lands before the read contract (K3) |
| 7 | 52 to 64 | slice 3; the read-lifetime helper |
| 8 | 44 | slice 9's Work Reading before the browser journal is deleted |
| 9 | 35 | slice 4's `WorkWrite` effect |
| 10 | 22 | slice 4's `handle.ts`; slice 8 on the shared shell files |
| 11 | 31 to 34 | slice 4 |
| 12 | 36 | slices 5 and 8; Places last, after slice 1's kinds |
| 13 | 19 to 22 | slices 9, 10, 6 and 12; the guard lands last |
| P | 15 to 22 | nothing |

Total: 425 to 463. The critical path is slice 4's generated table, then `verb()`, then slice 6's read contract. Slice 8's contract, host door and journal deletion are the second chain.

Landing order on shared files. Each line is a collision the plans found; a writer who touches the file reads its plan row first.

- `web/shell/typed-mount.ts` and `typed-shell.tsx`: slice 5, then slice 9's Work Reading, then slice 4's `verb()` and helper deletion, then slice 11's gates, then slice 8's journal deletion, then slice 9's notes surface, then slice 11's teaching and keys, then slice 12's band.
- `RevitDataRequestService.cs`: slice 3's two parts, then slice 7's `lens` and `hidden`.
- `action-journal.ts`: slice 7 is its one writer; other slices land their lines first or hand them over.
- `SpaceOps.cs`, `SpaceSceneOps.cs`, `native-output.ts`, `gateway-actions.ts`, `call-route.ts`: the Picture rows of slices 6 and 7 are the one writer; slice 3's script-hold line lands first.
- Generated outputs: one landing per wave regenerates them.

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

- A slice lands only when its falsifier is green at the landed SHA and every item in its Deletes column is gone.
- A guard is admitted only when a named mutant or a planted offender turns it red.
- No slice writes migration code or a compatibility shim. A compile break is the census.
- No slice adds a prompt, an approval window or a wait on the person.
- A slice that needs a kit change sends a red `kernel gap:` test to the kit owner, never a local patch.
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
