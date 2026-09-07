# Family Foundry value-write proof

PROVEN in fresh controlled Revit 2025: the adapter runs, all three value strategies preserve the tested values through save/close/reopen, and the existing uniform helper's temperature precision defect is repaired. No selector optimization is adopted.

Latest checkpoint: **wave4-formula: 2 tests, 1 passed, 1 failed**. Per-formula regeneration did not repair the lookup zero and was removed in **a9c66e1**. Dimension diagnosis proved regeneration before NewLinearDimension sufficient in all six trials. Five runtime assembly hashes/MVIDs match; owned PID 45104 exited, native settings restored exactly, protected PID 71484 unchanged. Dependency closure **5f93b79** compiles (0 errors / 117 warnings); runtime tests await root READY. Capture formatting belongs N; geometry fixes belong root.

## Identity and evidence

- Pe.Tools checkout: `C:/Users/kaitp/source/repos/Pe.Tools-ff-proof`, branch `family/proof`. Starting commit `d2e19ce15ec9092018f1c37cfc529c97e8349cd3`; code commit `39cde8f7b48446eab797fe71322aeee9d8901369`.
- SDK repair: `C:/Users/kaitp/source/repos/Pe.Revit.Sdk-ff-proof`, branch `fix/ff-test-adapter`, repair history `c2060f4`, `95311a7`; minimal repair `b1ec99e`, followed by atomic all-callers lease exclusion `ec55df2`. Intermediate scanner commits were removed by the final repair. Created from SDK main `a06eae9563c249a4f00722499a31c4c8b62770d6`; SDK main was not edited.
- Raw evidence: `.artifacts/runs/fresh-20260906-ff/`, abbreviated `runs/` below. `manifest.json` lists files, byte counts, and SHA256. These ignored files must travel separately from git.
- Initial census: `2026-09-07T04:39:55Z`. Intermediate report written `04:43:18Z`, 3 minutes 23 seconds later, retained as `runs/checkpoint-report.md`. Local date was 2026-09-06.
- Protected `pe.app-25`: PID `71484`, start `2026-09-07T04:20:36.3844230Z`, generation `20260907042016813`. The supplied old PID `65356` was stale. No lifecycle or document operation targeted this session.
- No subagents. No authored MAP/LEDGER edits, installed-product edits, original template edits, or original OneDrive settings edits. Root integration commits were merged only when authorized.

SDK `SPEC.md`, `docs/context/NEXT.md`, and `docs/context/DECISIONS.md` are deleted. Current SDK AGENTS routes to ADR 0006, feature ledgers, and `RUNTIME_ACCEPTANCE.md`; these replacements were read. Memory served navigation only. All findings below use current source or captured runtime evidence.

## Adapter root cause and repair

The native Revit 2025 add-in settings had `DisableAllAddIns=false` but `ricaun.RevitTest.Application` GUID `65f304b3-8efb-464d-b08a-12cfd61a1986` had `Disabled=true`. The application bundle was present at version 1.11.1. `runs/adapter-preflight.json` records the row and native file hash.

The two prior test processes corroborate this:

| Process | Descriptor generation | Journal witness |
|---|---|---|
| 62752, start `2026-09-07T01:18:09.7658577Z` | `20260907011801614` | `journal.3608.txt:1343`, `Jrn.DisabledUserAddIn` for the adapter |
| 49172, start `2026-09-07T01:34:20.3563595Z` | `20260907013404900` | `journal.3610.txt:1363`, same disabled adapter |

Both processes recorded installed Pe.App 0.6.26 startup and bridge readiness in their `.events.jsonl` files. The saved `prior-failure.json` contains null test counts after a 900-second wait, not completed failed assertions. Its envelope does not identify which of the two process incarnations it belongs to. Redacted bridge descriptors retain process/session identity but omit bearer tokens.

The initial and independent root censuses found no active quarantine hold. During the repaired diagnostic, the only current hold belonged to our PID 42800, matching its launch receipt. Its saved Original already disabled the adapter. The previous writer is unknown. The SDK quarantine policy excludes ordinary third-party adapters, but that policy alone does not establish who last wrote the persisted setting.

SDK changes reuse `AddinQuarantine`, not an independent settings writer:

- `AddinQuarantine.Acquire` accepts a required adapter GUID, refuses overlapping leases, enables that adapter, and preserves unrelated effective settings. It handles global-disable state without enabling unrelated rows.
- `TestCommand.RunFresh` acquires before launch and stamps the actual child Revit identity. The shared lease records the actual CLI PID/start/executable until transfer. Sweep looks for a surviving descendant Revit before checking launcher death; transferred child custody survives parent exit. There is no permanent awaiting exemption; legacy unstamped holds retain only the existing five-minute launch window.
- No new installed-manifest scanner remains. The supported adapter owns staging/activation and reports its own failure. Missing native settings rows are legitimate; the scoped lease enables an existing required row and clears the global-disable flag.
- `SessionCommand.Stop` restores before retiring the generation. Previously retirement deleted the hold before Sweep could restore it. Both readable and unreadable retirement paths now refuse to delete unresolved holds.
- Restore and owner-stamp failures are exposed. Failed restoration keeps the hold. Mutex timeout refuses access. Test completion propagates a failed stop instead of silently reporting the test outcome alone.

