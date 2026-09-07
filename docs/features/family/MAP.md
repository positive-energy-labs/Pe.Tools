# Family Foundry completion map

Current effort: 2026-09-07. Integration is `Pe.Tools-family`, branch `family/rewrite`.
Product rulings live in [LEDGER.md](LEDGER.md). Sweep this map when the effort closes.
Nothing is merged to main or published. No whole user story is closed yet.

Wave25 at 3a64a1b ran five fresh controlled Revit 2025 checks: metadata and whole-family
rollback passed; three diagnostic cases failed. LinearArray.Create is the exact first call
that overwrites Type A with current Type C values. Native pipe Demand plus regeneration
enables Fixture Units association for cold/hot/sanitary connectors. Local Keep values exist
on symbols and native filters select correctly, but no schedulable field exposes them.
PID88932 exited with exact settings restoration, empty quarantine, and protected identities
preserved. Raw evidence: Pe.Tools-ff-proof/.artifacts/runs/wave25.

Demand support is integrated at 149a556/61d28ba; full bath apply/reopen acceptance remains owed.
The array prevention control and mixed local/shared/instance selector repair are integrated
through 87cee69; their native acceptance remains owed. Controlled dev snapshot
ff-profile-proof-25 PID108004, generation20260907140624373, runs immutable source915790e
against the disposable old template. Newtonsoft support now allows public FF conversion in
scripts. The monthly45-host-plan-4 artifact contains all45 profiles: nine conversion failures
and36 converted requests rejected with PatchJsonRequired. These are request admission failures,
not evidence of missing families. P is tracing the shared request path; N owns conversion
failures. No Apply ran. The snapshot quarantine remains leased until stop. Restart lost the
previous quarantine policy; isolated SDK candidate cf98d13 repairs hold precedence and passes
focused deterministic vectors, but native restart acceptance remains owed.

Request binding is repaired at9ba0234. Corrected monthly45-host-plan-5 completed45 profiles:
24 native Plan exceptions for empty parameter group, eight conversion failures for empty/Other
group, one conversion FormatOptions failure, and12 FamilyNotFound results. No Apply ran.
N owns shared group identity and literal conversion; P is checking the12 selectors against
loaded families, then proving NoTransaction script/library ownership on the current snapshot.
The next required refresh can test isolated SDK f59ceb7 without changing installed SDK state.

Wave24 at 2ce664d ran two fresh controlled Revit 2025 checks; both failed. Matrix values
are correct after each seed and before topology, then Type A takes Type C values during
topology construction. SaveAs/reopen/load do not introduce that first change. P is bracketing
the individual native topology calls. The plumbing control failed on datum reconciliation
before creating connectors; N is replacing its FF-built baseline with direct native setup.
Owned PID40944 exited, settings restored exactly, quarantine is empty, and protected start
identities are unchanged. Evidence: Pe.Tools-ff-proof/.artifacts/runs/wave24.

Integrated fdb7948 carries execution options through Host and both route plans/applies.
The shared contract lives in Pe.Shared.RevitData.Families; native FamilyVisitOptions remains
separate. OptimizeTypeOperations and SuppressWarnings affect reconciler behavior and hashes.
SingleTransaction remains meaningful for public multi-operation queues, not a single reconciler
operation. EnableCollectors still controls optional caller pipelines; Host capture is mandatory.
The monthly Host driver is integrated; actual 45-profile Host proof remains owed. Installed
Host lacks FF operations, so this proof must use a current controlled dev snapshot and its Host.

Wave23 at 81f486f ran six fresh controlled Revit 2025 checks: three passed, three failed.
Production schema capture, all seven metadata cases, and connector-host capture after reopen
passed. The selector, positive value matrix, and GRD pre-array checks failed. Native matrix
stage evidence shows Type A already contains Type C values before normalization; fixture
creation/topology/save/load is the next boundary to diagnose, not a guessed migrator repair.
Owned PID102556 exited, quarantine is empty, native settings restored exactly, and protected
71484/98976 start identities were preserved. The source hold is released. Evidence is
Pe.Tools-ff-proof/.artifacts/runs/wave23/run.json, cleanup-verification.json, and retained
matrix-value-stages.json. No TRX was found; adapter.log contains the exact failures.
The selector reaches the real condition but ScheduleHelper applies fewer filters than requested.
Its local Keep field may be unschedulable; N owns verifying parameter coverage without weakening
the fixture.
Pipe association prerequisite probes are integrated at 1303533; they isolate native flow
configuration from unrelated bath geometry and leave the full bath acceptance intact.

