# Family routes proof checkpoint

## Instances selector repair - 2026-09-07

The browser blocker was a representation mismatch at the Instances route-state boundary. Host
targeting uses a raw target id such as `ff-profile-proof-25`; persisted Instances state requires
the canonical `session:ff-profile-proof-25` selector. The UI previously wrote the raw id and tried
to resolve stored canonical selectors as raw ids.

`agent-contracts/instances.ts` now owns the schema plus its two exact conversions. The Instances
table encodes only when writing `selectedSession` or `staged.session`, and decodes only when handing
the value back to `worldTrunk`. MCP lifecycle consumers use the same decoder and start-result
writers use the same encoder. The Host resolver and its raw target ids did not change; the route
schema still refuses noncanonical state.

Architectural tally: one two-function codec at the existing schema owner; two adapter consumers;
zero new contracts, endpoints, state fields, compatibility paths, or native changes. Every writer
of `selectedSession` and `staged.session` now uses the codec.

Deterministic proof: the actual Instances route component clicks a controlled session and its
already-open document and records canonical route patches, then remounts from a canonical stored
selector and selects the raw Host world. `vp test src/routes/-instances.test.tsx` passed 8/8;
`packages/runtime/tests/instances.test.ts` passed 1/1. Targeted `vp check` passed the three changed
production files. The full web check remains blocked by the pre-existing formatting failure in
`src/host/fleet.test.tsx`; the agent-contracts package check reaches the pre-existing generated
settings type mismatch in `tests/settings-fields.test.ts:62`.

No Host, browser state, Revit session, document, lifecycle command, or Apply changed in this slice.
Actual browser repetition waits for root integration after the proof hold.

## Final legacy geometry adapter slice - 2026-09-07

Modine HHD and both Wine Guardian profiles now use the same native rectangle, driven face-plane, circle-stub, and connector lowering as the authored profiles. Legacy strings, `Frame.Plane`, `Derived.{Solid,Face}`, `Semantic.Name`, and `Cabinet.Width/Length/Height` references resolve through one strict helper. Rectangle face aliases preserve the evaluated plane names. Connector depth produces the authored `Host.Depth.PlaneNameBase`; `${Name} Stub` preserves the generated solid name; round diameter stays parameter-driven. Duct and pipe configuration is copied, old `SupplyHydronic`/`ReturnHydronic` names map to the native `HydronicSupply`/`HydronicReturn` enum names, and absent pipe flow direction retains the retired evaluator default `Bidirectional`. Modine electrical `PowerBalanced` and both `Voltage` and `NumberOfPoles` associations are emitted as native `associate` entries. The retired round-connector evaluator used `Diameter.By` and did not materialize `Diameter.PlaneNameBase` or `Strength`; the adapter validates those authored fields and preserves that evaluated behavior rather than inventing diameter planes.

The real-profile check now covers all seven corpus `ParamDrivenSolids` entries. With each profile's existing `MakeRefPlaneAndDims`, Modine emits 15 planes, four forms, and three connectors; Wine Indoor emits 17/6/5; Wine Outdoor emits 11/3/2. It checks the electrical system/binding projection and strict native JSON parsing. The only corpus `SetLookupTables` occurrence is Grinder Pump with `Enabled:true`, `ReplaceExisting:true`, and `Tables:[]`; it is now a validated no-op. Populated `ReplaceExisting:true` tables lower only through the existing typed `LookupTableDefinition` plus `LookupTableCsvCodec`; unknown nested members fail. `ReplaceExisting:false` remains an explicit gap because keyed native patches replace changed table content and cannot retain the legacy skip-existing instruction. No corpus profile uses that shape. Compile lane: `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug -p:Platform=x64 --no-restore` passed with 0 errors and 38 warnings; no Revit runtime claim.

## Authored ParamDrivenSolids lowering slice - 2026-09-07

The retired evaluator established the two corpus profiles' semantics: named `Planes` are driven offsets from reusable plane references; `Spans` are strong-reference symmetric pairs with a labeled size and EQ constraint; prisms and cylinders reuse those planes; a connector owns a `${Name} Stub` solid whose authored depth determines its terminal connector face. The existing converter now lowers that vocabulary directly into the native `refPlanes`, `dimensions`, `forms`, and `connectors` sections. `@CenterLR`, `@CenterFB`, and `@Bottom` resolve to the existing native family datums. Named height planes remain named; the unnamed Blank Cover height uses the native macro convention `Blank Cover.top`; connector stubs retain `${Name} Stub` and gain the required deterministic `${Name} Face` native plane so depth remains parameter-driven and `connector.on` names the actual terminal face.

The Grinder Pump result is six reference planes, four forms (three cylinders plus one connector stub), and one connector. Zehnder is fifteen reference planes, five forms (one prism plus four stubs), and four connectors. Form solid flags, all length drivers, strong-reference planes, span and plane names, system/flow/loss settings, and connector centers are retained. Unknown fields, malformed nested values, duplicate generated names, unresolved axes, and invalid directions refuse. No native capability addition was required; the existing extrusion and plane primitives express connector depth. The real-corpus public converter check covers both profiles and parses each merged native model. Compile lane: `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug -p:Platform=x64 --no-restore` passed with 0 errors and 18 warnings; no Revit runtime claim.

## Legacy ParamDrivenSolids conversion slice - 2026-09-07

The frozen 45-profile corpus contains seven `ParamDrivenSolids` operations: six populated and the deliberately empty HPWH operation. Four use the legacy `Enabled/Rectangles/Cylinders/Connectors` vocabulary (Constrained Box, Modine HHD, and both Wine Guardian profiles); Grinder Pump Basin and Zehnder use the retired authored `Frame/Planes/Spans/Prisms/Cylinders/Connectors` vocabulary. The converter now strictly lowers the Constrained Box rectangle into existing native reference planes, dimensions, and one extrusion, preserving its authored plane names, strengths, drivers, anchors, sketch plane, solid flag, and form name. Generated names collide explicitly. The exact empty HPWH object is accepted as a no-op. Nested objects and arrays are type-checked and unknown fields refuse.

At commit `8912f48`, remaining lossless gaps were explicit: both Wine profiles stopped at populated connectors, Modine stopped at its object-valued frame, and Grinder/Zehnder stopped at their reusable authored vocabulary. No operation or nested field was filtered. That slice's public check validated Constrained Box and HPWH and asserted those five refusals; the authored-profile section above closes Grinder and Zehnder.

## Legacy reference-plane conversion slice - 2026-09-07

`FamilyProfileConverter.Convert` now converts all four active `MakeRefPlaneAndDims` corpus profiles into native `refPlanes` and `dimensions`. Mirror specs emit two signed-axis seed planes, one labeled size dimension, and one equality dimension. Offset specs emit one signed-axis seed plane and one labeled dimension. The converter accepts only the corpus anchors, directions, strengths, operation fields, and inner spec fields. It refuses unknown fields, unknown values, malformed entries, duplicate generated plane names, and active empty operations. It does not alter source profiles or introduce another geometry engine.

The public converter test reads the frozen composed AprilAire800, Wine Guardian indoor/outdoor, and Modine HHD profiles. It asserts exact emitted plane/dimension counts and parses each patch after merging it with a captured native family model. The test is compiled but not executed because this slice forbids Revit runtime. Isolated `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug -p:Platform=x64` passes with0 errors and120 warnings. The first `--no-restore` attempt found no fresh-worktree assets and compiled nothing; the normal isolated build restored them and passed.

`FamilyProfileConverter.Convert` now returns `FamilyProfileConversion`, which carries the `FamilyPatch` and the existing `ExecutionOptions` as separate typed values. It accepts only the four legacy boolean fields and uses the existing `ExecutionOptions` property initializers for omitted defaults. The company-profile consumer passes `conversion.Options` to the existing `OperationProcessor(document, options)` constructor. Runtime options never enter `FamilyPatch` or desired `FamilyModel` JSON. `SingleTransaction` still controls only how `OperationQueue.ToNamedFuncs` groups inner edits. `FamilyVisit.Run` and `FamilyVisit.InPlace` keep the whole family inside their outer `TransactionGroup`. The existing failure test now obtains `SingleTransaction:false` and `OptimizeTypeOperations:false` from the frozen Constrained Box profile, then proves the expected full-family rollback assertions through that transported instance. The test is compiled but not executed in this no-runtime slice. Electrical connector normalization remains untouched pending the update-all and host-search design.