The first diagnostic used the initial repair before the retirement fix was built. It passed, but exposed deletion-before-restore. The owned hold had been copied to evidence. After PID 42800 exited, that same hold was returned to its original generation and the SDK sweep restored it. No native setting was manually edited. Subsequent runs restored automatically.

Focused deterministic vectors cover required enable/restore, unrelated rows, first-load missing row, overlapping lease, global disable, live launcher retention and dead launcher cleanup, retirement refusal, and restoration blocked by an exclusive file lock. See `sdk-minimal-tests.log` and `sdk-minimal-build.log` for final vectors (passed, one existing CS7022 build warning, zero errors); earlier vectors are retained in `sdk-committed-tests.txt`. The review found and corrected case-sensitive JSON field names in the time-aging test itself. A build against the executing Release CLI hit its file lock; `sdk-final-build.log` retains that failed attempt. Rebuilding the free Debug configuration succeeded; the committed Release build later succeeded. No Revit restart was used to resolve a compiler file lock.

## Installed shell versus test bytes

The initial assumption that installed Pe.App made the fresh test unsuitable was falsified by the diagnostic.

`runs/diagnostic-run.json`: fresh, controlled PID 42800, 1 passed / 0 failed. `assembly-load.txt` shows installed Pe.App as the shell, while Pe.Revit, FamilyFoundry, and the test assembly load from the adapter's temporary test directory. `assembly-hashes.json` proves the loaded Pe.Revit and FamilyFoundry DLLs exactly match this checkout's test output:

| Assembly | SHA256, loaded equals build |
|---|---|
| Pe.Revit | `BD767AF99E9341948F4F605397BAA50001BFCC7274FFFFBCB065F7C65ABB3D3D` |
| Pe.Revit.FamilyFoundry | `BF9B9965F9C1AB13A28743108AAF4830BC769481887B853B32111C63282AAB14` |

No payload architecture change was needed. This proves the inspected dependencies, not every possible lazy-loaded dependency. Envelopes identify each answering CLI by path, source version, and SHA256; the first tool was beta.150, subsequent runs used the isolated repaired SDK binary directly.

## Correctness and performance

`ValueWriteExperimentTests.Compare_formula_clear_with_one_batched_type_pass` owns the experiment. It adds five unconstrained type parameters and corresponding source parameters: Length, Number, Integer, HVAC Temperature, Text. Expected values differ by type. Length uses millimetres converted independently to internal feet; temperature includes 0 K. Double tolerance is `1e-9` internal units. Each strategy opens the same saved initial family, commits, saves, closes, reopens, and checks all type/target values, HasValue, formulas, selector absence, and existing constraints.

The source strategy assumes source parameters already contain the data; their initial population is outside its timing. The selector strategy includes its own parameter creation, one population pass through all types, IF construction plus formula set/clear, regeneration, removal, original-current-type restoration, and commit. The baseline performs one outer type pass with all five targets inside. All three totals include transaction overhead and original-current-type restoration. File I/O and verification are outside the timed mutation. Reported switch counts exclude the common final restoration assignment. Phase medians do not necessarily sum to the total median.

### Synthetic family

First sample, 3 types x 5 targets: all 15 reopened values per strategy correct. Totals were baseline 236.39 ms, source 201.45 ms, selector 340.33 ms, including 91.75 ms selector population. `runs/value-experiment.json` retains this sample. Its enclosing test failed later because a cached FamilyManager wrapper became invalid after transaction rollback. The harness now reacquires it; `synthetic-2/run.json` passed. This was a harness lifetime defect, not a value mismatch.

### Real mechanical family

Family: `Mitsubishi - Filter Box - FBM_FBL_FBH_Series`, extracted from the disposable Old_Template copy. It has 12 original types, 44 original parameters, and 1,881 collected elements. Selection was by greatest type count among editable mechanical equipment families, not a claim that this is the globally most expensive family.

Final run: fresh controlled PID `67732`, start ticks `639243537592249313`, test session `pe.revit.tests-25-test`. `final/session.json`, `final/launch.json`, and `final/quarantine-2025.json` preserve custody. `final/run.json` reports 1 passed / 0 failed. Nine comparisons, 3 repetitions per strategy with alternating order, checked **540 values after reopen with zero mismatches**. The same 540 values were also captured after commit. All nine checks preserved existing formulas and association IDs, refused the three associated parameters as write targets, and removed the selector.

