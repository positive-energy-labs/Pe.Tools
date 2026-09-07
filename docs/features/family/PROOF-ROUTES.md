# Family routes proof checkpoint

2026-09-06. Owner checkout `C:/Users/kaitp/source/repos/Pe.Tools-ff-routes`, branch `family/routes`, base `d2e19ce15ec9092018f1c37cfc529c97e8349cd3`. Initial-wave report, updated after the intermediate checkpoint. No subagents, Revit lifecycle operations, company settings writes, or other-worktree merges. MAP and LEDGER are untouched.

## Deep composition ruling and integrated proof handoff - 2026-09-07

- User settled recursive field merge: later Width.value retains earlier Width.dataType. `host/src/settings.ts::expandIncludes` now merges keyed object fields recursively, with later scalar/array leaves replacing earlier leaves. Existing array `$include` splicing and preset-before-include order are unchanged. No existing recursive JSON merge helper was found in the TS workspace; the small helper stays inside the existing settings resolver. Raw JSON, dependencies, cycle/whitelist failures and no inline overrides remain.
- Highest host surface checked: `openSettingsDocumentWithModule` composes two parameter fragments; Width retains `dataType: Length` and changes `value: 24in` to `42in`, with raw pointer JSON untouched. `deep-composition-test.txt`: 20 passed; `deep-composition-check.txt`: static/type/format exit 0. This supersedes the earlier shallow-merge description. C# keyed include parity still belongs to its owner.
- User ruled explicit units for measurable authored values (`480 V`, `0 K`); Number/Integer remain bare. Normalize owns validation in `406e7a8`; root owns conversion of the four frozen source fixtures. This tree does not change those fixture bytes or project units. Earlier numeric-Voltage browser evidence proves source fidelity only, not acceptance under the new unit rule.
- Read-only review of `406e7a8` confirms `sharedSpecId`, `sharedVisible`, `sharedUserModifiable` alongside sharedGuid, fillBlanksFromSources and mappingStrategy. FF transports still use opaque modelJson/patchJson, so route-state does not need a duplicate model schema. ParameterDefinitionDescriptor adds optional Visible/UserModifiable; regenerate `@pe/host-contracts` from the **integrated** C# tree using its existing offline codegen before root proof. Generating from this older checkout would not certify those fields. Provider schema must likewise come from integrated C# authority.
- Root reports `2479c93` contains the earlier routes/composition and current-family dispatch slices, retaining normalize's expected-hash constructor and committed receipts. Its redundant bridge preplan/outer group were omitted because FamilyVisit owns atomicity. Root must complete source-definition resolution integration before native shared-parameter route acceptance. No other tree was merged here.
- Next concrete targeting blockers: `/family` store.bind returns a success string without navigation; `/families` bindDocument is a no-op. Both route owners are keyed only by document, so a session-only change would retain the old store unless remounted by full scope. World picker ids are session ids, while bound state currently uses the complete RPC selector. These must be repaired together before claiming picker-to-target correctness.
- Acceptance handoff to proof owner: integrated host/payload identity and regenerated schema; explicit document+session scope; Pea opens/authors saved JSON via route:settings; route:family plan persists native hash; human Apply passes it once; native receipt plus recapture shows actual values and coverage. Stale-hash rejection, per-family rollback/batch continuation and no implicit saves need that same integrated payload. Browser fixture evidence cannot prove them. Screenshot retries stopped after the diagnosed capture timeout; visual proof remains open.

## Native fixture browser slice - 2026-09-07

**Partial proof, not route-plus-Revit acceptance.** The four native `/family` stories and native `/families` were rendered and interacted with in Chrome against this checkout's isolated no-Revit host. Screenshot capture is blocked: CUA `getScreenshot`, tab `screenshot`, and CDP `Page.captureScreenshot` timed out (5/10/30 seconds); no screenshot bytes were returned. DOM/interaction receipts are not screenshots or visual approval. A question about minimized/disconnected Chrome remains pending. No Revit operation or C# change occurred in this slice.

### Source wiring and native readouts