Proof stamp: `PROVEN[compile, Pe.Tools-ff-convert family/convert from 2025720, e1d6f13 plus current slice, 2026-09-07]`. The final isolated build passes with0 errors and119 warnings. Native behavior and rollback execution remain `UNPROVEN` until the runtime owner executes the compiled public converter cases.

## Parameter-only readouts and Host restart - 2026-09-07

Root integrated web slice70a4c4b as b56b452. R gracefully stopped only the owned root Host pane `ffroutes0906/w1:p4` with Ctrl+C and relaunched its existing `vp run attach` command. Old PID70908 exited; new PID84032 serves `http://127.0.0.1:52068`, service `host-source-2d50d9dbd1a8`, from `Pe.Tools-family/source/pe-tools/apps/host`. `/host/status` returned200; receipt is `.artifacts/runs/browser-20260906-ff/root-host-restart-status.json`. P received the identity. No Revit lifecycle or document mutation occurred. This reloads integrated Host command modules; it does not prove a new Revit payload.

The parameter-only `/family` profile omitted types correctly, but `buildPageWorld` used only authored type names for columns. Native capture projection now retains all captured type names, including empty types, and the page unions them with authored names. Draft types remain empty and untouched JSON produces no patches. `/families` hid every non-built-in family parameter in a one-family scope because common required at least two families. The existing30% threshold now has a minimum of one; the column hook test verifies Width remains visible and labeled common. No native classification DTO changed. Deterministic lane:61/61 targeted web tests pass, raw `parameter-only-matrix-tests.log`; scoped format/lint/type check has zero errors and one existing unbound-method warning. Browser verification awaits integration and P's next controlled checkout snapshot.

Sibling Apply census: `packages/mcps/src/pea/route-state-commands.ts:133` retains `family-types.push` through `family.editor.apply`; `packages/agent-contracts/src/family-types.ts:152` restricts it to humans. Its handler converts only explicit failed result rows to failed cell keys; `packages/agent-contracts/src/commit.ts` folds/clears other staged cells. `Pe.Revit.Global/Services/Host/RevitDataRequestService.cs:442` catches each edit exception and completes the shared transaction if any edit succeeded. Thus partial successful cells can commit while failed cells stay staged. This differs from Family Foundry's per-family rollback contract. It has no reviewed FF plan hash; its missing-result handling also warrants the primitive owner's receipt audit. These are source findings, not fresh runtime proof; no sibling feature or behavior was removed.

`/family` already uses `packages/mcps/src/pea/family-commands.ts:22` plan/apply: saved composed JSON, exact reviewed hash, re-read composition equality, consume plan before mutation, then receipt and native capture. Stale workspace comments claiming profile-wins Apply was a later phase are corrected. Cell-level simulation remains fixture-only; native callers are directed to the reviewed header action. Root owns raw macro reapply and primitive atomicity decisions. Wave8 failures and installed Pe.App binding reported by P remain unresolved native evidence; successful corrected fleet HTTP receipts are still owed.

## Corrected backend handoff and receipt consumption - 2026-09-07 06:58 UTC

P stopped the controlled route session at06:55:35 exit0, verified PID96920 gone and protected sessions retained, with native settings SHA unchanged. No further R calls target that session. P commit **dc6a5a1** supersedes R5375f2f for backend integration: it includes the same immutable-name fix plus actual loaded replacement ID, exact project EditFamily reads and native refusal preservation, with highest-surface regression tests. R inspected the diff; no cross-worktree merge or duplicate backend edit was made. P reports compile success; fresh native proof remains pending root READY.

The route's receipt consumer already indexes returned `receipt.familyId` directly, so the replacement ID needs no DTO shim. Fleet Apply now consumes its reviewed plan and exclusions once a native response is received, preserving the returned replacement receipt and requiring replanning before another Apply. The command test sends original family1/hash-1 and returns receipt family2; identity/residue survive, plan is cleared, and a subsequent unplanned Apply is refused without another host call. All4 command tests pass; static checks zero errors/warnings. This Host command change needs root integration and a fresh Host process/module load before browser proof (the web-only guard needs only Vite refresh).

The failed old document's route scope retains outcomeUnknown across session restarts. P was asked for fresh disposable document paths for the corrected acceptance run, preserving the failed record. No recovery flag or company settings file was deleted or overwritten.

## Fleet outcome recovered; repeat plan is no-op - 2026-09-07 06:54 UTC

P's independent ReadOnly execution `2a710b1de31a4370b704ffb7fdc443e0` proves the mutation committed: project Modified=true, loaded family6151046 replaces6150263, Standard symbol6151027 Width `3.5000000000000004ft`, old count absent, shared Count7 and expected GUID. Native stack `fleet-invalid-object-stack.log` confirms `Element.get_Name` in `ApplyFamilies` catch line89, inner bridge request `00e7b2f1-b105-48ad-9092-e18cdf4d3bba`. Receipt identity fix is R commit **5375f2f**; P owns the project/editor identity fix.

After this authoritative recovery, R clicked browser Plan again (no external Apply replay). It returned replacement family6151046, hash `0776FAA8FDEA3846`, zero changes/run effects/refusals. This proves the fleet's native resulting state is a no-op. It does **not** turn the failed HTTP Apply into a successful route receipt. The route retains `status:outcomeUnknown`; no recovery flag was cleared and no original request retried. Evidence `fleet-recovered-repeat-plan.json/.ax`, `fleet-recovered-native-readback.txt`, `fleet-through-recovered-repeat-network.json` is saved. P has been notified that this snapshot's route wave is complete with failures and may coordinate owned cleanup/fresh proof.

The matrix independently refreshed to replacement family6151046 (visible in `fleet-recovered-repeat-plan.ax`); its initial stale display was transient. Remaining route seams exposed by this run: the Apply button remained visually enabled after a later read-only plan despite the retained unknown-outcome guard, and `/families` has no explicit external-outcome recovery command. Its existing Apply handler excludes zero-change entries, so the fleet repeat proof is a fresh no-op plan plus independent native readback, not a second native Apply receipt. Successful browser receipt acceptance requires the corrected future payload, after both backend fixes are integrated. No claim of full application completion is made.

The visual Apply eligibility defect is repaired in the routes tree: the fleet store derives one refusal from the existing route slice's outcomeUnknown, current plan, exclusions and existing familyFlag; the head and Apply action share that refusal. Unknown outcomes stay blocked and empty plans say nothing is included to apply. No outcome state is cleared. Regression checks both cases produce no host command; family/fleet store and fleet product checks pass29/29. Static check: zero errors, one existing session unbound-method warning. Browser verification of this guard awaits root web integration.

## Actual fleet Apply exposed two backend defects - 2026-09-07 06:53 UTC

Root web `a0a65ea` includes catalog fix `7405aec` (R `812ce36`). Actual browser selection now works: Electrical Equipment resolved21 families; R selected only PE Box, applied that one-family read scope, and bound the unique native patch. Plan against project family6150263 first returned hash `0776FAA8FDEA3846` with zero changes while P independently read the project's unchanged Width24in/oldCount3/newCount absent. `FamilyFoundryBridgeOps.WithFamilyDocument` reuses `Application.FindOpenFamilyDocument`, which matches `Title.Contains(family.Name)` and selected the separate, modified editor. P discarded only that disposable inactive editor without saving/reloading. The same project replan then returned `29AF2C0418C7C47D`, four changes, two run effects, zero refusals. This isolates the proof; it does not repair project/editor identity.

Browser Apply sent `expectedPlanHashes:{"6150263":"29AF2C0418C7C47D"}`, route revision3, request `d30356e9-c7de-4d2a-ab6d-a8e52e54a09b`. It returned an invalid Revit object-reference error and **external outcome unknown**, so R did not retry. Native output `host-apply_2026-09-07_01-50-39/PE Box/receipt.json` nevertheless reports Converged=true, empty Residue, all four changes applied; processor trace reaches family-complete. P's independent read found replacement family6151046 (old6150263) with Width3.5ft and shared Count7. Thus the browser response is not a success receipt even though native mutation committed.

The minimal bridge repair captures `family.Name` before processing and uses that immutable value for success and catch receipts; loading can invalidate the old Family wrapper. Isolated routes-tree Debug.R25 Pe.App compile passes: exit0, zero errors,98 warnings,12.69s. No DTO/codegen changes and no runtime payload changes. Root must transplant this small name-capture fix while retaining its newer normalize/hash/atomicity code; this branch's older surrounding bridge code must not replace that integrated implementation. Fresh runtime proof of the fixed receipt is still required.