| Median phase, milliseconds | Batched pass | Source formula/clear | Selector formula/clear |
|---|---:|---:|---:|
| Selector creation | n/a | n/a | 21.71 |
| Selector population | n/a | n/a | 2797.57 |
| Writes / formula construction + set/clear | 4756.55 | 823.07 | 1164.88 |
| Explicit regeneration | 0.05 | 0.05 | 0.10 |
| Cleanup / current type restoration | 78.34 | 79.69 | 119.72 |
| Commit | 32.61 | 21.31 | 34.11 |
| **Total** | **4867.69** | **924.30** | **4133.67** |

Total samples, ms: baseline `[4797.82, 4867.69, 5115.77]`; source `[924.30, 885.42, 996.27]`; selector `[4547.46, 3956.92, 4133.67]`. Raw phases and values: `final/value-experiment.json`; derived medians: `final/timing-summary.json`.

The preceding real-family run also passed 540 reopened values, with total medians 6848.96 / 951.40 / 3480.82 ms. The final run's selector improvement over baseline is about **15%**, versus about 49% in the preceding run; the synthetic selector was slower. That variability, one real family, and unconstrained new target parameters do not support general adoption. Source formula/clear is promising when compatible source parameters already exist. No source-population cost is hidden in a selector comparison.

## Unset, failure, and precision findings

- Injected failure after selector creation and one partial formula write rolled back exactly: original target state and current type restored; selector absent. It is a rollback proof, not a commit/reopen proof of a partial failed transaction.
- New Number, Integer, and Temperature parameters added to the populated family immediately had `HasValue=true` and raw zero. Explicit zero and formula clearing left HasValue true. Empty-string writes were rejected and did not create blank state. These observations cannot distinguish user-entered zero from a newly added default zero. Restoration of a truly unset numeric value remains unproven because this family did not expose one.
- The original `TrySetUnsetFormula` returned true for 0 K but wrote `-0.1833333333333245 K` in `synthetic-2/value-experiment.json`. Document display formatting rounded the literal. The helper's two callers are global assignments in `SetParamValues.cs` and `PracticalBenchmarks.cs`.
- `FamilyDocumentSetValue.FormatMeasuredValue` now uses round-trip invariant Number text, a valid high-precision format for measurable specs, and a parse-back accuracy check before formula mutation. A lossy/unrepresentable literal is refused so existing callers can use their per-type fallback. Formula-clear failure now returns its diagnostic.
- Final runtime proof accepted all five uniform-value probes correctly. Length error was about `8e-15` feet; temperature error was about `6e-14 K`. The separate 0 K write read back exactly zero. These uniform probes are in-transaction read-back; the three strategy comparisons supply commit/reopen proof. Other measurable specs, cultures, and quoted/escaped string contents remain unproven.

## Fixtures and commands

Original Old_Template SHA256: `8107AD50ADBD7BB9866287F0C8DB9168FD88ABE3132206356B717E24F2EE46B1`. `scale/template-copy.rvt` was copied and hash-verified before opening. Original download `.rte` SHA256: `29D1D3CC2A4DAB9FDFCA18655479BE55604E05A301E68AEEEF1753E4350B9B37`, 190459904 bytes; it was not opened and its migration status remains user testimony.

Commands ran from the Pe.Tools proof checkout unless a working directory is named:

```powershell
# SDK checkout creation; SDK main remains untouched.
git -C C:/Users/kaitp/source/repos/Pe.Revit.Sdk worktree add -b fix/ff-test-adapter C:/Users/kaitp/source/repos/Pe.Revit.Sdk-ff-proof a06eae9563c249a4f00722499a31c4c8b62770d6
# In the SDK sibling:
dotnet build source/Pe.Revit.Loader.Tests/Pe.Revit.Loader.Tests.csproj -c Release -nologo
dotnet source/Pe.Revit.Loader.Tests/bin/Release/net8.0-windows/Pe.Revit.Loader.Tests.dll --addin-quarantine
# In the Pe.Tools proof checkout:
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests -nologo
$cli = 'C:/Users/kaitp/source/repos/Pe.Revit.Sdk-ff-proof/source/Pe.Revit.Cli/bin/Release/net8.0/Pe.Revit.Cli.dll'
dotnet $cli test --project source/Pe.Revit.Tests/Pe.Revit.Tests.csproj --year 25 --filter FullyQualifiedName~AssemblyLoadDiagnosticsTests --timeout-seconds 120 --plan --json
$env:PE_FF_PROOF_OUTPUT = (Resolve-Path .artifacts/runs/fresh-20260906-ff/sdk-final-runtime).Path
dotnet $cli test --project source/Pe.Revit.Tests/Pe.Revit.Tests.csproj --year 25 --filter FullyQualifiedName~AssemblyLoadDiagnosticsTests --timeout-seconds 120 --no-build --json
$env:PE_FF_PROOF_OUTPUT = (Resolve-Path .artifacts/runs/fresh-20260906-ff/final).Path
$env:PE_FF_PROOF_PROJECT = (Resolve-Path .artifacts/runs/fresh-20260906-ff/scale/template-copy.rvt).Path
# The final matrix used the Debug build of the repaired SDK while Release was rebuilt.
dotnet C:/Users/kaitp/source/repos/Pe.Revit.Sdk-ff-proof/source/Pe.Revit.Cli/bin/Debug/net8.0/Pe.Revit.Cli.dll test --project source/Pe.Revit.Tests/Pe.Revit.Tests.csproj --year 25 --filter FullyQualifiedName~ValueWriteExperimentTests --timeout-seconds 240 --no-build --json
```