- `web/src/family/fixture.ts` directly imports the four unchanged `Pe.Revit.Tests/Fixtures/FamilyModel/{a-box,b-grd,c-bath-shower,d-bath-shower-refline}.family.json?raw` sources. The explicit route selectors are `box`, `grd`, `bath`, `refline`. No copied fixture payload or hidden fallback was added.
- `family/family-model.ts::buildSheet` now reads native `forms`, datum/reference-plane seeds and connector `on`/`at` intersections. `project.ts` feeds native form dimensions to the existing editor and emits `/forms/...` changes. Existing legacy solids/frames, editor controls and evaluator remain. The shared length reader accepts signed portable lengths and native feet/inch display values. Native geometry tests use the unchanged source fixtures.
- The existing SVG views render supported centered macro solids, reference-plane seeds and connectors; direction glyphs no longer claim an unauthored stub length. Native room-calculation points no longer receive the legacy guessed position. Arbitrary constrained placement, extrusion sketches, reference-line swing, nested bodies, arrays and Revit formula results are not solved in the browser. Declarations remain visible and raw JSON retains every field. The native pane explicitly names the Revit constraint/geometry boundary; parameter workflows remain available.
- `family/anatomy.tsx` exposes native datums/refPlanes/refLines/dimensions/nested/arrays declarations. `workspace-view.tsx` shows capture coverage and unmodeled facts when present, or explicitly `coverage not captured / unmodeled not captured` for authored examples. Raw/expanded/capture JSON readouts are bounded and scrollable. Capture-only anatomy uses the native captured model while authored document identity stays null.
- `families/fixture.ts` projects these same source models into four family/six type rows at `/families?source=fixture&fixture=native`. Native fixture rows start **unplanned**, with no fabricated backend hash or comparison result. Selected projection returns the exact source JSON; empty fixture coverage is labeled not captured. `matrix.tsx` navigates native fixture rows to their matching `/family` selector; real rows retain the existing editor-open/capture path. The original six-family fixture is preserved and linked separately.
- Native shared-parameter field names relayed by normalize are `sharedGuid`, `fillBlanksFromSources`, and `mappingStrategy`. Raw authored JSON preserves them; this slice adds no guessed transport or normalization semantics. Dedicated typed authoring of those fields and host/schema verification await the coordinated normalization merge.

### Browser receipts

Server: Herdr session `ffroutes0906`, our terminal `w1:p2`, workdir `source/pe-tools`, `vp run dev:no-revit`; service identity `host-source-b3720e7771c8-no-revit`, PID 37656, `http://127.0.0.1:5180`. It advertises no Revit capability. Own Chrome tab 342187142. Evidence below lives in `.artifacts/runs/browser-20260906-ff/`.

| Actual Chrome journey | Evidence and observation |
|---|---|
| Box | `box-before.ax.txt`, `box-body.ax.txt`, `box-edited.ax.txt`, `box-interaction.json`: body inspector; Wide Width 36in to 48in, Enter; front body SVG width/height ratio changed 1 to 4/3; unsaved edit visible. No file save. |
| Grille | `grd-arrays.ax.txt`, `grd-drill.ax.txt`, `grd-final.ax.txt`: flange/exhaust present, arrays/vanes-back declaration opened, Slot type selected; formula cells remain derived/locked. |
| Bath | `bath-interaction.ax.txt`: cold connector inspector and conn-z dimension opened; three connectors, six reference-plane and dimension declarations, three nested declarations. The 12.5in plane is an authored seed, not the solved half-inch labeled offset. |
| Hinge | `refline-interaction.ax.txt`: two connectors, two reference-line declarations; opened conn swing (left) showing authored length/angle references. No invented nested hinge geometry. |
| Native fleet | `fleet-native-projection.ax.txt`, `fleet-projection-source.json`: four families/six types; project selected Box; rendered pre text equals original source bytes, including numeric Voltage 480. Coverage says not captured. |
| Fleet row navigation | `fleet-to-refline.ax.txt`, `fleet-navigation.json`: click PE Bath-Shower (hinge) row, URL becomes `/family?source=fixture&fixture=refline`, heading family. |
| Preserved fleet | `fleet-original.ax.txt`, `fleet-original-projection.ax.txt`: existing six-family decision queue renders; selected projection remains functional. |

`browser-errors.json` is empty. Network evidence is **not all green**: `browser-network.json` and `browser-network-summary.json` contain shell `/host/install` and `/host/update` 404 responses, plus eight canceled fetches. These do not establish host/provider-schema acceptance. Screenshot capture failures remain unresolved and no `.png` proof exists.