Evidence in `browser-20260906-ff`: `fleet-{baseline,open-family-mismatch,correct-holder-plan,apply-failure}.ax`, `fleet-{initial-plan,correct-holder-plan,initial-network,apply-failure-network,apply-failure-response}.json`, copied complete `fleet-native-apply-artifacts/`, and `receipt-fix-build.{log,stderr.txt}`. The failed request is retained, and fleet repeat/recovery remains pending. Screenshot capture remains unproven after the previously diagnosed capture timeout.

## Current-family repeat is a verified no-op - 2026-09-07 06:45 UTC

P reactivated the already-modified family with no save/reload/restart (`family-repeat-open.json`, request `518ee7ab27034e11ab1f51e31d115f2d`). Browser Plan returned fresh hash `AEE603F8930627FA`, zero changes, zero run effects, zero refusals. Browser Apply used that hash, route revision3, request ID `34138f9a-3f50-4678-9627-5252bfa6e97d`; its native receipt reports success/converged=true, empty residue/errors/diagnostics. Independent recapture `modelJson` is byte-identical to the first Apply and its document version remains `3a72f3ef-98c7-43fc-8992-d8f966aa5dd4`. The browser native disclosure and receipt were inspected again. PROVEN[browser + controlled session/dev, immutable ca353e9]: current-family parameter-only initial Apply and repeat no-op. Evidence: `family-repeat-{plan,apply,network}.json`, `family-repeat-{plan,readback}.ax`. P is returning the unchanged project; fleet still awaits root integration of `812ce36` at this checkpoint.

## Fleet browser blocker repaired in routes tree - 2026-09-07 06:41 UTC

P activated the existing project and independently proved its baseline remained Width24in/Old_Count3 with the new shared parameter absent. R created the unique patch through create-only settings authoring and opened `/families` on the exact project holder. Browser category selection succeeded, but the dependent family picker stayed stale/disabled. Network observation after toggling the category showed no catalog request. No fleet Plan or Apply ran.

The regression in `families/store.test.ts` reproduces zero family reads after changing categories. `families/store.ts` now reads category and placement atoms directly through the existing runtime, removing the SWR wrapper that left this dependent read stale. Separate selectors prevent family-selection updates from feeding back into catalog reads. The test passes with exactly one catalog read and PE Box available; all 11 store tests pass. Static check: zero errors, one pre-existing unbound-method warning at the session read. Root integration/web refresh and actual fleet click-through remain required; no C# or host restart is needed for this web-only fix.

The separate zero-type agreement defect is also repaired: `rowAgreement` now returns unread when no type could be compared. The existing native lane test covers a parameter-only profile, and the lane plus fleet store tests pass 17/17; model/lane static checks report zero errors/warnings. Showing captured type columns beside an omitted authored types section remains open; the native disclosure already provides the readback without authoring omitted types.

## Actual current-family browser acceptance - 2026-09-07 06:38 UTC

PROVEN[browser + session/dev, controlled ff-route-25, immutable ca353e9]: P confirmed active native `PE Box.rfa` after loading the original Width24in/Old_Count3 baseline into the separate project. R used root host `http://127.0.0.1:52068` and the exact backslash document address from `family-holder.json`. The unique model `ff-route-proof-ff-route-25-parameters` was created through the settings route command with create-only semantics and independently read back; existing company settings were not overwritten.

Browser **plan current family** returned hash `5AFEE5B3F6483FC3`, four changes, zero refusals. Browser **apply reviewed plan** returned success=true, converged=true, empty residue/errors/diagnostics, and consumed the plan. The browser's expanded native capture and independent route-state read both show Standard Width `3.5000000000000004ft` (42in), shared `FF_Route_Proof_Count` = `7`, GUID `f70f2c68-3d81-4dc3-a2d9-2da64e2a7158`, and no old parameter. Coverage reports parameters/types Read, details NotRead, and one TemplateUnknown unmodeled fact. R did not save or reload the family into the project. P was notified that family acceptance completed and asked to activate the unchanged project for fleet acceptance.

Evidence under `.artifacts/runs/browser-20260906-ff/`: `family-after-browser-plan.json`, `family-after-browser-apply.json`, `family-plan.ax`, `family-apply.ax`, `family-native-readback.ax`. Settings create/read receipts and exact requests are under `.artifacts/runs/ff-route-acceptance/ff-route-25-parameters/`. This proves browser interaction and native readback, not screenshots or a live Pea turn. PNG capture remains open.

Observed route limits: three simultaneous live route tabs stalled hydration; closing the two duplicate proof tabs immediately released queued reads, consistent with the documented HTTP/1 SSE connection budget. The parameter-only profile omits types, so its table has zero type columns and misleadingly labels rows agree even before capture; the native disclosure still exposes actual Standard values. These UI seams remain to repair. Planned forward-slash paths also differ from the holder's exact Windows address; acceptance uses the returned canonical holder address.

The older checkpoints below retain their historical timing; this section supersedes their pending-family statements. Fleet acceptance remains pending P's project-holder confirmation.

2026-09-06. Owner checkout `C:/Users/kaitp/source/repos/Pe.Tools-ff-routes`, branch `family/routes`, base `d2e19ce15ec9092018f1c37cfc529c97e8349cd3`. Initial-wave report, updated after the intermediate checkpoint. No subagents, Revit lifecycle operations, company settings writes, or other-worktree merges. MAP and LEDGER are untouched.

## Controlled session ready; awaiting document holders - 2026-09-07

Root READY authority is `ca353e9` with the complete SDK151.ff.1 graph. Direct coordination uses the existing Herdr agent `ffproof0906/proof` (R is `ffroutes0906/routes`); no agent was spawned. P's actual session-start receipt reports **ff-route-25, controlled-active snapshot checkout**, root Pe.App, PID96920/start06:25:19.0983332Z, generation `20260907062428752`, build stamp `ed915890270c`, ready06:25:47 UTC. Root host52068 independently lists that controlled session as `session-4502832c39f91c9a`, initially with no active document. R did not launch or activate anything.

`ff-route-25-actual-start.json` preserves P's receipt. Its launching CLI is the repaired local beta150 proof binary SHA3103B2C26794AE17E5EC1379490D742F500AA37AF0732C1C72F277D3EEC6CDA2; this is distinct from the materialized payload. `ff-route-25-payload-sdk-files.json` records the copied Loader/Bootstrap files as151.ff.1+8fe90ded. These file reads are artifact identity, not an independent loaded-module claim; P owns the loaded-module receipt.

P supplied planned native paths under its evidence `route/`: `PE Box.rfa` and `ff-route-project.rvt`. R generated both parameter-only request bundles with these exact paths under `.artifacts/runs/ff-route-acceptance/ff-route-25-parameters/`. The seed is Width24in plus FF_Route_Proof_Old_Count3. P will load that baseline into the project before the family editor Apply; no implicit reload is assumed, so both routes can prove actual changes toward Width42in and shared Count7. Native creation/active-holder confirmation is still pending at this checkpoint.

Ignored helper `browser-20260906-ff/seed-route.mjs` validates against root's current Scope/settings command schemas, reads the current route revision, creates only the uniquely named settings document, and records an independent route read afterward. Its default dry run sends no HTTP request; both bundles passed that validation. Plan/Apply are deliberately browser actions, and this HTTP seed helper is not claimed as a live Pea turn. The real family browser tab is prepared with doc+target, without source=fixture. No settings seed, Plan, or Apply has run before P's holder confirmation. Evidence `live-family-before-session.ax.txt` and `live-bridge-census.json` preserves that boundary.

## Integrated root host/browser and parameter-only acceptance preparation - 2026-09-07

Actual answering root host/web URL: **http://127.0.0.1:52068**. Started with the existing host `vp run attach` (no takeover), Herdr `ffroutes0906/w1:p4`, cwd `Pe.Tools-family/source/pe-tools/apps/host`. The service receipt and `/host/status` identify sourceRoot `C:/Users/kaitp/source/repos/Pe.Tools-family/source/pe-tools`, dev lane, PID 70908, instance `06d1b179-cf65-4aed-9d08-dfd285980a14`, service `host-source-2d50d9dbd1a8`, start 06:13:16 UTC. Revit capability is true but **bridgeIsConnected=false**. This is distinct from the older routes-checkout no-Revit host on 5180. Receipts are `root-host-{receipt,status}.json`; no Revit lifecycle or company settings writes occurred. The proof owner must verify that its eventual ff-route-25 bridge answers here, or provide the actual answering URL if snapshot source identity differs.