Initial beta.150 help/guide and plan are saved separately. No raw dotnet test, direct Revit lifecycle command, new warning suppression, persistent metadata, or ExtensibleStorage was used. Build warnings remain visible in complete logs; compile success is not substituted for runtime proof.

## Integration result and final custody

The initial integration command began **05:05:12 UTC** against `540154e31ac244b8b4a4c97f20356812bbf02dbd`. Build completed; my new manifest preflight then failed before Revit on an XML encoding declaration (`integration/preflight-red.json`). That scanner was unnecessary. Final SDK `b1ec99e` removes it and its tests, restores InstallCommand exactly to its pre-wave content, and leaves adapter staging to the supported test runtime. Scoped native enable/restore, absent-row support, live CLI identity until Revit transfer, and restore-before-retire remain. Focused final lease checks pass; final build has zero errors and one existing CS7022 warning. No installed file was changed.

The source-fixed integration attempt began **05:08:32.753 UTC**. Fresh controlled Revit PID **25192** started **05:08:38.3002408 UTC**, receipt ticks `639243545183002408`. This completed run used SDK `a68bb862d3fbeb6c82b751a7f343cfd1fde096cd`, binary SHA256 `5A83D4AE158692D42E80074EBAB4DEE85BBEA281DFA7AB7B9D0C5B153A7D80CB`; it predates scanner deletion. Journal 3621:1625?1639 names the integration DLL and 13 cases. TRX finished **05:09:53.179 UTC**: adapter execution **36.648 s**, test summary **27 s**, full TRX interval **78.194 s**. No timeout or rerun of these red tests.

| Outcome | Count | Actual failure / ownership |
|---|---:|---|
| Passed | 5 | Assembly diagnostic; stale-plan refusal; rollback with single transaction true and false; named-plane reapply |
| Four authored fixture cases | 4 failed | Null UIApplication in TestCase method at `FamilyModelRoundtripTests.cs:39`; root owns repair. Geometry roundtrip was not reached. |
| Explicit values and caller transaction | 2 failed | Zero capture differences, three pending entries at `ReconcileFamily.cs:94`. `FamilyProcessingContext.cs:38` clones intermediate logs; convergence checks every historical pending snapshot at `ReconcileFamily.cs:92`. Normalize owns final-state accounting repair. |
| Next family succeeds | 1 failed | Receipts `[false,false]`, expected `[false,true]`; likely same convergence accounting, not independently proven. |
| Lookup replay | 1 failed | Zero capture differences, eight pending entries; same historical pending check. |

Evidence: `integration/results.json`, `integration/kaitp_KP-PC_2026-09-07_00_09_20.trx`, `integration/journal.3621.txt`, and copied fixture outputs. CLI FailedTests additionally captures two log lines starting ?Failed to process?; the TRX has exactly eight failed test rows.

**Assembly verification:** the final proof diagnostic in PID **5560** passed. `sdk-final-runtime/assembly-identity.json` proves runtime and build SHA256/MVID match for Pe.Revit, FamilyFoundry, and the test assembly from precision commit `39cde8f`. Pe.Revit MVID is `ab1aa733-a0df-4508-bb69-d29ce864f823`, SHA256 `738357914FC5E5D612E510D6E80B953116A57173174AA5CC99FD9BAD524FE66F`. Integration build hashes/MVIDs are in `integration/build-identity.json`, but its progress-only diagnostic produced an empty TRX Output. Runtime MVID equality for integration is **UNPROVEN**. Root reports the new tree includes durable diagnostic output; next READY wave must set PE_FF_PROOF_OUTPUT and compare its runtime paths/hashes/MVIDs directly. Do not substitute proof-checkout identity for integration identity.

Exact integration commands, from this proof checkout (initial attempt built; repaired attempt reused that unchanged output):