### Validation and remaining proof

- Deterministic focused route/model/store checks: **97 passed / 9 files**, exit 0 (`native-targeted-tests.txt`). Includes all four native geometry source cases, exact native `/forms` reverse path, direct fleet fixture source equality and existing editor/store coverage.
- Wider family-prefix run: **127 passed, 2 failed / 14 files** (`native-family-tests.txt`). Both failures are unchanged `family-review/proto-editor/paint.test.tsx` render tests: `design token unavailable: line` from `lib/token.ts:9` via `StatePanel`. No prototype feature or test was removed. The restored original evaluator conformance tests pass in that wider run.
- Static/type/format checks: **0 errors, 3 existing warnings / 42 files**, exit 0 (`native-geometry-check.txt`): parameterText no-base-to-string, store/workspace-core unbound-method warnings. One redirected attempt produced PowerShell NativeCommandError from benign warning stderr; the final run records the actual native exit.
- Still owed: actual screenshots/visual inspection; host/schema verification with root's composition/scalar/normalization changes; C# keyed-include parity; shared-fragment per-field provenance/editing; current-family reviewed Apply plus native receipts/recapture; loaded-family navigation identity/scratch reuse; per-family rollback, batch continuation, no implicit save, and route-plus-Revit proof. Those runtime claims remain exclusively with the proof owner.

The historical checkpoints below are superseded by the newer slice sections for changed seams; they remain the original census record.

## Project-row navigation and native readouts ? 2026-09-07

- `web/src/families/matrix.tsx` passes the clicked row's family id to `store.actions.openFamily`. The existing `family.editor.open` operation remains the only editor-opening implementation; no new host operation was added. Its returned scratch `.rfa` path becomes the `/family` document scope, with the user's original session pin retained. A missing path refuses navigation. Fixture rows cannot open real Revit documents.
- `/family?doc=<returned Address>&target=<existing pin>&capture=true` waits for route hydration, then runs the existing native capture command. `family/lane.ts` can project native capture without an authored settings file, while keeping `lane.document` null so captured data is not a writable authored file or a fixture fallback.
- The family header exposes native coverage/unmodeled count plus capture JSON, and raw/expanded authored JSON. All four authored native fixture stories remain available. The view catches command failures after the shared verb machinery records them.
- PROVEN deterministic: 29 tests / 5 files passed (`navigation-test.txt`), including exact clicked id, returned document address and pin, capture-only projection, stores, and fixture routes. Static/type check: 0 errors, 2 existing unbound-method warnings / 11 files (`navigation-check.txt`). Runtime opening/activation/navigation/recapture is still UNPROVEN and belongs to the proof owner.
- Existing backend limitation: `RevitDataRequestService.OpenFamilyEditorCore` uses a scratch filename based on family name and may reuse an already-open scratch document. Cross-project same-name family identity and scratch reuse must be covered by runtime proof or repaired by its owner. This slice does not claim a loaded-family project commit when applying inside that scratch family document. No Revit document was opened during this work.

Commit `44e1d66` contains the preceding Apply/composition slice. The historical outstanding-navigation notes below are superseded by this section; geometry authoring, scoped cell/type apply, C# keyed composition parity, field-level provenance and fleet patch fixture stories remain outstanding.

## Current-family Apply slice ? 2026-09-07

This section supersedes the older checkpoint below where it names a seam now implemented. No Revit run or lifecycle action was performed.