Root test build ended with 0 errors before this Pe.App build started. Root advanced to `3dc0dcb091bce36594b56b8bed82f0ae9f8f569e`; the isolated Debug.R25 build records that same start/end HEAD, 06:13:49–06:14:00 UTC, **exit 0, 102 warnings, 0 errors**, deploy/launch false. Root status remained clean at inspection. Output root `.artifacts/build/Pe.App/Debug.R25/Pe.App.dll` SHA256 `6C80B299B97B2CBC3898ECD07192F277E62043894EDD5FA36BCEC8DAECB56E31`. Evidence `root-pe-app-build.*`, `root-pe-app-payload-hash.json`; prior7479a63 build logs were preserved. This compiles the integrated changes through bf4a1a3 and the subsequent root parameter-scope fix, but remains separate from SDK session delivery.

**PROVEN browser against root TS:** all four explicit native family fixture routes load, their displayed raw JSON exactly matches root's current four source files, and all display coverage/unmodeled as not captured. Box Wide Width edit 36in to48in was committed and read back as one unsaved cell; the front rectangle ratio changed to48/36 while displayed authored JSON stayed byte-identical. The native fleet displays all four families/six type rows; clicking PE GRD Exhaust navigated to `/family?source=fixture&fixture=grd`, displaying its Duct Width and arrays. Bath shared-parameter inspector and hinge refLines/dimensions readouts rendered. Browser error logs for all four tabs contain zero error entries. No screenshot retry was made; visual screenshot proof remains open. Evidence: `root-{box*,fleet*,bath*,refline.ax.txt,browser-errors.json,fixture-readbacks.json,fixture-source-proof.json}`. An initial Page.navigate timeout was resolved by inspecting the already-created tab, not by treating navigation failure as route failure.

`acceptance/prepare.ps1 -ParametersOnly` now emits only the native family header and the two proof parameters for `/family`; it omits geometry and type declarations. `/families` continues using the parameter-only patch. The existing full-source-fixture mode remains unchanged. Shape execution used the explicitly fake request-check scope only, generated `.artifacts/runs/ff-route-acceptance/parameter-request-shape-check/`, and checked exactly two sections/two parameters (`parameter-only-readback.json`). These paths are not claimed to exist in Revit. For the actual run, invoke this script with **P's real family/project paths and SessionId ff-route-25**, `-ParametersOnly`, and the integrated canonical SourceFixture path. No request is sent by the generator. P's controlled session/document identities, native plan hashes, human Apply clicks, durable receipts, recapture, and unchanged omitted geometry are still required before a route-to-Revit acceptance claim.

## Settled preset overrides and 45-profile composition - 2026-09-07

User ruled explicit profile fields override preset fields while retaining omitted fields. Host `expandPresets` now uses the same recursive `mergeCompositionFields` as keyed includes: preset defaults first, explicit profile fields second; arrays/scalars replace, objects merge recursively. Referenced includes are expanded before merging inline fields, so an inline Width.value can override an included parameter without losing its dataType. Raw JSON and dependency references remain intact. C# typed settings still delegate to Host; the C# preset authoring schema now permits inline fields, with full validation applied to composed content. No second resolver or generated transport DTO was added. The user explicitly authorized recording this ruling in `LEDGER.md`, superseding the earlier prohibition for that verdict only; MAP remains untouched.

Inherited edit boundary now distinguishes an explicitly authored override from an omitted inherited field. Editing existing profile Width.value saves locally while retaining $preset; editing inherited Width.dataType still directs the user to shared sources. No transparent local override is created for an inherited edit. Exact winning-leaf provenance across nested shared fragments remains unimplemented; retained dependency references are not presented as leaf provenance.

**PROVEN deterministic composition: 45/45 frozen company profiles compose through the current Host.** Inputs are N's `source/Pe.Revit.Tests/Fixtures/Profiles/company-20260906`, plus its separate `company-reconstructed-20260906/Global/fragments/_filter-aps-params/Dehumidifier.json`. The latter is N's reconstructed definition, not an original company file. All 52 original files copied into this tree's isolated sandbox have matching source/copy SHA256. N's source and sandbox were not modified. This replay uses a permissive provider schema to isolate composition; it does not prove native migration validity, live provider acceptance, or Revit behavior.

AprilAire E-Series readback asserts all 16 explicit IncludeNames.Equaling values win, all four preset IncludeNames.StartingWith values remain, inherited ExcludeNames values remain despite the explicit empty object, and the raw preset pointer remains. Evidence: `compose-all-profiles.mjs`, `verify-aprilaire.mjs`, and `company-preset-proof/{result,company-composed,source-hashes,reconstructed-preset-hash,aprilaire-readback}.json` under this report's evidence directory. N can rerun its existing compose-company.mjs after integrating this resolver; no input rewrite is required.

Validation: Host dispatch **20/20**, settings/Pea commands **8/8**, family store/route **16/16**; preset override tests cover an included Width datatype surviving a later profile value, array replacement, retained nested fields, raw JSON, and dependencies. Static/type/format checks: **0 errors/warnings**, four changed TS files. Own-tree isolated SettingsRuntime Debug.R25 compile: **0 errors, 14 warnings**; no root source/output changes or lifecycle. Logs are `preset-override-{tests,command-tests,web-tests,check}.txt` and `preset-schema-build.txt`. Root must integrate this source/schema change before claiming the final route payload includes it; the earlier root7479a63 compile predates this slice. Actual browser/Revit receipt acceptance still belongs to the coordinated session.

## Inherited edit boundary and refreshed payload - 2026-09-07

Root Pe.App isolated Debug.R25 compile refreshed at `7479a63b9a4a6d33cc724ae577e198fd2343bb26`, 06:03:09–06:03:19 UTC: **exit 0, 102 warnings, 0 errors**, deploy/launch false. Root status was clean at subsequent inspection. Pe.App.dll SHA256 `84DE95EA800D26D958DA88990C7A430B714D1B2B9FE9BFF61B64D4C1287BE6D3`; output path remains root `.artifacts/build/Pe.App/Debug.R25/Pe.App.dll`. Prior build evidence preserved as `root-pe-app-build-324d797.{json,log}`; latest receipt/log remain `root-pe-app-build.*`. This is compile proof, not session delivery. Sole proof owner still controls launch after fresh cleanup; no root source writes or Revit lifecycle occurred.

Inherited edit UX now checks the raw directive boundary **before** changing the family draft. A field behind a preset/include returns an explicit source-edit message, retains the previous draft, and identifies its raw pointer plus referenced shared-source links in the workspace. Opening a shared source remains possible because the rejected edit did not leave an unsavable local draft. Explicitly authored local type cells remain editable. The existing settings writer and family draft now reuse `agent-contracts/settings.ts::settingsFieldDirectives`; it traverses raw JSON only, with no expansion, precedence decision or alternate composition engine. The raw directive itself remains editable through settings.

This closes the failed-draft trap, **not** exact nested winning-field provenance. Source links identify the raw references, not a guessed leaf owner. Multiple fragments can contribute fields of one parameter; automatic origin-directed field navigation and fragment-aware schema/semantic validation remain open. No AprilAire preset-inline semantics were selected while root awaits the user's answer.

Validation: `shared-edit-web-tests.txt` **16/16** (family store and route), `shared-edit-command-tests.txt` **6/6** (settings/Pea capability commands), then `shared-edit-save-tests.txt` **3/3** after adding the writer refusal regression. Tests cover native preset and keyed include edits, unchanged draft, available settings.open, local type edits, and no settings.document.save through a directive. `shared-edit-check.txt`: **0 errors, 2 existing warnings**, seven files. Browser proof of this UX and actual family/families Apply/receipt readback remain pending the controlled session's host URL and real document identities.

## Root payload compile and production preset census - 2026-09-07

Root released the build lane after wave5 cleanup. From integration root `324d797fd58584378f8a6c5f76a912343abf156a`, isolated `dotnet build source/Pe.App/Pe.App.csproj -c Debug.R25 -p:DeployAddin=false -p:LaunchRevit=false` completed exit 0, 104 warnings, 0 errors (05:57:38–05:57:47 UTC). Herdr `ffroutes0906/w1:p3` owns the terminal. No Debug.R25.Tests build, deployment, or Revit lifecycle was performed. Output is root `.artifacts/build/Pe.App/Debug.R25/Pe.App.dll`, SHA256 `05AABA8AAB806CC7A2734A36CADB8AD481830B62B0CCA82616C4D2F773233715`. Build receipt/log/stderr are `root-pe-app-build.*` in this report's evidence directory.