Wave22 at 866a7aa ran 11 checks, 5 passed and 6 failed.
Extraction parity, schema evidence, exact-alias refusal rollback, invalid-matrix rollback,
and connector-host identity probe passed. Raw internal parameter schemas contain descriptions
under constants entries with id=description; N owns the production reader correction.
Native host dependencies distinguish coincident plane/nested-face connectors. Integrated
d2b40a2 reads native description constants and 129e1a5 replaces geometric host inference
with native dependencies. Their production readback/reopen checks await wave23. Integrated
fbd2aca records native matrix values before normalization, after normalization, and after
value application; no production value fix is justified until the first bad stage is known.
Matrix per-type values, GRD spacing before arrays, Fixture Units
association, selector fixture instance filtering, and metadata readback remain red.
PID 97760 exited, native settings restored exactly, and protected identities were preserved.
Evidence: Pe.Tools-ff-proof/.artifacts/runs/wave22, including TRX and cleanup verification.

Wave21 at 141877b ran eight independent native checks: 0 passed, 8 failed.
Installed API metadata identifies GetParameterSchema as internal: the public reflection
lookup cannot find it. Integrated 3294fbb retains parameter rows on optional tooltip errors
and blocks reconciliation on incomplete required-field capture. Internal schema invocation
was subsequently proven in wave22 and adopted at d2b40a2. Other-year runtime compatibility
and integrated tooltip acceptance remain unproven.
Selector fixture naming (0fdf8f7), pipe Fixture Units identity (dd67073), and explicit
NotAReference capture (4f4ca9e) are repaired in source. Native acceptance remains owed.
Exact integrated Debug.R25.Tests compilation at 4f4ca9e passed with 0 errors/129 warnings.
The separate join diagnostic recorded no failures and did not establish a native warning ID.
Both SDK-owned processes exited, settings were restored exactly, and protected sessions
71484/98976 retained their identities. No source hold remains from these runs.

Conditional selection is integrated at af051b7 using the existing native schedule evaluator,
including null/omitted condition semantics. Native acceptance remains owed. SDK exact-target
candidate c21da71 and adapter d838f46 use immutable local package 1.11.1-pe.target.2;
safe preflight is proven, native multi-process targeting is not yet accepted. The rebuilt
console is unsigned; adapter discovery requires Authenticode trust. P is checking existing
configured signing support without altering trust or bypassing signature validation.

Compile portability at e44aa8e: Pe.Revit.FamilyFoundry builds successfully for Debug.R23
and Debug.R24 (net48, 161 warnings each) and Debug.R26 (net8.0-windows7.0, 74 warnings).
MSBuild property reads independently confirm each RevitVersion and output configuration.
Together with the Debug.R25.Tests build this covers compile compatibility for all declared
2023-2026 years, not cross-year runtime or full Pe.App/route integration. Evidence is in
Pe.Tools-ff-portability/.artifacts/runs/compile-20260907-portability/r23.log, r24.log, r26.log.

Budget posture revised by user: Sol medium/high for bounded work; Opus high when useful;
Astra low only occasionally for difficult decisions. Retain and resume primed sessions on
cheaper models. No parallel Astra. Every dispatch has a deliverable and time box.

Latest focused native checkpoint: wave19 at e44aa8e ran 21 cases: 10 passed and 11 failed.
Explicit Phase-to-poles connector routing and exact destination alias materialization passed.
Parameter metadata, matrix rollback evidence, bath placement/capture and GRD residue remained red.
The parameter repair is integrated at 54cce83; exact Debug.R25.Tests compilation passed with
0 errors and 129 warnings. Its schema-based tooltip capture and tightened rollback checks
still require native proof. Native group ids replace invalid Geometry labels in the fixtures.

Wave20 at 0247a29 reached the real MSZ-GL join-loss warning and stalled in its modal dialog
until SDK timeout. No TRX or NUnit verdict was produced; connector-host and selector checks
remain unproven. PID 77028 exited through SDK cleanup, settings restored byte-for-byte,
and protected PIDs 71484/98976 retained their identities. The source hold is released.
P owns the isolated handler diagnosis; N owns nested placement before alignment.