- `FamilyFoundryBridgeOps.Plan/Apply` now take `RevitDocument`. `PlanFamilies` selects `OwnerFamily` in a family document, accepts only its stable element id, and retains project selection otherwise. `WithFamilyDocument` reads the existing family document directly. Apply calls the existing `OperationProcessor`, whose `IsFamilyDocument` dispatch remains the only processing engine.
- Apply compares a freshly computed plan before entering the processor (including its default-type setup). Current-family processing is enclosed in a transaction group: operation errors roll back the family, successful processing assimilates, and existing documents are not saved. This is compiled source behavior, not proven Revit atomicity. Loaded-family batch continuation remains the existing processor path and requires normalize integration.
- `agent-contracts/src/family.ts` adds native plan and apply state, reusing the fleet plan/receipt schemas. Pea can plan the saved composed JSON; Apply is human-only at route state. Code/script/Pod operations remain unrestricted. `mcps/src/pea/family-commands.ts` gates current-family use with the existing family capture operation, wraps the saved composed model as `{patch: model}`, stores the backend plan, checks unchanged composed input, consumes the review before mutation, passes the exact OwnerFamily hash, stores all receipts/diagnostics, and recaptures native evidence. No optimistic live-cell mutation occurs.
- `web/src/family/store.ts` and `workspace-view.tsx` expose plan current family, reviewable changes/refusals/hash, apply reviewed plan, and full receipts. Draft/staged edits must be saved first. Existing per-cell/per-type prototype Apply controls direct real users to this full saved-profile review; fixture simulation remains. Scoped cell/type patch application is still outstanding, explicitly not silently widened.
- `host/src/settings.ts::expandIncludes` now accepts keyed object substitution with `{"$include":"@local/_fragments/parameters"}` or an ordered list `{"$include":["@local/_fragments/base","@global/_fragments/company"]}`. Each fragment must be an object. Keys merge shallowly in order: a later fragment replaces the entire conflicting keyed value. Existing array/Items splicing, preset-before-include order, whole-object presets, whitelists, cycles, and no-inline-override rules remain. No parallel resolver was added. C# composition/schema acceptance of this keyed syntax is **not** implemented by this TS slice and must be aligned before desktop/host end-to-end acceptance.
- Raw JSON remains unchanged. Settings snapshots and Pea open summaries now retain dependency document ids. The expanded family view links to edit each shared source in the raw settings editor, retaining route scope. This is document-level provenance/navigation, not a per-field source map. Shared fragments are visible in the settings file picker. The shared field writer refuses edits beneath `$preset`/`$include`; opening another file refuses unresolved edits so they cannot migrate into a fragment. Per-field direct shared editing remains outstanding; no transparent local override is created.
- Restored `source/Pe.Revit.Tests/Fixtures/Profiles/family-model-evaluator.conformance.json` byte-for-byte from `af52765^`, preserving the still-used evaluator feature and its original oracle.

### Integration custody

Read-only inspection of `Pe.Tools-ff-normalize` confirmed its four-line plan change: construct `FamilySharedParameterSource(famDoc)`, resolve `desired.Value` with `patch.Patch`, and pass `source.GetDefinition`, `patch.Patch`, and `source.ResolvedDefinitions` to `FamilyReconciler.Reconcile`. Those lines are outside this slice's dispatch edits and must remain when root combines changes.

Root must also retain normalize's `new ReconcileFamily(patch, expectedPlanHash: expectedHash)` and its receipt handling after commit/load. This tree is still based on `d2e19ce`; its constructor lacks that argument, so this slice has a pre-processor plan check and retains the base's post-operation comparison. Do not replace normalize's constructor/receipt hunk with the older base hunk when resolving the combined bridge file. The new current-family transaction-group guard surrounds the existing processor call. No other worktree was merged or edited.

### Validation

| Lane | Result | Raw evidence |
|---|---|---|
| deterministic, web | 129 passed / 15 files, wider `src/family` plus fleet store and both routes; restored evaluator conformance passes | `apply-web-test.txt` |
| deterministic, host | 20 passed; keyed later-wins, scalar values, raw preservation, invalid shape/overrides and existing cycle/whitelist behavior | `apply-composition-test.txt` |
| deterministic, MCP commands | 6 passed / 2 files; native current-family apply hash/review consumption, receipt/recapture, inherited edit refusal | `apply-commands-test.txt` |
| static/type | 0 errors, 2 pre-existing unbound-method warnings / 13 edited TS files | `apply-check.txt` |
| compile/artifact | Uncached offline catalog/codegen succeeded, 67 operations; includes Pe.App compilation | `apply-codegen.txt` |

Evidence is under `.artifacts/runs/browser-20260906-ff/`. Remaining proof: integrated C# composition/schema (including native scalar fixtures), current-family plan/apply/recapture through Host and browser, stale-hash refusal before any writes, full family rollback, batch continuation, post-commit/load convergence, no implicit document save, and source-file authoring navigation. Root's independent SDK diagnostic is not route proof.