Root was clean before compilation; subsequent inspection found the announced concurrent FF edits. This is **compile proof only**, not final payload freshness. The proof owner must launch from final coordinated source. Repeated SDK `session start ... --snapshot --plan --json` succeeded at 06:00:32 UTC, with no mutations, PID, or build stamp (`ff-route-25-start-plan-324d797.json`). It planned checkout Pe.App/year2025/id ff-route-25; it did not launch it. Actual host/web URL and family/project identities have been requested for browser click-through. The existing 5180 fixture host still belongs to this routes checkout, not integration root. This supersedes the earlier build hold below.

Production preset census supersedes earlier wording that C# composition parity requires another resolver:

| Consumer / seam | Observed current rule |
|---|---|
| C# `Modules/TypedModuleStorage.cs:28` | ReadRequired calls TsSettingsDocumentClient, refuses invalid snapshot, then deserializes composed content. |
| C# `Modules/TsSettingsDocumentClient.cs:11` | Calls Host settings.document.open-with-module, with composed content enabled, registered roots and generated schema. There is no independent C# expansion/override engine in this path. |
| C# `Json/SchemaProcessors/SchemaPresetsProcessor.cs:60` | Preset directive schema requires $preset and sets AllowAdditionalProperties=false. Authoring schema does not declare inline overrides. |
| Host `settings.ts:748` | Rejects every sibling of $preset **before resolving the preset file**; otherwise whole-object substitution, recursive presets, then includes. |
| Host `settings.ts:807` | mergeIncludeFields recursively combines keyed include objects; later scalar/array leaves win. This helper is used only by keyed includes, not presets. Array include splicing remains unchanged. |

The original frozen N sandbox `CmdFFManager/profiles/SavedEquip/AprilAire E-Series.json` has `FilterApsParams.$preset = @global/_filter-aps-params/Dehumidifier` plus explicit `IncludeNames.Equaling` (16 names) and `ExcludeNames: {}`. Current Host reproduces CompositionError for inline overrides, retains exact raw JSON, and returns null composed content. `census-preset.mjs` and `preset-census.json` record the read-only replay, original filter object and identical before/after SHA. A permissive schema isolates the resolver; this is not live provider proof. No company settings or N sandbox file was changed.

N's existing `company-compose-result.json` independently records a missing Dehumidifier preset for another profile. AprilAire fails before lookup, so adding override support alone would not establish that its dependency exists. Root owns that pending definition question. Do not remove AprilAire's authored siblings or fabricate the definition to make composition green. Supporting them extends current preset semantics and must settle explicit profile override behavior; the shared deep-merge helper exists if that is selected. Shared-fragment editing remains the default for inherited edits and does not erase already explicit profile intent.

Validation: current Host `vp test tests/dispatch.test.ts`, **20/20 passed**, including nested keyed Width override with preserved datatype, raw preservation, cycles and preset-sibling rejection (`preset-census-tests.txt`). No new resolver, transport DTO, profile rewrite or UX semantics were introduced by this census. Fragment-origin editing and fragment-aware validation remain the concrete source seams documented below; actual route Apply/receipts still require the coordinated fresh session.

## Integrated dev session preparation and fragment UX census - 2026-09-07

Integration root inspected read-only at `0bcab493f6a78ff5b2879ae137ff1b964e55afdb`. SDK beta.150 start-plan succeeded from that root:

```powershell
dotnet tool run pe-revit -- session start --project source/Pe.App/Pe.App.csproj --year 2025 --id ff-route-25 --snapshot --plan --json
```

`ff-route-25-start-plan.json` records state planned, checkout payload, root Pe.App/year2025, empty mutations/diagnostics, and SDK binary SHA256 `4D23791A6C273158A4E64D5361F79D2A04C575C25BA202D1381D54CF43563457`. No session was launched and no document opened. Snapshot was selected for an independent checkout build with no hot-reload emitter, as the current SDK guide documents (`sdk-session-guide.txt`). The sole proof owner launches after its current fresh tests. No pe.app-25 access.

Payload compile is authorized but **held pending root's explicit build-lane release**, requested asynchronously. Root's terminal outputs use `.artifacts/build` and `.artifacts/obj/<project>/<configuration>`; no fixed-path interactive override will be used. Intended compile is root Pe.App Debug.R25 with DeployAddin/LaunchRevit false. That compile proves root source; the eventual session receipt must separately identify the snapshot payload actually loaded. Existing browser fixture host remains the routes checkout no-Revit process at 127.0.0.1:5180, Herdr ffroutes0906/w1:p2; it is not an integrated root or Revit host. Actual browser acceptance will use the proof owner's reported integrated host/web identity and exact family/project scopes, with native plan/receipt/recapture observations.

Shared-fragment UX census (source findings, not completed behavior proof):

| Seam | Current behavior | Gap against the user's ruling |
|---|---|---|
| Expanded family cell edit | workspace-core edits local Draft; project.draftToPatches addresses the profile's native field pointer | It does not resolve the field's source fragment before editing |
| Save boundary | mcps/settings-commands.applyFieldEdit refuses traversal through `$preset`/`$include`; raw pointer remains intact | Refusal protects the file but does not implement origin editing |
| Shared navigation | family/workspace-view lists snapshot dependencies; store.openShared opens the dependency document through route:settings, then navigates to /settings preserving scope | Document-level dependency list only; no field-level winning origin |
| After an inherited draft edit | openShared refuses while authored/staged edits exist | User must resolve/discard the failed profile edit before source navigation; this is not transparent inherited editing |
| Settings source UI | routes/settings renders schema fields or raw-field readout from snapshot.rawContent and stages native pointers | This is not a general text JSON editor; native fragment rendering/save still needs live-provider proof |
| Fragment validation | host/settings.getSchemaJson chooses schemaJson only; semantic-validation resolves the root SettingsType and invokes its full validator | FragmentSchemaJson/relativePath are not selected for fragment context in the traced path. A parameter-map fragment can fail the full FamilyModel schema/validator; verify with integrated provider |
| Deep conflict origin | Earlier Width.dataType plus later Width.value retains both after b69ca97 | One parameter can have multiple source files. Default shared editing needs provenance per field, not simply the last dependency file |

No silent profile override or parallel composition engine was added. Required remaining closure is field provenance from the existing resolver, origin-directed edit/navigation, and fragment-aware schema/semantic validation. These findings supersede any earlier description implying that the existing source link alone completed inherited editing.

## Concrete route acceptance bundle and shared projection - 2026-09-07

`acceptance/parameters.patch.json` is a native authored proof patch, scoped to **PE Box**: Width becomes `42in`, and a dedicated `FF_Route_Proof_Count` shared Number parameter becomes bare `7`. Its fixed GUID is a new proof identity, not a claimed company definition. The offline sharedSpecId/visibility/user-modifiable fields and migration options use the exact `406e7a8` contract. No C# source fixture or company setting is changed.

`acceptance/prepare.ps1` generates actual Pea create/plan/read inputs, native model/patch JSON, canonical document scopes, route URLs and expected receipt/capture facts. It reads the integrated canonical Box fixture directly, preserves its forms/connectors, and replaces only the proof patch's parameter definitions. It refuses old signed-datum/bare-Voltage source and refuses pe.app-25. It executes **no** requests or lifecycle. Run from the integrated checkout with the proof owner's real values:

```powershell
& ./docs/features/family/acceptance/prepare.ps1 -FamilyDocument $proofFamilyPath -ProjectDocument $proofProjectPath -SessionId $proofSessionId
```

Required reality: the proof owner names an eligible session and a PE Box family document plus a project containing loaded PE Box; each document must be the actual holder resolved by its named scope when that route runs. Document opening/activation, baseline snapshots and payload freshness belong to that owner. This parameter-only patch and Box source have no nested-family dependencies, so the first parameter acceptance does not need ModelDirectory. Root still owns that separate dependency implementation.

Generated files go to `.artifacts/runs/ff-route-acceptance/<run>/`. For each of family/families, the `*-scope.json` is the Pea turn's canonical scope, `*-create.pe-do.json` creates a uniquely named settings document in models/patches, `*-plan.pe-do.json` plans that saved JSON, and `*-read.pe-read.json` reads native route state. These inputs are passed to the existing Pea doors under a matching fresh turn snapshot, never as a model-supplied transport target. After reviewing the actual returned plan, a human uses the route Apply control: family sends `{expectedPlanHash: entry.planHash}`; fleet sends `{expectedPlanHashes: { [familyId]: planHash }}` for included changed entries. Never copy a hash across runs; the hash includes current state/run. A second Apply requires replanning.