Attached proof is suspended: the SDK previously dispatched to protected PID 71484 instead
of selected PID 98840. Both tests failed during type loading before their mutation bodies.
The exact PID/start adapter repair is isolated in Pe.Revit.Sdk-ff-targeted; old/stale adapter
refusal and native targeting acceptance remain required before attached tests resume.
Full monthly-profile planning remains 0/45 because the fresh installed Pe.App lacks the method.
R prepared a public Host driver at 6e70c49 to remove that adapter dependency. It exposed
13 profiles whose authored ExecutionOptions do not reach Host Apply. R owns tracing and
closing that contract gap while preserving full-family rollback. No monthly Host run is claimed.

Latest broad native checkpoint: fresh controlled Revit 2025 wave13 at `4a97297` ran
123 tests: 84 passed and 39 failed. Runtime discovery included the new circle test.
Wave12 reused stale Debug.R25.Tests binaries because root compiled Debug.R25 and passed
--no-build. Wave12 does not prove its stated source. Wave11 remains valid for 5531460.
The corrected wave13 built the SDK-selected Debug.R25.Tests graph before execution.
Both owned processes exited and native settings were restored byte-for-byte.
Protected sessions retained their exact start identities. No FF-owned session is active.

Integration includes cap-alignment capture, one-use structural matching, wall view vocabulary,
typed type/parameter cell identity, tooltip repeat handling, independent array seeds, native
formula ownership and scoped N/A handling. Exact Debug.R25.Tests compile passed at d460bf8.
Wave15 measured 56/81 old-template mechanical families: 28 passed, 28 rolled back, then timeout.
Wave16 at d460bf8 measured the remaining 25 plus four focused repeats: 11 passed, 18 rolled back.
All 81 now have an attempted mapping result; this is not full monthly-profile acceptance.
Wave16 native MSZ-GL proves the inherited formula-unit fix. Magna3 advances past N/A to a
separate Phase source value `Single` conversion refusal. Connector pole associations targeting
numeric Phase are diagnosed; user ruled explicit routing to PE_E___NumberOfPoles instead.
Wave16 also exposed a join warning during MSZ-GL: parameter success does not prove untouched
geometry. P owns the preservation investigation. Originals and protected sessions were preserved.
The checkpoint sharing repair survived both subsequent runs. No source hold is active.
No whole user story is closed. Route browser receipt proof and native scripting remain owed.

Final simplification must retain features while reducing state, contracts and serialization.
The takeoffs review was sent here by mistake and remains outside this effort.

## Completion contract

- Explicit JSON specifications are manifested; unmentioned content stays untouched.
- Bulk parameter migration is the primary gate. Geometry and unfinished features remain in scope.
- Each family completes or rolls back; successful batch siblings persist.
- No ExtensibleStorage or persistent roundtrip metadata. References and sidecars may travel.
- Apply does not save existing documents; save/export is explicit.
- `/family`, `/families`, Pea route-state authoring and public script/Pod primitives must agree.
- Restore meaningful deleted tests at the highest surface. Green by deleting coverage is rejected.
- Destination wins: rewire source references and remove the source, or roll back the family.
- Shared fragments merge by field, later values win; profile fields override their preset.
- Measurable authored literals require units. Number/Integer stay unitless.

## Route and corpus checkpoint

Earlier `/family` browser Apply plus independent native readback passed on `ca353e9`.
Fleet mutation committed, but its response read an invalid pre-load Family object. Reacquisition
and receipt fixes are integrated; a new browser proof is owed. The old route session is stopped.
NoTransaction policy passes 3/3 deterministic; native script execution remains owed.
All 45 company profiles compose. The 52 original fixture files retain their original bytes.
The old-template 38-definition mapping gate ran across all 81 mechanical families and remains
distinct from full profile migration. Full-profile selector/plan acceptance is under review.
Pea settings open/create/refresh now return authored and composed JSON (1ad0378); the settings
command chain passes 5/5 deterministic tests. Actual Pea and route runtime proof remains owed.
Reports: [values](PROOF-VALUES.md), [normalization](PROOF-NORMALIZATION.md), [routes](PROOF-ROUTES.md).