Project-to-family row navigation still drops the selected family and is the next separable route slice. Native geometry projections, coverage readouts, fleet authored patch fixture stories, and scoped cell/type Apply remain open as listed below. Full saved-profile current-family plan/apply now has a real transport path; runtime acceptance remains with the proof owner.

## Slice verdict

PROVEN deterministic: native authored parameters and route-state payloads now pass through `/family` and `/families` without obsolete transport fields. Build, plan, and apply select validated composed JSON. The existing resolver remains the only composition engine. Complete closure is OPEN: native geometry, current-family apply, inherited authoring decisions, and runtime proof remain outstanding.

Final checks on 2026-09-06, this branch's commit containing this report:

| Lane | Command from owning package | Result | Raw evidence |
|---|---|---|---|
| deterministic | Host `vp test tests/dispatch.test.ts` | 20 passed, exit 0 | `composition-test.txt` |
| deterministic | Web `vp test` over the seven `src/family` test files, families store, and two route tests | 96 passed in 10 files, exit 0 | `final-targeted-web-test.txt` |
| deterministic | MCP `vp test tests/family-commands.test.ts tests/route-state-commands.test.ts` | 4 passed, exit 0 | `final-commands-test.txt` |
| deterministic | Agent contracts `vp test src/families.test.ts` | 2 passed, exit 0 | `schema-test.txt` |
| compile/static | Workspace `vp check` over changed consumers and their owning family directories | 0 errors, 4 unbound-method warnings in 65 checked files, exit 0 | `final-check.txt` |
| artifact | Workspace `vp run --filter @pe/host-contracts codegen` | 67 operations regenerated, exit 0 | `typegen.txt` |

All evidence filenames above are under `.artifacts/runs/browser-20260906-ff/`. DOM tests are deterministic fixture linkage, not browser or Revit proof. The explicit native fixture route test mounts box, grille, bath/shower, and reference-line examples. Numeric and boolean authored values display through native scalar spelling; untouched raw numbers/booleans are not rewritten.

A broader `vp test src/family ...` also selected `src/family-model/preview.test.ts`: 127 passed and one failed because `source/Pe.Revit.Tests/Fixtures/Profiles/family-model-evaluator.conformance.json` is absent in the shared base. The legacy evaluator and its test remain intact. See `final-web-test.txt`; no claim of a green whole-workspace test run.

## Exact implementation references

- Shared composition: `source/pe-tools/apps/host/src/settings.ts:324`, `:357`, `:716`, `:798`. Failed composition returns no payload at `:399`; unsupported keyed includes report an error at `:867`.
- Shared execution selection: `source/pe-tools/packages/mcps/src/pea/settings-commands.ts:18`. Native build consumes it at `family-commands.ts:133`; native capture/build state is written at `:87` and `:141`.
- Native fleet transport: `source/pe-tools/packages/mcps/src/pea/families-commands.ts:31` sends `patchJson`; `:53` derives reviewed hashes from included, non-refused entries; `:79` sends the same composed patch with `expectedPlanHashes`. Receipts and diagnostics remain in route state and the command result.
- Native route-state schemas: `source/pe-tools/packages/agent-contracts/src/families.ts:18` and `:27`; native family capture plus separate build receipt: `source/pe-tools/packages/agent-contracts/src/family.ts:65` and `:92`. The legacy evidence alternative at `:56` remains for existing fixture/prototype state.
- Native load/parameter projection: `source/pe-tools/apps/web/src/family/lane.ts:18`, `family-model.ts:134`, `project.ts:131`, `project.ts:313`. Only complete parameter coverage permits a missing-parameter claim at `project.ts:328`. Formula outputs are never invented.
- Native parameter write paths: `source/pe-tools/apps/web/src/family/project.ts:493`. Existing legacy geometry and split-parameter view adapters remain at `family-model.ts:134` and `:137`; no native transport emits those old names.
- Explicit fixture files: `source/pe-tools/apps/web/src/family/fixture.ts:18`. `/family?source=fixture&fixture=box`, `grd`, `bath`, and `refline` use the checked-in native JSON files. Vite permits this one fixture directory in addition to its normal workspace root; no file copies or second fixture source were created.
- Interim Apply refusal: `source/pe-tools/apps/web/src/family/workspace-core.ts:319` and `:345`. This preserves measured values but is not the endpoint.