Observe native receipts (`success`, `converged`, residue/errors, artifacts), then capture/read back Width equivalent to 42in and shared count 7 with exact GUID/spec and reported parameter coverage. Preserve before/after document identity and saved/dirty state. An error, stale hash or failed family must not be reported as converged. Fleet capture uses its existing project-to-profile projection and returns per-family native JSON. Current-family capture is the route command's post-Apply recapture. Project-row editor navigation needs its separate scratch identity/open/activation check; an applied scratch file is not proof of reloading the project family.

The generator was actually run locally with deliberately non-runtime request-check paths/session and the current root fixture supplied read-only through `-SourceFixture`; generated files are in `.artifacts/runs/ff-route-acceptance/request-shape-check/`. This proves artifact generation only, not existence of those documents/session. The expected.json file is an assertion target, not a receipt.

Shared projection changes: the local view subset `ParamSpec` now represents optional dataType, scalar string/number/boolean values, shared/sharedGuid/sharedSpecId/sharedVisible/sharedUserModifiable, wasNamed/fillBlanksFromSources/mappingStrategy and tooltip. It is not a new validator. Native parameter projection uses sharedSpecId when no dataType is authored; the parameter inspector exposes the actual saved/captured native declaration, including those fields. Unrelated edits preserve the complete declaration and emit only the changed native pointer. Generated Host ParameterDefinitionDescriptor Visible/UserModifiable still must be regenerated from integrated C# by root; this slice does not hand-edit generated contracts.

Validation: `route-acceptance-commands.txt` has **8 passed / 2 files**, including the actual Pea pe_do entry point with registered capabilities, turn document+pin, route revisions, native create/plan inputs for both routes, settings/fleet proposals, and human-only Apply refusal. HTTP is mocked at the host boundary; existing handler checks separately assert native plan/apply transport payloads and persisted receipts/recapture. This is deterministic command proof, not a live Pea/Revit run. `shared-fields-tests.txt` has **6 passed** including offline field retention across unrelated value edits. Browser DOM interaction opened the native CWFU declaration in the real bath fixture (`native-shared-inspector.ax.txt`); that fixture declares shared/value only, so it does not prove offline-field rendering from a live capture. Screenshots remain open and were not retried. Wider web regression: **136/136 tests, 16 files**, exit 0 (`shared-fields-wide-tests.txt`). Static/type/format: **0 errors, one existing parameterText warning**, exit 0 (`shared-fields-check.txt`).

## Integrated unsigned-datum regression - 2026-09-07

Root's `2c54314` integration failure was caused by canonical unsigned datum normals (`X/Y/Z`), not by Voltage changing to `480 V`. The shared plane reader recognized only signed tokens, returned null axes for all three datum planes, and correctly refused to draw a centered macro whose origin could not resolve. The reader now recognizes unsigned datum axes as well as signed reference-plane axes; signed seeds keep their direction. Electrical values do not participate in dimension evaluation.

The committed regression loads the unchanged local Box source, applies the current canonical datum spelling and `480 V`, and checks dimensions/connector position/native edit pointers. An additional temporary executable check read **all four current root fixture files directly**, without modifying them; script, SHA-256 source manifest and output are retained as `native-current-proof.test.ts`, `unsigned-datum-source-hashes.json`, and `unsigned-datum-tests.txt` under the evidence directory. That check plus lane tests passed 6/6. Wider correctly scoped web run: **135/135 tests, 16 files**, exit 0 (`unsigned-datum-wide-tests.txt`). Static/type/format: 0 errors, one existing parameterText warning (`unsigned-datum-check.txt`). No C# fixture, project unit, transport schema or Revit runtime change.

Deep merge (`b69ca97`) and target navigation (`b17d6cd`) are already committed on this branch and included in the wider passing suite. Integrated route-to-Revit proof and generated-schema freshness remain with root/proof owner.

## Target selection closure - 2026-09-07

- `/family` and `/families` store bind actions now call a route-owned navigation callback; surfaces without a callback refuse rather than report fake success. Route owners retain the explicit document address and route search, validate the selected session id with the shared sdkSessionIdSchema, and write the session pin into `?target`. They are keyed by the full bridge selector, so a pin-only change recreates the store/writers with the new scope.
- World picker bound values now use the explicit pin or the existing shared scopeSession resolver's session id. RPC calls continue using the complete document-qualified selector. No selector parser, scope resolver or Revit activation operation was added. A pin cannot silently select a different document; shared host resolution still refuses a non-holder.
- Family navigation refuses while authored/staged edits are unsaved, leaving the draft intact. Family and fleet bind tests assert the actual navigation callback and no document write. Removed fleet plan/apply calls to its former no-op bind helper; those commands already use their scope-bound route writer.
- `target-bind-tests.txt`: **26 passed / 4 files**, run from the web package so its source-fixture filesystem allowlist/setup applies. Includes both route render tests, both stores, and unsaved-edit navigation refusal. `target-bind-check.txt`: **0 errors, 2 existing unbound-method warnings / 8 files**, exit 0. An earlier workspace-root test attempt denied the outside-root raw fixture import; the correctly scoped web run supersedes it. No Revit lifecycle or runtime calls were made.
- Remaining concrete acceptance steps: root integrates route commits and `406e7a8`, regenerates host contracts/provider schemas from that tree, converts frozen measurable fixture values, and supplies the proof owner's exact document/session scope. Then prove picker pin switching against eligible holders, Pea route:settings open/stage/save, route:family plan, human Apply with matching hash, and native receipt/recapture. Prove stale hashes and failures do not claim convergence. Fleet loaded-family open must verify returned scratch identity before capture; applying a scratch family is not yet proof of project reload. C# keyed composition parity and shared-fragment field provenance remain separate blockers. Visual screenshot proof stays open; no further capture retries.

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

# Route acceptance readiness — 2026-09-07

Read-only comparison against integrated root `debea34` found the six active `/family` and
`/families` store/host/workspace files byte-identical to this route tree. No stale route adapter
needed a source change in this slice.

## Current entry flows

- `/family`: the profile picker writes `route:settings`'s saved document binding. Plan refuses
  unsaved or staged edits, opens that saved document with `includeComposedContent: true`, selects
  validated composition through `executionContent`, and sends the resulting native patch to
  `familyfoundry.plan` (`family/store.ts:287`, `family-commands.ts:26`). Apply checks the reviewed
  hash and unchanged composed JSON, consumes the plan before the mutation boundary, sends the
  OwnerFamily id/hash, stores the complete native response, and calls
  `revit.detail.family-model` again to replace route evidence (`family-commands.ts:48`). A repeat
  therefore requires a new plan; the recapture is the value readback. No command saves the family.
- `/families`: the picker persists `profilePath`; scope becomes executable only through explicit
  Apply scope. Plan opens the saved patch with composition enabled, sends `patchJson`, filters the
  returned plans to the chosen family names, and persists their native hashes
  (`families-commands.ts:19`). Apply derives the exact included, non-refused, changed hash map from
  the stored plan, compares it with the browser submission, reopens the same composed profile,
  sends `familyfoundry.apply`, then stores receipts and diagnostics without rewriting family ids
  (`families-commands.ts:48`). Successful completion clears the plan, so no-op verification is a
  fresh Plan; Apply is disabled when no included family has changes (`families/store.ts:117`).
- Fleet recapture is the existing Host event path: root mounts `useHostLiveInvalidation`, a Revit
  world event invalidates `HOST_QUERY_KEY`, and the active loaded-family matrix query reads the
  project again (`routes/__root.tsx:70`, `host/live.ts:16`, `families/workspace.tsx:90`). Matrix rows
  and receipt verdicts both key the ids returned after replacement, so the native replacement
  `familyId` remains authoritative (`families/workspace.tsx:200`). There is no client-side attempt
  to retain the pre-load element id.
- Unknown external outcomes remain retry-blocking in route command admission; `/families` also
  exposes that refusal before the click (`families/store.ts:117`). Current-family Apply consumes
  its review before calling Revit, so a failed response cannot reuse the old hash.

## Next controlled browser actions

1. Bind `/family` to the proof owner's active family document, select the saved composed profile,
   Plan, record its single native hash/change list, Apply once, inspect its receipt, and confirm the
   automatic capture shows the authored values. Plan again and record the no-op plan. Confirm the
   document remains modified and unsaved.