```powershell
$cli = 'C:/Users/kaitp/source/repos/Pe.Revit.Sdk-ff-proof/source/Pe.Revit.Cli/bin/Release/net8.0/Pe.Revit.Cli.dll'
$project = 'C:/Users/kaitp/source/repos/Pe.Tools-family/source/Pe.Revit.Tests/Pe.Revit.Tests.csproj'
$filter = 'FullyQualifiedName~FamilyModelRoundtripTests|FullyQualifiedName~LookupTableRoundtripTests|FullyQualifiedName~FamilyFoundryBulkMigrationHarnessTests|FullyQualifiedName~AssemblyLoadDiagnosticsTests'
$env:VSTestLogger = 'trx'
$env:VSTestResultsDirectory = (Resolve-Path .artifacts/runs/fresh-20260906-ff/integration).Path
dotnet $cli test --project $project --year 25 --filter $filter --timeout-seconds 240 --no-build --plan --json
dotnet $cli test --project $project --year 25 --filter $filter --timeout-seconds 240 --no-build --json
```

`final-verification.json` at **05:12:04 UTC** proves owned test PID 25192 gone, zero active holds, exact native restoration to its saved Original SHA256 `A184E5A30AF985F68B448A9ADCDD3C06BB95883FDC4D20462F9078BE09B9D2CF`. This differs from the initial EF930... only in LoadTime telemetry already changed before acquisition; enabled/disabled choices are identical. Separate `takeoffs-25` PID 39780 started **05:07:15 UTC** between attempts and was never operated. SDK restored its own acquired Original, preserving that intervening telemetry.

Protected `pe.app-25` PID **71484**, start **04:20:36.3844230 UTC**, remains unchanged. Both original template hashes still match above. No operation targeted protected documents or original OneDrive settings. This is process/byte custody evidence, not a new inspection of the user's modified document contents. No new Revit wave is authorized to begin until root READY; the minimal SDK's next runtime validation remains pending that signal.

Wave 2 checkpoint 2026-09-07T05:19:32.3344645Z: root READY 9941494173e8c9791b9c37e6658963075c8d0360 verified clean. SDK b1ec99e, six-class filter in wave2/plan.json, --no-build, 300-second bound. Starting sole owned runtime; root source hold active. Native before SHA256 A184E5A30AF985F68B448A9ADCDD3C06BB95883FDC4D20462F9078BE09B9D2CF; no active quarantine.


## Wave 2 ? root 9941494, minimal SDK b1ec99e

READY source `9941494173e8c9791b9c37e6658963075c8d0360` was verified clean before launch; user supplied compile result 0 errors / 111 warnings. This wave used `--no-build` and did not independently rebuild. Answering SDK `b1ec99e02511e61cc7ab22700744e37e3caa3855`, SHA256 `240F72775A7F63B4DC91865A2DFAC851D508C6530E9346F55AD83FE1CF62F411`.

Fresh controlled test session `pe.revit.tests-25-test`: PID **61604**, start **2026-09-07T05:19:35.8053843Z**, start ticks **639243551758053843**. `wave2/session.json`, `launch.json`, `quarantine-2025.json` preserve custody. Full TRX interval **05:19:33.828?05:21:18.936 UTC = 105.108 s**; adapter execution **50.184 s**; test summary **41 s**. Exit code **1**, **11 passed / 13 failed / 0 skipped**. The 300-second bound was not reached. The source hold was released immediately when completion was observed; no retry was launched.

| Distinct failure signature | Cases | Exact evidence / next investigation |
|---|---:|---|
| Invalid dimension direction | 4 | `a-box`, `b-grd`, both rename cases fail in fixture construction at `MakeDims.cs:31`, `FamilyCreate.NewLinearDimension`. Box includes `body.eq-lr`, `body.eq-fb`; GRD includes `opening-eq`, `opening`. Check reference normals, chosen view plane, and dimension line projection. Rename operation itself was not reached. |
| Duplicate native Model parameter | 4 | Every ranked-company-source boolean combination fails at `FamilyFoundryBulkMigrationHarnessTests.cs:82`: `FamilyManager.AddParameter("Model", ...)`, name already in use. Fixture setup fails before source ranking. |
| Hosted-template placement mismatch | 2 | `c-bath-shower` and `d-bath-shower-refline`: `FamilyTemplate.cs:42`, template `Plumbing Fixture wall based` produces `OneLevelBasedHosted`, model declares `OneLevelBased`. |
| Company definition fixture resolved under Revit installation | 1 | Company shared-definition replacement: DirectoryNotFoundException for `C:/Program Files/Autodesk/Revit 2025/Fixtures/Profiles/normalization-aps-definitions.json` in `CompanyDefinitions()`. Resolve from the test assembly/fixture root. No shared-source correctness claim reached. |
| Failed-family receipt reports success | 1 | At bulk harness line 192, expected first callback `false`, actual `true`; previous wave failed at the second callback. Trace targeted injected failure and family identity/receipt timing; do not infer the entire actual array from the first mismatch. |
| Lookup evaluated voltage lost on replay | 1 | `LookupTableRoundtripTests.cs:108`: `ResultVoltage` expected internal **1291.6692500051665**, actual **0**, tolerance `1e-7`. This wave reached native replay/read-back after the pending-log fix. Trace formula/table/type evaluation against the retained fixture outputs. |