## Root relay, not local runtime proof

Root reports normalize commit `86cda03` integrated as `f576a5a`: expected hashes are checked before writes; convergence is reported only after commit/load; hashes include current state and run rules, requiring re-plan. Root also reports composed-only native semantic validation, existing typed desktop settings reads, and PortableValue schema support for string/number/boolean. DTO fields are unchanged. These fixes are not merged into this tree and are not independently executed here.

The local base still has the old post-`ProcessQueue` hash comparison in `source/Pe.App/Host/FamilyFoundryBridgeOps.cs`. The root's fixes must accompany this consumer slice before runtime acceptance. The no-implicit-save and per-family rollback/batch-continuation claims belong to the coordinated C# proof, not these TS checks.

## Composition census and changes

- `source/pe-tools/apps/host/src/settings.ts` owns `materializeDocument`, `composeForRead`, `expandPresets`, and `expandIncludes`. Schema validation already uses composed values. Semantic validation receives BOTH authored raw and composed JSON.
- `$preset` substitutes a whole object, including a native keyed parameter map. Inline overrides remain rejected. `$include` splices arrays or a fragment's `Items` array. It does not merge keyed maps. Includes at unsupported positions now produce `CompositionError`, rather than surviving silently into execution. No second composition engine was added.
- Includes now expand presets inside loaded fragments. Preset traversal is sequential so sibling references do not share an active cycle incorrectly. Composition errors use the Effect failure channel, preserving diagnostics rather than escaping as defects. A failed composition returns `composedContent: null`; raw authored JSON remains intact.
- `packages/mcps/src/pea/settings-commands.ts::executionContent` selects validated composed content and refuses missing/invalid composition. Family build and Families plan/apply explicitly request composition and use this shared selector.
- C# dependency: `source/Pe.Revit.FamilyFoundry/FamilyModelSettingsRegistration.cs::Validate` first parses `context.RawContent` with the strict native parser. Valid directives can therefore still fail semantic validation. C# owner must settle composed validation without erasing raw authoring diagnostics. Desktop file reads remain outside this TS slice.

## Native consumers and remaining adapters

| Consumer | Changed or in progress | Remaining dependency |
|---|---|---|
| `/family` settings loader | Reads composed JSON; projects native `parameters`, including numeric values and shared declarations; emits changed `/parameters/...` pointers; untouched draft emits no patches | Editing inside a substituted preset needs an explicit fragment-edit/materialize decision; raw files are preserved |
| `/family` empty/error state | No hidden fixture fallback; fixture source is explicit | Browser verification pending |
| `/family` capture command | Stores native `modelJson`, `coverage`, `unmodeledCount`, and Reading | Capture coverage governs missing claims; formula outputs are not invented |
| `/family` build command | Stores native convergence/residue build receipt separately from capture evidence | Runtime proof and atomicity contract relay pending |
| `/family` parameter projection | Native capture values feed existing matrix | Old evidence schema and old geometry/view vocabulary remain for existing fixture/prototype features; they are not native transport DTOs |
| `/family` local Apply | Non-fixture call refuses and preserves captured values | Real current-document patch/apply plus receipt/recapture still required; this refusal is not completion |
| `/families` settings picker/commands | Uses `FamilyFoundry/patches`, `patchJson`, per-family `expectedPlanHashes`, native changes/runEffects/refusals | Targeted deterministic and type checks pass |
| `/families` plan/receipt/project readouts | Reads changes, residue/errors, and families/modelJson instead of loweredActions, operationsRun, changed counts, and projections/profileJson | Preserve all diagnostics and refusal rows; browser proof pending |
| Pea route state | Family native capture/build schema added; Families native plan/receipt schema and hash-map apply input updated | Command-chain checks pass; root reports unchanged atomicity DTO fields |

Generated host contracts were regenerated from THIS checkout using offline `@pe/host-contracts codegen`: 67 operations. No transport DTO was guessed. Native operation authorities are `source/Pe.Shared.HostContracts/Operations/FamilyModelHostContracts.cs` and `FamilyFoundryHostContracts.cs`.

Native plan response currently has no Reading or aggregate plan hash. Route state retains optional Reading for existing fixture scenarios; real plan entries carry each family's backend hash. No synthetic backend hash or document version is created.

## Fixture stories