2. After the proof owner activates the unchanged project, bind `/families`, select the same saved
   profile, apply the exact family scope, Plan, retain the per-family hashes, and Apply once. Record
   every receipt/diagnostic, wait for Host event invalidation, and verify the recaptured matrix row
   uses the receipt's replacement id and authored values. Plan again; the expected repeat result is
   no included changes and a disabled Apply. Do not retry an unknown outcome.

## Remaining proof dependencies

- Deterministic route proof is green: 31 tests in the family store, families store, and MCP family
  command suites passed. Raw output is
  `.artifacts/runs/browser-20260906-ff/route-readiness-tests.txt`.
- Browser click-through, Host event delivery, native receipts/readback, replacement-id convergence,
  per-family rollback, batch continuation, and no implicit save remain runtime claims for the next
  controlled session. The route has no recovery command for an unknown Apply outcome; recovery
  still requires authoritative native readback before another mutation.

## Wave12 route and script acceptance preparation - 2026-09-07

Root `4a97297` was read-only under its source hold. Its TypeScript route consumers match this tree. The corrected native fleet response now uses `FamilyProcessingContext.LoadedFamilyId` in `FamilyFoundryBridgeOps.ApplyFamilies`, so the receipt's `familyId` can differ from the reviewed plan id after `LoadFamily` replaces the project element. The existing route stores that returned id unchanged. A fresh plan must read and hash the replacement family.

The existing MCP command check now covers the complete deterministic sequence: reviewed id 1 applies, the successful converged receipt returns replacement id 2, the consumed plan cannot replay, and a fresh id 2 plan with no changes refuses Apply before another Host call. The generic route-workspace check proves an abandoned external mutation becomes `outcomeUnknown` and blocks the next external mutation. The `/families` store check proves the browser Apply action also stops before its writer when that state is present. These checks avoid inducing another ambiguous native mutation only to test the guard.

### Controlled browser prerequisites and actions

The proof owner must supply one controlled dev session receipt for the final root payload, including SDK session id, bridge session id, PID, generation/build stamp, checkout commit, loaded Pe.App identity, and exact active document path. The answering Host receipt must identify the same source root and connected bridge. The disposable family and project paths must be distinct. The project must contain the proof family at the recorded baseline before `/family` changes it, because current-family Apply does not save or reload it. Generate the two saved settings inputs with `acceptance/prepare.ps1 -ParametersOnly` against those exact paths and the integrated canonical `a-box.family.json`; the generator sends no request.

On `/family`, select the generated model, Plan, record the reviewed hash, Apply once, retain the HTTP/native receipt, and inspect automatic native recapture. Plan again and record an empty plan with Apply unavailable. Confirm the family document remains modified and unsaved. On `/families`, activate the unchanged project, select only the seeded proof family and generated patch, then Plan and Apply once. The receipt must be successful and converged with no residue, and its returned replacement `familyId` is authoritative. Wait for Host invalidation and record the project matrix readback against that id. Plan again. The repeat must name the replacement id, contain no changes or run effects, and keep Apply unavailable. If the HTTP outcome is unknown, preserve the envelope and native receipts, do an independent readback, and do not replay Apply.

### `NoTransaction` native script plan

Use the same controlled session only after the route proof owner releases the document. Call `scripting.execute` with `permissionMode: "NoTransaction"` and an inline script that first opens and rolls back a script-owned `Transaction`, then calls `FamilyModelBuild.Build` for a minimal Generic Model family and closes the returned family document without saving. Require `Succeeded`, output markers for `Started`, `RolledBack`, and `ff-build-complete`, and no policy diagnostic. Read the active project before and after to confirm the script did not alter it. This proves that the scripting host opens no enclosing transaction and that the called Family Foundry library owns its internal transaction boundaries. The existing fresh test `RevitScriptingPortTests.NoTransaction_executes_script_and_library_owned_transactions` is the matching native oracle; no new script framework or mock is needed.

Deterministic validation in this tree: MCP family commands 4/4, route workspace 14/14, and `/families` store 12/12. No root file, Revit session, runtime process, document, or takeoffs/main work changed. Browser receipts, native replacement-id readback, no implicit save, and the `NoTransaction` execution remain unproven until the controlled session runs them.

## Pea profile authoring chain - 2026-09-07

Read-only comparison against root `d460bf8` found the route state, capability manifest, and MCP handlers byte-identical before this slice. Pea already had the correct write boundary: `route:settings.fields` accepts proposals; `settings.document.validate` can validate those proposals against the saved profile; `settings.document.save` and both Family Foundry Apply commands remain human-only. `/family` binds the saved settings document and `/families` binds its `profilePath` plus explicit target scope.

The blocking shim was `summarizeSnapshot` in `settings-commands.ts`. `settings.document.open`, `create`, and `refresh` fetched `rawContent`, `composedContent`, dependencies, and validation from Host, then removed both JSON representations from the MCP result. Pea could address fields but could not inspect the real profile through route state. Those commands now return the existing `SettingsSnapshot`. They still persist only the document binding and fields, so profile bytes do not become stale route-state copies.

The inherited-field rule is unchanged: a proposal against an included field is refused with the origin fragment path, and Pea must open that shared fragment. Validation with `includeProposals: true` now has a complete read -> propose -> validate chain: it reopens the real raw profile, applies the proposal in memory, preserves unmentioned fields, and sends the candidate only to `settings.document.validate`. It does not save, plan, apply, or call Revit.

Deterministic proof: `vp test packages/mcps/tests/settings-commands.test.ts packages/mcps/tests/capabilities.test.ts` passed 9/9. This covers the returned raw/composed profile, a `Width` proposal that preserves `dataType`, no snapshot persistence, shared-fragment refusal, scoped `pe_do` creation/planning for both family routes, and human-only Apply refusal. `vp check packages/mcps` passed all 46 files with no format, lint, or type errors. No Host, Pea process, browser, Revit session, or document was started or changed.

## Family route contract synchronization - 2026-09-07

The authoritative offline generator found `host-ops.generated.ts` stale. Regeneration added `visible`, `userModifiable`, and `description` to all 11 generated `ParameterDefinitionDescriptor` projections. It also synchronized the current authoritative `scripting.execute` transaction-policy description. No schema was copied by hand.

`PatchSelect.IncludeByCondition` travels unchanged in `settings.document.open.composedContent` to `familyfoundry.plan` and `familyfoundry.apply`. `UnmodeledReason.ParameterMetadataUnreadable`, `FamilyModelParameter.SourceValuesTreatedAsMissing`, and the current `StockView` values travel inside opaque `modelJson`; `/family` stores that string as capture evidence and `/families` returns it without enumerating its fields. The route-state schemas therefore drop no selector field or enum member. The hand-authored family projection uses `structuredClone` and JSON Pointer field writes, so it preserves unmentioned model fields without defining UI behavior for them. The vendored `pe-revit-contract.ts` contains no Family Foundry DTOs and needed no regeneration.

`pnpm --filter @pe/host-contracts codegen:check`, targeted `vp check` over the generated contract and family route consumers, `@pe/host-contracts` build, and `@pe/mcps` build passed. The `@pe/web` production build produced both bundles and completed prerendering but did not exit after two empty 30-second polls, so it is not claimed green. The repository-wide `@pe/agent-contracts` and `@pe/web` checks remain red on unrelated base test/fixture type errors; the generated diff does not touch those sources. No Host, browser, Pea, Revit session, or native runtime ran.

## Local family condition selection - 2026-09-07

Wave 25 isolated the selector gap. `local-condition-selector-prerequisites.json` shows that the nonshared `Keep` parameter exists on `Prefix Fan Keep` symbols, but no `SchedulableField` exposes it. Revit's native equality rule selects type B and rejects type A on both symbols and instances through type fallback. The existing schedule evaluator therefore cannot represent this local field, and its exact filter-count refusal is correct.

`FamilyModelBuild.FamiliesMatching` now uses one existing `LoadedFamiliesTempPlacementEngine` rollback context for the selected candidates. It evaluates nonshared, non-built-in parameters on every symbol and temporary instance with `ParameterFilterRuleFactory`. It also asks `ScheduleHelper` to evaluate the same field for every category where that field is schedulable. The result is the union by family id, so a local field in one imported family cannot suppress a shared, project, or built-in field with the same name in another family. Any type can match, and `PlacedOnly != true` still admits unplaced families. The native path uses only the identity facts proven in wave 25: `IsShared == false` and `BuiltInParameter.INVALID`.