Passed: assembly diagnostic; explicit all-type value update; caller-owned transaction receipt; rollback with single-transaction true/false; stale-plan refusal; named-plane reapply; rejected-template cleanup; three `OperationGroupLogTests` vectors. Thus the earlier historical pending-log false failures are closed for these exercised paths. Authored geometry, rename-across-families, source-ranking, company-definition replacement, and evaluated lookup roundtrip remain red/unproven as detailed above.

**Actual runtime identity is now proven for integration.** The improved diagnostic wrote `wave2/assembly-load.txt` from PID 61604. Loaded test/dependency files were hashed and compared with the pre-run source build, with matching MVIDs:

| Assembly | Runtime = source MVID | Runtime = source SHA256 |
|---|---|---|
| Pe.Revit | `c5bec76f-f3e2-4325-8dad-f536a74ceed4` | `C28D4A21ED5D89888C7B0CC6A8C3B45DDE33CE3D5CF63253928F1053C0FA6C10` |
| Pe.Revit.FamilyFoundry | `7da05306-010c-4bd8-baa5-c737de2a3930` | `44E16886A88E2B97516DB30BCD0D35F451590D241B067444EE3E97D92FFC0F41` |
| Pe.Revit.Tests | `2da87268-fe41-46a8-8008-533094449b7a` | `4ECA576C89C33FAEB14B1C6B11D98304941B2F297A3D1B6F9F85C6A7D0D403B7` |
| Pe.Shared.RevitData | `277e2aeb-9a2d-4868-943c-a496058108cb` | `444BEE4DD87214F8D65BA2FC6C09153763D29878D4B4961F3C170D162FAA1B57` |

`wave2/assembly-identity.json` records full runtime and build paths and equality per assembly. The loaded directory is `C:/Users/kaitp/AppData/Local/Temp/9cd99d2a-0e0a-421a-8d4c-08aeb6f99bcc/RevitTest/Pe.Revit.Tests/`. This closes the wave-1 MVID evidence gap for the new source only.

Exact wave-2 commands, from the proof checkout (same absolute `$cli` and `$project` as above):

```powershell
$out = (Resolve-Path .artifacts/runs/fresh-20260906-ff/wave2).Path
$env:VSTestLogger = 'trx'
$env:VSTestResultsDirectory = $out
$env:PE_FF_PROOF_OUTPUT = $out
$filter = 'FullyQualifiedName~FamilyModelRoundtripTests|FullyQualifiedName~LookupTableRoundtripTests|FullyQualifiedName~FamilyFoundryBulkMigrationHarnessTests|FullyQualifiedName~AssemblyLoadDiagnosticsTests|FullyQualifiedName~FamilyRenameAcrossFamiliesTests|FullyQualifiedName~OperationGroupLogTests'
dotnet $cli test --project $project --year 25 --filter $filter --timeout-seconds 300 --no-build --plan --json
dotnet $cli test --project $project --year 25 --filter $filter --timeout-seconds 300 --no-build --json
```

Full results and traces: `wave2/kaitp_KP-PC_2026-09-07_00_20_32.trx`, `wave2/results.json`, `wave2/journal.3622.txt`, and `wave2/fixture-output/`. `wave2/verification.json` at **05:22:30 UTC** verifies PID 61604 gone, zero active holds, protected PID **71484** with unchanged start **04:20:36.3844230 UTC**, and native SHA256 **A184E5A30AF985F68B448A9ADCDD3C06BB95883FDC4D20462F9078BE09B9D2CF** matching both pre-run bytes and the owned lease Original exactly. No native restoration was performed outside the SDK lifecycle. This is runtime validation of the final minimal lease repair.

## Lookup diagnosis after wave 2 ? awaiting the next READY wave

Authorized integration merge `623a892` brings root `9941494` into this proof tree. Lookup-only test commit **2c5457e** adds durable source/reopened family.json and raw per-type values (lookup key, table name, numeric carrier, unit basis, output, formula, HasValue). On failure only, it records regeneration and formula clear/reapply in a rolled-back transaction, then rethrows the original failed assertion. Numeric tolerance remains `1e-7`; no assertion was weakened. Full merged compile: 0 errors / 111 warnings; final incremental compile after diagnostic placement correction: 0 errors / 11 warnings. See `lookup-diagnostic-build.log` and `lookup-diagnostic-final-build.log`.