- Existing `/family?source=fixture` story remains.
- Native `/family?source=fixture&fixture=box|grd|bath|refline` directly to the four checked-in `Pe.Revit.Tests/Fixtures/FamilyModel/*.family.json` files is wired. These are authored examples, not runtime evidence.
- Existing `/families?source=fixture` scope, selection, exclusions, and projection story remains; its response objects now use native shape.
- Native geometry drawing remains incomplete. Parameter workflows must stay usable. Existing legacy geometry editors are preserved; native connectors without legacy frames are not placed at guessed coordinates.
- No company OneDrive content has been read or modified in this slice. No claim about current company settings or their validity.

## Validation at checkpoint

- PROVEN deterministic: `vp test tests/dispatch.test.ts` from `source/pe-tools/apps/host`, 20 passed. Includes keyed preset substitution, nested preset in include, raw preservation, invalid position, inline override, whitelist refusal, cycle refusal, and null composed output on error.
- PROVEN deterministic at the preceding loader slice: `vp test src/family/lane.test.ts src/family/project.test.ts src/family/store.test.ts` from web, 40 passed. All four native authored fixtures load and native parameter edits emit correct pointers. Later native capture/schema edits need the next rerun.
- PROVEN artifact: offline typegen wrote 67 operation contracts. This is not runtime freshness.
- Final targeted checks supersede this checkpoint; see the slice verdict above.
- UNPROVEN: browser interaction, Revit apply/build/capture, rollback per family, batch continuation, no implicit saves, and installed behavior. The proof owner owns runtime. Root reports scoped SDK fresh proof independently; this report does not adopt it as route proof.

Raw output: `.artifacts/runs/browser-20260906-ff/{composition-test,family-test,typegen,install,check-fix,families-check}.txt`. The directory name was user-requested; these files contain deterministic/artifact evidence, not browser proof.

## Authoring decisions still open

1. For a field inherited from `$preset`, edit the referenced fragment or explicitly materialize the object before a local override. Current whole-object preset semantics forbid inline overrides; no silent behavior is selected.
2. Keyed `$include` merge syntax and duplicate-key policy are not established. Current support is whole-map `$preset` substitution; array includes retain their existing semantics.
3. Exact fill-blank-from-source field and atomicity receipt additions belong to the normalize/C# owner. No guessed fields are sent.
4. Existing family cell Apply must become a real native patch with reviewed hashes and receipt/recapture; current local simulation remains fixture-only.

## Outstanding route wiring after this slice

- Active family-document native plan/apply is still absent from this checkout's host contract. `FamilyFoundryBridgeOps.cs:20` and `:24` take `ProjectDocument`; `revit.apply.family-model` builds a new file. A native family-document reconcile operation is needed before replacing the interim Apply refusal. Do not route current-family apply through bulk project operations or claim capture values changed locally.
- `/families` row navigation at `source/pe-tools/apps/web/src/families/matrix.tsx:92` still navigates to `/family` with empty search. It does not open the clicked family or an authored file. Existing target rebinding helpers also retain their prior no-op behavior; this slice does not claim those journeys closed.
- `source/pe-tools/packages/mcps/src/pea/route-state-commands.ts:109` and `:146` retain the separate family-types route's `family.editor.snapshot/apply` calls. That half-built route and its schema were not removed or silently converted into native reconcile.
- Native `forms`, `datums`, `refPlanes`, `refLines`, `dimensions`, `nested`, arrays and connector placement still need their own native projection/editor migration. Old geometry preview/editor features remain available. Coverage and unmodeled facts are retained in route-state JSON; a complete geometry/coverage readout is still owed.
- Native examples are selectable on `/family` through explicit fixture URLs. `/families` keeps six populated fixture rows and native-shaped per-family plans/projection JSON; command mutations remain refused in fixture mode. Additional authored patch examples and a route-level JSON authoring view remain outstanding; Pea authors through existing route:settings commands/fields.
- Inherited local-versus-shared editing and include-conflict resolution remain user questions. No merge precedence, inline override, or keyed-include syntax was added. Blank-fill-from-source is not sent until the C# owner supplies its field.
- Host/schema verification of the four native JSON examples must run after the root's scalar schema and composed-validation fixes are present. No fixture carries a fabricated green provider-schema verdict.
