# Family Foundry completion map

Current effort: 2026-09-07. Integration is `Pe.Tools-family`, branch `family/rewrite`.
Product rulings live in [LEDGER.md](LEDGER.md). Sweep this map when the effort closes.
Nothing is merged to main or published. No whole user story is closed yet.

Budget posture revised by user: Sol medium/high for bounded work; Opus high when useful;
Astra low only occasionally for difficult decisions. Retain and resume primed sessions on
cheaper models. No parallel Astra. Every dispatch has a deliverable and time box.

Latest checkpoint: fresh controlled wave10 at `4200a91` ran 108 tests: 68 passed,
40 failed; company cases 10/45 passed. The strict converter now exposes unsupported
active operations instead of omitting them. Owned Revit exited, zero quarantines remain,
and native settings were restored byte-for-byte. Formula canonicalization and its rollback
regression plus the wall-template census are integrated at `dc524dd`, not yet native proven.

Current bounded dispatch: Sol medium owns cloud-template mechanical-family value benchmarking
in the proof tree and the sole Revit lifecycle lane. Sol high repairs the three company literal
failures in the normalization tree. Sol medium implements legacy plane/dimension conversion
in `Pe.Tools-ff-convert`. No integration source hold is active; benchmark bytes are isolated.
Integrated `09a19a3` permits explicit NoTransaction ownership and repairs script loading:
R25.Tests compile passes, and ScriptPolicyAnalyzerTests pass 3/3 deterministic. Native script
execution remains owed. `64c9239` fixes empty explicit rename sources; native proof is owed.
`ae8021f` exposes curve and alignment diagnostics without masking either alignment attempt.

Final simplification must redistill state, contracts, compilers and serialization while
retaining all features and native acceptance. The takeoffs review was sent here by mistake
and is outside this effort, as corrected by the user.

Latest integration `bf9f321` includes pressure/weight literal conversion, legacy plane/dimension
conversion, and existing execution options beside the desired patch. R25.Tests compile passes
(0 errors, 120 warnings); these changes still await native proof. The solids conversion and
electrical normalization design are the current converter frontier.

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

## Checkpoint at 2026-09-07 07:03 UTC

Native integration `897872a` compiles Pe.Revit.Tests for R25 (0 errors, 119 warnings).
Web/Host receipt and Apply eligibility changes are integrated in `b56b452` (agent checks 39/39).
SDK candidate `0.1.0-beta.151.ff.1` is a complete eleven-package graph from SDK `8fe90de`.
Integration pins CLI and SDK together; all receipt hashes were checked before copying.
R24 and R26 FamilyFoundry compiles now pass, resolving missing-companion/fallback failures.
R23 FamilyFoundry also compiles after replacing the NET48-incompatible DistinctBy call.
The candidate is local to this branch/feed; no installed-product update or publication occurred.

Fresh controlled wave 7 (`3dc0dcb`): 25 passed, 22 failed / 47. Lookup full roundtrip,
nested dependency save/reopen, portable values and native scope defaults pass. All four
geometry showcase roundtrips remain red. Native shared creation passes 4/4 with its temporary
file active and fails 4/4 without it. The shared TempSharedParamFile lifetime is now repaired.
Latest source also repairs GUID token parsing, non-labelable dimension reads, batch label value
preservation, geometry loop ordering, closed bound circles, room-point disable and form view flags.
Those repairs compile but await the next fresh acceptance. No geometry acceptance is inferred.

SDK custody is valid in wave 6 diagnostic, wave 6 functional and wave 7: exact child identity,
settings restoration and cleanup. Wave 5 wrongly claimed pre-existing PID 80052; it exited and
its exit cause remains unconfirmed. Do not describe that process as preserved.

The `/family` + `/families` session is controlled `ff-route-25`, dev snapshot generation
`20260907062428752`, build stamp `ed915890270c`, source `ca353e9`. It runs SDK151.ff.1
payload dependencies. P owns lifecycle and document activation; R owns browser interaction.
Actual `/family` browser Apply and native independent readback passed: Width 42 inches,
shared count 7 with the expected GUID, and old source removed. Fleet Apply committed the same
changes, but its response failed by reading an invalid pre-load Family object. Native receipt
and independent readback recovered success; the original Apply must not be replayed.
An open same-name external family editor also contaminated project Plan through title-based
reuse. Both shared-owner fixes and a native bridge regression test are now integrated, awaiting
fresh proof. The next browser run uses new disposable paths and keeps unknown-outcome evidence.
Root source edits do not refresh this immutable session.

All 45 frozen company profiles now compose, including reconstructed Dehumidifier and AprilAire
inline override. All 52 original fixture files preserve their original bytes in Git; a scoped
.gitattributes rule prevents newline normalization. OneDrive originals remain unchanged.
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

- P: complete R's actual route session; then wave 8 acceptance on a declared source hold.
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

- User `pe.app-25` PID71484 and other pre-existing PID86872 are protected; re-read identity before
  runtime work. No FF mutation may target either.
- Main has concurrent Space/Partition/takeoff/web changes. Never broad-stage, reset or overwrite it.
- Old_Template.rvt SHA256 `8107AD50ADBD7BB9866287F0C8DB9168FD88ABE3132206356B717E24F2EE46B1`.
- Downloads `MEP_Architect_Project Name_R25_Copy_2025.07.11.rte` is the user's likely old clone.
  Both original documents remain unchanged; proof opens disposable copies.
- OneDrive Documents/Pe.Tools settings and workspaces are in scope. Convert/check copies before
  replacing active standards. The cloud template is already migrated.