Saved source and replay lookup CSVs are byte-identical: SHA256 **1957A3D54D95C298FF83C45BB88E530FEC9E8C5FF6FEEF2F9D7AE0478D19D267**. Import precedes per-type values, which precede formulas in `FamilyReconciler.Lower`; the numeric carriers feed a target formula multiplied by its unit-basis parameter. Existing wave-2 evidence records only the final zero, not those inputs. Therefore the remaining split is lost input/unit basis versus lookup/formula evaluation state. No production repair is claimed without that distinguishing evidence. The next combined root READY run should include `2c5457e`; its new files will identify the failing boundary even if the test remains red. No independent runtime was launched.

Separately, SDK **ec55df2** removes the required-adapter-only condition from the mutex-protected overlap check in `AddinQuarantine.Acquire`. All callers now reject an active lease atomically, including ordinary quarantine after ordinary quarantine and ordinary quarantine after a required-adapter lease. Both vectors pass; `sdk-all-callers-build.log` retains compile output. No native settings were changed for these temp-root checks. This supersedes `b1ec99e` for the next READY wave; runtime validation of the one-line guard is pending that wave.

Wave 3 start 2026-09-07T05:29:28.9571314Z: root READY 1e24ef0429bf411f7bfcc26740a4cd3de107b23d clean; roundtrip + diagnostic only, --no-build, 300-second bound. Source hold active.

## Narrow wave 3 ? root 1e24ef0

Root **1e24ef0429bf411f7bfcc26740a4cd3de107b23d** verified clean. Selected only `FamilyModelRoundtripTests|AssemblyLoadDiagnosticsTests`, using the same absolute project and CLI, `--no-build --timeout-seconds 300`, with --plan first and PE_FF_PROOF_OUTPUT/VSTestResultsDirectory set to `wave3/`, VSTestLogger=trx. Root supplied build zero errors; no rebuild was performed here.

Fresh controlled PID **45740**, start **05:29:31.611497 UTC**, ticks **639243557716114970**. SDK binary SHA256 **95EDE6779A98BDC85CD3CE32D229DAD581C6107096EF1F7496E6774EBD3C55C2**; informational version still stamps `b1ec99e` because this binary was built with the overlap guard before its subsequent commit `ec55df2`. Receipt names the exact answering bytes.

TRX **05:29:29.855?05:30:04.972 UTC**, **35.117 s** full interval; test summary **8 s**. Exit **1**, **3 passed / 4 failed / 0 skipped**. Source hold released immediately after completed envelope; no retry.

| Case | Distinct red at this source |
|---|---|
| a-box | `MakeDims.cs:31`, NewLinearDimension ArgumentException: one input condition not satisfied. Includes body.eq-lr, body.eq-fb, body.width, body.depth. Prior invalid-direction exception no longer appears as the first cause. |
| b-grd | Same dimension input ArgumentException, including opening-eq, opening, flange.eq-lr, flange.eq-fb. |
| c-bath-shower | `ParamOps.cs:41`, FamilyManager.AddParameter(ExternalDefinition,...): shared parameter creation failed for **PE_P_LoadCalc_CWFU**, through NormalizeParamSources. Hosted-header refusal is no longer the stopping point. |
| d-bath-shower-refline | Cannot map **90deg** to **_conn angle**, spec `autodesk.spec.aec:angle-2.0.0`, strategy CoerceByStorageType; `SetValue.cs:196`, called from SetParamValuesPerType:137. |

Passed: named-plane reapply, rejected-template cleanup, assembly diagnostic. Raw TRX `wave3/kaitp_KP-PC_2026-09-07_00_29_52.trx`, extracted `results.json`, journal 3624, session/launch/hold receipts all retained. `wave3/assembly-identity.json` proves SHA256 AND runtime MVID equality for Pe.Revit.Tests, Pe.Revit, Pe.Revit.FamilyFoundry, Pe.Shared.RevitData against pre-run source output. This establishes actual source runtime for the new failures.

At **05:30:56.917 UTC**, `wave3/verification.json` confirms owned PID gone, zero holds, protected **71484** retaining start **04:20:36.3844230 UTC**, native settings exactly matching the acquired Original **8968E0DD1CF61A6D6A063FABD10D84830EAF8BC9F721F71879AF4620803E4E54**. No lifecycle or document command targeted another session.

Lookup work remains at the evidence boundary documented above: source/replay CSV already byte-identical; added diagnostic snapshots distinguish lookup key/table-name/unit-basis loss from formula evaluation state and preserve the original numeric assertion. This narrow wave intentionally did not select lookup. The next combined READY source should include **2c5457e** so lookup can advance without a speculative production change.

Wave 4 independent proof start 2026-09-07T05:33:23.0287649Z: merged root8008e19; diagnostic commit9f8c2b9; own absolute project, dimension+lookup+assembly filters, --no-build, 300seconds. READY explicitly authorized; no root source hold needed.