The local mapping covers the closed `ScheduleAuthoredFilterType` set where the parameter storage type supports it. Invalid values, incompatible operators, missing global parameters, and duplicate local field identities refuse explicitly. The existing schedule compiler, filter-count guard, and schedule callers are unchanged. `ScheduleHelper.TryGetFamilyIdsMatchingFiltersAnyType` only distinguishes “field is not schedulable” from a valid empty result for the Family Foundry union. It preserves the established eight-filter limit and itemized schedule evaluation. `FamiliesMatching` preserves the missing-field refusal when neither evaluator resolves the field for any eligible candidate.

The existing public selector test remains the oracle. Its selected set now carries three `Keep` identities: a local type field, a shared type field, and a local instance field with authored defaults. Both `Equal` and `BeginsWith` must return all three families. The test still covers category identity, name inclusion and exclusion, unplaced families, null conditions, and missing-field refusal.

`dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests -v minimal --no-restore` passed with 0 errors and 129 warnings on the final build. This is compile proof only. No Revit session or native test ran. Wave 25 proves native local type rules and instance type fallback. It does not prove that a newly placed instance receives and exposes the family-authored local instance default. The extended public selector test is the discriminating native probe for that premise and for the mixed-identity union.
## AprilAire selector preservation census - 2026-09-07

The controlled census at `.artifacts/runs/monthly45-selector-census/family-not-found-census.json` proves that the frozen AprilAire E-Series profile authors two exact values with `.rfa` suffixes. The loaded project families are the same stems without `.rfa`; the Top Discharge value also differs by `AprilAire` versus loaded `Aprilaire`. Both families are unplaced, while the profile preserves `IncludeUnusedFamilies: true`, so placement is not the cause.

Historical source does not establish filename normalization as preserved behavior. Immediately before `b578789`, `FilterFamiliesSettings.Filter` passed `Family.Name` directly to `string.Equals`, `Contains`, and `StartsWith`; all were case-sensitive and none removed `.rfa` (`source/Pe.Revit.FamilyFoundry/BaseProfile.cs` at `b578789^`, lines 105-173). The `b578789` rewrite accepted only `PatchSelect.Names` with `StringComparer.Ordinal`, also without extension normalization (`source/Pe.Revit.FamilyFoundry/Apply/FamilyModelBuild.cs` at `b578789`, lines 49-62). The later selector restoration kept ordinal comparisons for equal, contains, and prefix (`ff4470a`, current `FamilyModelBuild.cs:113-121`). The converter correctly retains the two authored values; no adapter lost a prior normalization step.

No selector code or frozen profile changed because source cannot choose between family-name semantics and file-name semantics. The other ten absent-family selectors and `__CURRENT_FAMILY__` remain distinct applicability cases.

Open product ruling: should all `IncludeNames` and `ExcludeNames` entries use Windows family-file semantics (remove a terminal `.rfa` and compare case-insensitively for equal, contains, and prefix), or should only exact `Equaling` entries accept `.rfa` and case differences while `Containing` and `StartingWith` retain case-sensitive `Family.Name` semantics?

## Actual browser route readiness - 2026-09-07

**BLOCKED before Family Foundry data loading.** Chrome opened the real Host pages at
`http://127.0.0.1:52068/family` and `/families` against controlled session
`ff-profile-proof-25`. The Instances page rendered the controlled session and its active
`Old_Template-monthly45-disposable` project, but clicking either row could not create valid route
state. Both Family Foundry routes consequently rendered `no document named - pick a document in
chat, or open one from /instances`; neither profile list nor the `/families` project census mounted.

The live identities agree before the route-state seam: `/host/status` reported connected Host PID
92360, source root `Pe.Tools-family/source/pe-tools`, contract 37/20, and runtime
`pe-host-ts/v25.7.0`. The SDK refresh receipt reported controlled Revit PID 89376, generation
`20260907143006678`, build stamp `5a97a1ff24c0`, and the exact disposable project. `/instances`
rendered the same PID, session, custody, year, active document title, and path. No lifecycle or
document operation was invoked.

The blocking seam is deterministic in current source. `instancesDocumentSchema` requires
`selectedSession` and `staged.session` to match `session:<id>`
(`packages/agent-contracts/src/instances.ts:3-12`). The live table instead persists
`worldTrunk.option(world).id` directly for both fields (`apps/web/src/instances/cluster.tsx:181-186,
219-228,501-503`). For this controlled world that value is `ff-profile-proof-25`, so the route store
reports `selectedSession: Invalid input` or `staged.session: Invalid input`. Clearing the stale
`session:takeoffs-25` state and selecting the current session again reproduces the same refusal;
this is not stale-browser residue. The smallest repair is to make the Instances writer use the
existing SDK selector grammar at this one boundary, then retain `worldTrunk`'s raw target id for
Host targeting elsewhere.

Browser screenshots were captured through CUA for `/instances`, `/families`, and `/family`. The
CUA surface returned PNG bytes and displayed them in the run, but exposes no filesystem write in
this session, so no local PNG is claimed. Browser logs contained only Vite connect/connected debug
entries and no warning or error. Raw identity, state, route, and console observations are in
`.artifacts/runs/browser-20260906-ff/actual-route-readiness-6620376/receipt.json`.

Unproven because of this blocker: composed profile rendering, profile selection, loaded-family
census inside `/families`, and every Plan/receipt/recapture path. No Apply was attempted. The
pending name-filter product question above remains pending and no selector behavior changed.

## Actual browser repeat after selector repair - 2026-09-07

Root `6eb667d` was loaded by the existing source Host at `http://127.0.0.1:52068` without a Host or
Revit restart. `/host/status` remained connected at PID 92360 with source root
`Pe.Tools-family/source/pe-tools`; `/instances` rendered controlled `ff-profile-proof-25`, Revit PID
89376, and the exact open `Old_Template-monthly45-disposable` path.

The selector repair is **PROVEN in the actual browser**. Clicking the controlled session produced
no `selectedSession` validation error. Clicking the existing document row produced the staged card
`open Old_Template-monthly45-disposable in ff-profile-proof-25` with an enabled Open button and no
`staged.session` validation error. Open was not pressed, so the browser sent no document or native
operation. The selected session and staged document remain intact rather than clearing concurrent
state.

The next blocker is standalone Family Foundry scope binding. `/family` and `/families` still render
`no document named`. This is separate from Instances state: `RouteScope` accepts only the page's
`?doc=&target=` search or a chat thread Head (`workbench/route-scope.tsx:18-47`), while
`familySearch` and `familiesSearch` omit the existing `routeScopeSearch` parser
(`routes/family.tsx:15-29`, `routes/families.tsx:17-26`). Instances staging deliberately writes only
its route document and does not name either Family Foundry page's scope. The existing Takeoffs
route demonstrates the shared parser at `routes/takeoffs.tsx:9-12`.

CUA captured visible screenshots of the staged Instances card and both fail-closed Family Foundry
pages. Its current browser API displayed the PNGs but did not provide a filesystem writer; the
browser clipboard remained user-owned and was not overwritten. Browser console errors and warnings
were empty. Structured evidence is
`.artifacts/runs/browser-20260906-ff/actual-route-readiness-6eb667d/receipt.json`.

Profile rendering, `/families` project census, and native plan/receipt flows remain unproven. The
proof owner's monthly plan was still nonterminal, so no direct `?doc` binding was attempted because
mounting the live stores can read Revit. No lifecycle, Apply, native request, or document mutation
occurred. The name-filter product question remains pending.

## Explicit scope browser wait - 2026-09-07

Root `d7016d4` contains the shared scope-parser repair. Source inspection confirms both
`familySearch` and `familiesSearch` now spread the existing `routeScopeSearch`, preserving their
thread, fixture, and capture keys. The isolated implementation proof passed both actual route test
files, 4/4 tests total, and targeted `vp check` passed all four changed route/test files.

The explicit-URL browser repeat did not start because P's authoritative
`monthly45-host-plan-6/monthly-host-proof.json` remained `status: running` with 20 profile rows. A
bounded recheck at `2026-09-07T14:54:05.2212612Z` found the same nonterminal status and the artifact
had not advanced since `2026-09-07T14:50:42.6402708Z`. Mounting either live Family Foundry store can
enqueue Revit reads, so the browser stayed off `?doc=&target=` while that queue was unresolved.

The existing browser state remains selected on `ff-profile-proof-25` with the exact disposable
document staged; Open was not pressed. No Host request, native call, lifecycle action, Apply, state
clear, or document mutation occurred. Raw wait evidence is
`.artifacts/runs/browser-20260906-ff/actual-route-readiness-d7016d4/wait.json`. Actual profile and
project-census rendering remain unproven until P records a terminal queue receipt.