## User stories and remaining proof

| Story | Remaining highest-surface evidence |
|---|---|
| Author one portable family | Native JSON + sidecars create on every supported year; no machine-specific paths |
| Bulk normalize a model | Old unmigrated template, all company profile behaviors, exact shared identities, type values, references, connectors and room points |
| Audit/manage a project's families | `/families` live snapshot, selection, plan, apply, drift, failure, repeat and receipts |
| Ask Pea to author a family | Pea changes actual route state through current capability/scope/target contracts |
| Normalize third-party electrical content | Text-to-measurable mapping, destination precedence, explicit writes, safe association transfer |
| Use FF from scripts/Pods | Public one/many-family operations, targeting, transaction ownership and project load-back |
| Reapply a changed specification | Preserve extras, add connector, change explicit values, subsequent run has no changes |
| Trust partial batch progress | Failed family fully unchanged, successful sibling persisted, actionable receipt |
| Roundtrip supported content | Capture/rebuild/reopen plus independent authored-intent and geometry perturbation checks, no stored metadata |

## Dispatch and primitive frontier

- P: run the next native acceptance on a declared source hold, then restore route proof.
  If shared/migration basics pass, run the full old-template mechanical-family acceptance.
  That full corpus test has never run; the current 38-definition mapping is not all 45 profiles.
- N: native parameter/source/association repairs; all-profile operation coverage and conversion;
  native room-point parameter-binding investigation. Explicit rejection of an offset binding
  is an interim honest boundary, not feature closure. Correct visibility test to exclude untouched
  connector/template support geometry.
- R: actual route Plan/Apply/receipt/no-op journeys; shared-fragment edit origin, native dependency
  composition, Pea authoring and durable scope/target integration. Fixture browser proof is separate.
- Root: geometry identity/capture and native value preservation acceptance. Symbolic connected-loop
  capture/application and exact capture-derived deletion are implemented and compile, not yet native
  proven. Generated names retain no metadata. Two symbolic roundtrips exercise visibility and geometry.
- Root: connector support extrusion capture/rebuild and raw macro-profile reapply. Inspect the actual
  composed route payload: applying a raw Prism to already expanded captured geometry may collide with
  generated planes or inherit incompatible extrusion fields. No workaround or feature waiver adopted.
- Root/P: circle/ref-line constraints, arrays, connector orientation/association and physical geometry
  perturbation. Four self-consistent roundtrips alone do not prove authored intent.
- Root: supported-year compilation/runtime and native sidecar availability; cross-year script/Pod
  consumer checks; final combined Host/web/C# checks and exact SDK adoption evidence.
- Root: census old frames-era/deleted test intent and all shims; preserve unruled feature coverage.
- Root: inspect concrete Space/Partition, targeting/chat and SDK-main deltas at their consumer seams.
  Concurrent source is protected, not a reason to waive integration.
- Final: feature census before/after; architectural/behavior-change tally; fold ledger and reports;
  retire only this effort's spent state and integrate coherent proven changes.

## Value strategy evidence

Fresh controlled Revit2025, proof `39cde8f`: 12-type Mitsubishi family, five specs, three repetitions,
zero commit/reopen mismatches. Median mutation: batched setters 4867.7ms, prepopulated-source formulas
924.3ms, temporary selector 4133.7ms. Selector setup/cleanup included; source seeding excluded.
No selector optimization adopted. New numeric values are raw zero; blank writes do not restore unset.

## Protected state

- User `pe.app-25` PID71484 and other pre-existing PID98976 are protected; re-read identity before
  runtime work. No FF mutation may target either.
- Main has concurrent Space/Partition/takeoff/web changes. Never broad-stage, reset or overwrite it.
- Old_Template.rvt SHA256 `8107AD50ADBD7BB9866287F0C8DB9168FD88ABE3132206356B717E24F2EE46B1`.
- Downloads `MEP_Architect_Project Name_R25_Copy_2025.07.11.rte` is the user's likely old clone.
  Both original documents remain unchanged; proof opens disposable copies.
- OneDrive Documents/Pe.Tools settings and workspaces are in scope. Convert/check copies before
  replacing active standards. The cloud template is already migrated.