## Wave 4: measured dimension cause and lookup split

Diagnostic commit **9f8c2b9** uses independent SubTransactions through MakeRefPlanes/MakeDims. All six fresh-reference trials failed NewLinearDimension; all six trials with Regenerate passed, across X/Y/Z and two/three references. Reference strength remained NotAReference (12); line dot view direction was zero. Strong references were unnecessary. Evidence: `wave4/dimension-trials.json`. Root owns the resulting MakeDims boundary regeneration.

For capture owner N: `wave4/fixture-output/e8aa207d/source.family.json` captured both ResultVoltageLookupUnit and ResultAirFlowLookupUnit as unitless **1.00**. `source-values.json` retains native bases **10.763910416709722** (voltage) and **0.016666666666666666** (airflow). Commit e5426ac tested unit-bearing capture (1 V / 1 CFM); N owns final portable formatting. This exposed the independent original evaluation failure, without weakening the numeric assertion.

`wave4-lookup-units` and `wave4-formula` each ran LookupTableRoundtripTests plus AssemblyLoadDiagnosticsTests: **1 passed / 1 failed**. Inputs, table CSV, raw carriers (120/450/1), and unit bases survive reopen correctly, but dependent voltage/airflow/yes-no outputs are zero. Plain regeneration does not repair them. Diagnostic clear/reapply of formulas, rolled back after observation, restores **1291.6692500051665 / 7.5 / 1**. Production candidate **5c5ee31**, regeneration after each formula assignment, was falsified by wave4-formula and removed. Do not integrate it as a fix.

Exact latest command (environment VSTestLogger=trx; VSTestResultsDirectory and PE_FF_PROOF_OUTPUT point to the absolute wave4-formula artifact directory):

```powershell
dotnet C:/Users/kaitp/source/repos/Pe.Revit.Sdk-ff-proof/source/Pe.Revit.Cli/bin/Release/net8.0/Pe.Revit.Cli.dll test --project C:/Users/kaitp/source/repos/Pe.Tools-ff-proof/source/Pe.Revit.Tests/Pe.Revit.Tests.csproj --year 25 --filter 'FullyQualifiedName~LookupTableRoundtripTests|FullyQualifiedName~AssemblyLoadDiagnosticsTests' --timeout-seconds 300 --no-build --json
```

Fresh controlled PID **45104**, start **05:39:29.8314797 UTC**, TRX `wave4-formula/kaitp_KP-PC_2026-09-07_00_40_21.trx`, exit **1**. Full results, fixture snapshots, session/launch/hold receipts and build identity retained. Both followups have five matching actual runtime SHA256/MVIDs in `assembly-identity.json`, including Pe.Revit.DocumentData. SDK bytes remain **95EDE6779A98BDC85CD3CE32D229DAD581C6107096EF1F7496E6774EBD3C55C2** (source ec55df2; binary informational stamp b1ec99e).

At **05:42:23 UTC**, SDK cleanup completed: owned PID gone, zero holds; exact native SHA256 **8968E0DD1CF61A6D6A063FABD10D84830EAF8BC9F721F71879AF4620803E4E54** restored. Protected user PID **71484** retains **04:20:36.3844230 UTC** start. No source hold remains. No further runtime launch until root READY. Next source work is nested dependency closure in Build/BuildAndSave and bridge ModelDirectory pass-through; capture formatting and geometry production changes remain with their assigned owners.


## Dependency closure queued for combined proof

Commit **5f93b79** closes Build/BuildAndSave nested dependency loading and passes bridge ModelDirectory to that shared entry. Sibling `<family>.family.json` wins over matching `.rfa`; invalid JSON refuses rather than silently falling back. Recursive builds detect cycles, verify names/types, and close child documents on success/failure. The roundtrip harness supplies the fixture directory; new vane/stub sidecars supply their modeled geometry and instance parameters. The existing native 2025 puck is copied through the project content item, with no duplicate loader or persistent metadata. Source and copied puck SHA256 both **6B24CA175437A40E8F12FD2F24FA0F89D428FB245AAED9AC88A0FF7DA547EEF0**.

`dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests -nologo` passed, **0 errors / 117 warnings**, final log `dependency-final-build.log`. This is compile proof only. Two FamilyModelDependencyTests cover recursion, sidecar priority/native fallback, save/reopen, unchanged native bytes, missing dependencies/types, cycles, and document cleanup. They must join the next root READY fresh filter. Project-loaded reuse in batch/in-place remains deferred; that path is not silently redirected to filesystem dependencies.

The lookup failure diagnostic now isolates same-formula reassignment, dependent-only refresh, carrier-only refresh, and all-formula refresh in separate rolled-back SubTransactions. The original numerical assertion and failure are retained. No new runtime has been started after wave4-formula cleanup.
