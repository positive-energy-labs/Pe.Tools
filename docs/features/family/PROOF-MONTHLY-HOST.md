# Monthly profiles through Host operations

## Prepared chain

`scripts/familyfoundry-monthly-host-proof.mjs` removes the test-adapter dependency from the next monthly-profile run. It uses the checkout-pinned Pea source CLI (`vp exec jiti apps/pea/src/main.ts`) for every Revit call:

1. `revit.context.summary` refuses a family document, read-only/modifiable document, session mismatch, or any active path other than the explicitly supplied disposable Old Template copy.
2. A `ReadOnly` `pea script execute` call reads the frozen 45-profile composed corpus and company definitions, then calls the public production `FamilyProfileConverter.Convert` against the active project's units. It returns each native `patchJson`, source path, and `ExecutionOptions`; it does not mutate the document.
3. `familyfoundry.plan` receives each complete native patch without `familyId`, so production `FamiliesMatching` evaluates the authored selector across every eligible project family. One failed profile is recorded and the remaining profiles continue. The checkpoint is rewritten after every profile.
4. `apply-one` requires an explicit source and a family ID that appeared in that profile's selector-driven plan. It captures before state, applies with the exact plan hash, trusts the receipt's replacement family ID, captures again, replans, applies the no-change plan once, captures, and replans a final time.
5. A failed receipt records exact before/after `modelJson` equality as rollback evidence only after both exact captures succeeded. A missing or malformed response/receipt, receipt hash mismatch, or target mismatch is `outcomeUnknown` and blocks replay.

The production seams are `FamilyFoundryBridgeOps.PlanFamilies` and `ApplyFamilies` (`source/Pe.App/Host/FamilyFoundryBridgeOps.cs:31,64`). Apply creates one `OperationProcessor` per selected family and consumes the expected plan hash (`:80-87`); project capture is the readback seam (`:102`). The converter is the public corpus adapter (`source/Pe.Revit.FamilyFoundry/Apply/FamilyProfileConverter.cs:30`) and returns both patch and options (`:723`). The existing native test uses this same converter plus `FamiliesMatching` for all 45 profiles (`source/Pe.Revit.Tests/LibraryBehavior/FamilyFoundry/FamilyFoundryBulkMigrationHarnessTests.cs:815-870`).

## Runtime prerequisites and commands

P owns session lifecycle and document custody. Before either command, P must provide:

- a controlled dev snapshot whose loaded payload contains the converter and current Family Foundry operations;
- the exact bridge session ID and source Host selector/URL;
- an activated, writable, unmodifiable **copy** of Old Template and its absolute path; the original must remain unopened by this workflow;
- a fresh artifact directory. `pe-revit doc current --id <session-id>` is the SDK-side identity receipt; the driver independently verifies the same active path through Host.

From the integrated checkout whose payload is loaded, P fills the six values supplied by the controlled snapshot and disposable-document preparation:

```powershell
$repoRoot = 'C:\Users\kaitp\source\repos\Pe.Tools-family'
$hostSelector = '<dev-or-explicit-host-url>'
$bridgeSession = '<exact-bridge-session-id>'
$disposableProject = '<absolute-disposable-Old_Template.rvt>'
$originalProject = '<absolute-original-Old_Template.rvt>'
$planArtifacts = '<absolute-new-plan-artifact-directory>'
node "$repoRoot\scripts\familyfoundry-monthly-host-proof.mjs" --repo-root $repoRoot --host $hostSelector --bridge-session-id $bridgeSession --document-path $disposableProject --original-document-path $originalProject --artifact-dir $planArtifacts --mode plan
```

After reviewing one selector result, run the bounded mutation against that exact pair:

```powershell
$applyArtifacts = '<absolute-new-apply-artifact-directory>'
$profileSource = '<exact-source-from-plan-artifact>'
$familyId = '<exact-selected-family-id-from-that-profile-plan>'
node "$repoRoot\scripts\familyfoundry-monthly-host-proof.mjs" --repo-root $repoRoot --host $hostSelector --bridge-session-id $bridgeSession --document-path $disposableProject --original-document-path $originalProject --artifact-dir $applyArtifacts --mode apply-one --profile $profileSource --family-id $familyId
```

The driver calls no `pe-revit session` or `pe-revit doc` verb and never saves, closes, opens, or copies a Revit document. All JSON reaches Pea as process argv entries rather than a PowerShell JSON command line. The operation-call CLI currently uses `--bridgeSessionId`; script execution uses its kebab-cased `--bridge-session-id`.

## CLI preflight

The checkout CLI was exercised without a Revit operation or document read:

- Windows Node 25.7 `spawnSync("vp", ..., { shell:false })` resolved `vp` and returned status/output normally.
- `vp run @pe/pea#pea -- ...` was falsified: the extra separator reaches Pea as a leading argument and routes to the wrong command. Even without that separator, `vp run` prefixes stdout with its task line. The driver now invokes the package script body directly through `vp exec jiti apps/pea/src/main.ts`, avoiding the task prefix.
- Pea itself prints `Pea product/operator CLI. (pea v0.1.0)` before operation output. A real dead-host `host.status` call then printed a valid `{ ok:false, key:"host.status", ... }` envelope and exited 0. The driver now parses the first JSON object and still rejects `ok:false`; it does not mistake process success for operation success.
- A real invalid `script execute` invocation exited 1, proving `pea()` propagates CLI terminal failures. Successful script output is source-defined with `data      ` as its final structured line; the driver parses the last line-start marker so script output containing that text cannot shadow the result.
- The complete driver was pointed at `http://127.0.0.1:1` with a fake session and distinct disposable/original paths. It exited nonzero and checkpointed `status:"failed"`, the exact transport error, and `finishedAt` in `.artifacts/monthly-host-preflight/monthly-host-proof.json`; an early transport failure can no longer leave a truthful-looking `running` artifact.
- `host operations call --help` confirms `--bridgeSessionId`; `script execute --help` confirms `--bridge-session-id`. Generated request JSON confirms camel-case `executionOptions`, `singleTransaction`, `optimizeTypeOperations`, `enableCollectors`, and `suppressWarnings`.
- Host discovery resolved the installed Host as `http://127.0.0.1:5180`; it returned no Family Foundry rows, so it is not a valid payload for this proof. This worktree's `--host dev` correctly refused because no worktree Host is running. P must supply the new controlled snapshot's Host selector or URL.

Every operation call sends the explicit bridge session and rejects a missing or different `resolvedTarget.session`. The initial context call also verifies the exact disposable document path. The ReadOnly conversion call sends the same bridge selector and now requires its returned `documentPath` to equal that disposable path before any plan begins.

## Artifact contract

`monthly-host-proof.json` is the resumable index:

- `sourceCommit`, `requestedSession`, and `document` bind source, target, and disposable document identity.
- `profiles[45]` records source, conversion status, native patch SHA-256, converted execution options, full selector plan, selected count, and any error.
- `applyOne` records the requested and authoritative family IDs, before/apply/after/no-op/reapply/final responses, rollback comparison, and terminal status. The overall run cannot complete unless `applyOne` completes.
- Every capture must contain exactly the requested authoritative family and a non-null `modelJson`. Every successful receipt must contain the reviewed plan hash. Both no-op plans must have zero changes, refusals, and run effects; the final capture and plan follow the latest replacement family ID.
- `executionOptionsTransported` is `true`: every profile plan and apply carries the converter result's four serialized options.

`requests/*.json` contains the exact operation key/request/session fixtures. `responses/*.json` contains parsed Host envelopes, while adjacent stdout/stderr files preserve raw CLI evidence. `convert-company-profiles.cs` is the exact generated ReadOnly script submitted to the controlled snapshot.

## Honest acceptance boundary

This prepares all 45 composed profiles and preserves every converted operation. It does not replace them with the older 38-parameter mapping. The frozen selector census remains 36 exact-name, six empty/all, one category, one placed-only, and one exact-name-plus-category selector. The six SavedEquip `__CURRENT_FAMILY__` profiles legitimately select no Old Template family because the source contains no project assignment; the driver records that result and invents no target.

The serialized `ExecutionOptions` contract now lives once in the neutral `Pe.Shared.RevitData.Families` namespace. Family Foundry, Host contracts, scripts/Pods, DA callers, and the profile converter consume that type directly; the public Family Foundry package no longer depends on the Host adapter. This is a public namespace/signature migration with no compatibility shim. Runtime-only `FamilyVisitOptions` remains separate so its transaction, Park, and warning behavior cannot leak into desired family JSON.

Thirteen corpus profiles author option objects: six disable both `SingleTransaction` and type optimization, three disable `SingleTransaction`, and four have other explicit combinations. `OptimizeTypeOperations` controls consecutive type-operation batching inside native reconciliation. `SuppressWarnings` participates in the native visit failure policy. Those two behavior-changing Host fields are bound into the plan hash. `SingleTransaction` is still honored by public `OperationProcessor` calls with multi-operation queues, but the Host queues one `ReconcileFamily` operation inside one `FamilyVisitScope.Edit`; changing the inner callback bundle cannot change its native transaction count, so it is transported but moot on this Host path and is not hash-bound. Full-family rollback remains owned by the outer `FamilyVisit` transaction group. `EnableCollectors` is transported and still controls an optional caller-supplied snapshot pipeline, but Host reconciliation supplies no such optional pipeline and performs its own mandatory before/after capture; changing that field therefore does not change Host behavior or its plan hash.

The exact authored shapes are six `{ SingleTransaction:false, OptimizeTypeOperations:false }`, three `{ SingleTransaction:false }`, one explicit all-default object, one `{ SuppressWarnings:true }`, one `{ SingleTransaction:false }` with the other three defaults written explicitly, and one `{ SingleTransaction:true }`. Missing fields retain the existing defaults: single transaction, type optimization, and collectors enabled; warning suppression disabled.

Route state persists the reviewed options with the plan and reuses them for apply on both `/family` and `/families`. The generated Host contracts expose the same optional object on plan and apply. Unknown route option fields are refused by the strict route schema; legacy profile conversion already refuses unknown or non-boolean fields.

Deterministic route checks cover option forwarding through plan and apply, persistence across the reviewed-plan boundary, replacement-family receipts, and replay refusal after apply. A Family Reconciler check proves which fields change the plan hash. Compile remains distinct from native proof. No native run was performed in this preparation slice; plan, apply, receipt, rollback, and reapply remain pending P's controlled disposable session.

## Architectural tally

- The public type moves from `Pe.Revit.FamilyFoundry.ExecutionOptions` to `Pe.Shared.RevitData.Families.ExecutionOptions`; callers must import the neutral namespace. No compatibility type remains.
- `OperationProcessor` retains its first two arguments and adds an optional third `FamilyVisitOptions` argument for runtime transaction ownership and parking. The only prior in-repo `ExecutionOptions.Visit` initializer was `RenameParamAcross`; its public `Owned`/`Sandbox` choice now flows through that third argument. `OperationProcessor` still copies `Park`, and no in-repo caller initializes a park directly. Direct multi-operation queues retain the established `SingleTransaction` behavior.
- Family Foundry replaces its transient Host-contract reference with a direct `Pe.Shared.RevitData` reference. Host contracts already depend on RevitData and refer to the same type; there is no adapter copy or mapping.
- `FamilyModelBuild`, benchmarks, commands, converter harnesses, and other tests either pass the neutral options unchanged or use the same defaults. Desired `FamilyModel` and `FamilyPatch` serialization are unchanged; execution options remain beside the patch.

## Validation in this slice

- Compile lane: `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests -v minimal` passed with 0 errors and 46 warnings on the final incremental build.
- Deterministic lane: `vp test packages/mcps/tests/family-commands.test.ts packages/agent-contracts/tests` passed 5 files and 16 tests.
- Contract generation: `pnpm --filter @pe/host-contracts codegen:check` passed with 67 operations in sync.
- Type/format checks: `@pe/mcps` and `@pe/host-contracts` passed; targeted checks for `agent-contracts/src/family.ts` and `families.ts` passed.
- Driver syntax and repository whitespace: `node --check scripts/familyfoundry-monthly-host-proof.mjs` and `git diff --check` passed.
- The package-wide `@pe/agent-contracts` check remains red in unchanged `tests/settings-fields.test.ts:62`: its union-typed parse result accesses `.parameters`. The two changed route-contract files pass their targeted check, and the focused agent-contract test set passes.
Raw evidence is under `.artifacts/runs/monthly45-host-plan/`: the exact request, successful response envelope, driver stdout/stderr and exit code, terminal checkpoint, and post-failure custody receipt. The checkpoint contains **0 profiles**. Controlled PID 63944 remains active for a corrected driver; the disposable document reports unmodified, the owned quarantine remains active, and protected PIDs 71484/98976 retain their exact start identities.

## Canonical-selector retry and compiler diagnosis

Driver commit **`91c5e06e0fa4d4be14df4632eacf7be7bec6000b`** preserves the target guard while accepting the Host's documented canonical selector `session:<pe-revit-id>`: it routes with `session:ff-profile-proof-25` and compares the response with canonical SDK ID `ff-profile-proof-25`. A single retry in `.artifacts/runs/monthly45-host-plan-2/` passed the context/document guard, then stopped before conversion or the profile loop with **0 profiles** and no Apply.

The exact second cause is a missing shared scripting reference. The read-only inline compiler resolved the frozen Family Foundry assembly, whose public converter API exposes Newtonsoft types, but did not resolve sibling `Newtonsoft.Json.dll`. Compilation returned `CompilationFailed` with `CS0246`, `CS0103`, and `CS0012` for `Newtonsoft.Json`, `JObject`, `JArray`, `JsonConvert`, and `JsonSerializerSettings`.

Both sanctioned callers—workspace bootstrap and inline execution canonicalization—use `ScriptProjectGenerator.GenerateProjectContent`. That generator already has one curated loaded-or-sibling support list; it contains the three `Pe.Shared.*` support assemblies and deliberately avoids general transitive closure. Isolated commit **`5f9dcfd8ef35f186dea28a81c146c40b6c2ebe81`**, based on `3a64a1b`, adds only `Newtonsoft.Json` to that catalog and one assertion to the existing generated-reference test. Exact `Debug.R25.Tests` compile: **0 errors / 130 warnings**. No runtime payload was changed or refreshed.

Driver-only commit **`0a9cec49c8542739be626ac20c649cee1465037c`** now places `CompilationFailed` and every `Error compile:` line in the terminal checkpoint instead of the generic missing-data message; raw streams remain separate artifacts. Controlled PID 63944 still runs generation `20260907134906083` from source `3a64a1b`. Root review/integration and an SDK-owned cold snapshot refresh are required before another Plan attempt.

## Current-payload Plan result at `915790e`

The SDK reminted `ff-profile-proof-25` as controlled snapshot generation **`20260907140624373`**, build stamp **`cc33bfa2cb55`**, PID **108004** (start `2026-09-07T14:06:51.7485233Z`). Host runtime inventory resolves `Pe.App.dll`, `Pe.Revit.FamilyFoundry.dll`, and `Pe.Revit.Scripting.dll` from that generation. Their MVIDs are respectively `0215ca59-c777-4e1b-aa3e-306a59b2576b`, `9404a22c-a927-4d5c-9fcc-710517d543b8`, and `fb3cdfd0-6079-4e3c-a001-e4cf7ee6e246`. `Newtonsoft.Json.dll` is generation-local, SHA-256 `22C649F75FCE5BE7C7CCDA8880473B634EF69ECF33F5D1AB8AD892CAF47D5A07`. The exact disposable Old Template copy is active and reports unmodified. The SDK lists one owned 2025 quarantine for this session; protected PIDs 71484 and 98976 retain their original start identities.

Attempt 3 (`.artifacts/runs/monthly45-host-plan-3/`) proved the Newtonsoft compiler repair: conversion compiled and returned structured data. It then exposed the next boundary defect: the driver passed each full patch through `--request`, and 31 profiles exceeded Windows' argv limit. The terminal checkpoint contains all 45 rows: 31 command-line failures, 9 converter failures, 4 other operation errors, and 1 Plan response. No Apply ran.

Commit **`5bc489d8c26d3b8f167db26c1ddad4764ef867f0`** added the ledger-owed `pea host operations call --request-file` input and made the driver pass its already-written request artifact. Attempt 4 (`.artifacts/runs/monthly45-host-plan-4/`) completed all **45** rows, but all 36 converted requests returned **`PatchJsonRequired`**, not `FamilyNotFound`. The request artifacts contained `patchJson`; the CLI subcommand did not enable kebab-case argument binding, so `--request-file` was ignored and Pea posted an undefined request. The earlier summary at commit `170cf1f` classified zero selected counts without reading the diagnostic code and was false.

Commit **`9ba0234dbe5ffd6eae711cb1e940390a363d6018`** enables the shared Host operation command's kebab-case options and uses `--bridge-session-id` consistently. The minimal red loop in `.artifacts/runs/monthly45-request-file-shape-2/` changed from `PatchJsonRequired` to the deliberately expected `FamilyNotFound`, proving `patchJson` reached the native handler. Attempt 5 (`.artifacts/runs/monthly45-host-plan-5/`) then completed all **45** profiles against the same loaded `915790e` payload:

- **9** failed conversion: one non-modifiable `FormatOptions`, one group `Other`, and seven empty groups.
- **24** converted, reached the Host/native operation, and failed with the same empty parameter-group exception.
- **12** returned structured Plans with `FamilyNotFound` and zero selected families.

The read-only selector census in `.artifacts/runs/monthly45-selector-census/family-not-found-census.json` compares those 12 composed patches with all **560** loaded-family catalog rows. None of the 12 uses category, placement, condition, or exclusion filtering; each uses ordinal exact names only. `AprilAire E-Series` has a concrete selector defect: the two loaded names exist after removing the authored `.rfa` suffix, and one also differs by case. `Constrained Box` uses the family-document-only `__CURRENT_FAMILY__` sentinel against a project. The exact targets for the other ten profiles are absent from this template catalog, so the evidence does not support a matcher defect for them.

No Apply ran. Post-pass context still reports the exact disposable project, `isModifiable: false`; the controlled session and quarantine remain active.

## Controlled `NoTransaction` proof

The same controlled `915790e` runtime executed one `scripting.execute` request with explicit `NoTransaction`. The script opened and rolled back its own project transaction, then called public `FamilyModelBuild.Build` for a minimal Generic Model family and closed the returned family document without saving. The operation returned `Succeeded` with `Started`, `RolledBack`, and `ff-build-complete`; stderr contains reference-resolution information and no policy error. Independent context reads before and after resolve to the same disposable project, report `isModifiable: false`, and report exactly one open document. Raw script, streams, context envelopes, exit codes, and the comparison are in `.artifacts/runs/monthly45-no-transaction/`.

## Plan6 monthly census and AprilAire Apply checkpoint

The controlled runtime remained pinned to native source **`6620376d0057389f061537b081cced788e99be55`**, generation **`20260907143006678`**, build stamp **`5a97a1ff24c0`**, PID **89376** (start `2026-09-07T14:30:35.6885760Z`). The driver source advanced independently; these are separate identities. Protected PIDs 71484 and 98976 were not used.

Plan6 ran all **45** composed profiles from `2026-09-07T14:34:02.551Z` through `15:20:31.786Z`. Conversion produced 43 requests and two literal failures (`80 dBi alarm`, and `180 F`; the Fahrenheit repair is newer than the loaded payload). Native outcomes were:

- **37 successful Plan operations**: 35 returned through Host and two outlived the five-minute HTTP clients. The direct responses contain 199 family-plan rows and 35,480 changes; the two recovered SDK results add 41 family-plan rows and 2,738 changes. All successful rows reported zero refusals.
- **19** direct structured responses selected no family and reported `FamilyNotFound`.
- **6** native Plan operations failed on duplicate `Default Elevation` keys.
- `ElecEquip/Equip` and `ElecEquip/Fixtures` are transport failures only. Their Host clients returned `fetch failed`, while durable native requests `6fac65c1-3e58-4706-9370-e149fbef8153` and `692a8555-779a-4d1d-9fbf-4f40b1c2ee82` completed `ok`, covering 14 and 27 families respectively. Exact recovered results are `responses/15-plan-sdk-result.json` and `responses/16-plan-sdk-result.json`.

Read-only capture exposed two distinct native warning classes. Fifteen exact constraint-warning dialogs were acknowledged with `OK`; `Remove Constraints` was never invoked. The first click targeted the previously enumerated exact PID and handles, but its receipt's aggregate journal guards are null because `Get-Content -Tail -Raw` failed. The following fourteen acknowledgements passed all PID, process-start, window, button, transaction, zero-error, and exact-warning guards. A different dialog while copying `PE - Title Block.rfa` reported that dimensions could not find references and element **6150368** was deleted. It was acknowledged once only to close the edit copy. Therefore the `CmdFFMigrator/profiles/default.json` result for project family **5982572**, plan hash **`A71C57BB2A0F36FD`**, is **untrusted** despite its clean response. The original project family was not loaded back. Evidence is under `modal-blocker/`, including `copy-loss-dismiss.json` and `unknown-copy-warning-journal-tail.txt`. `summary.json` is the compact machine-readable census.

Driver commit **`8eb4780a660496b8bf10ff0ef97c63319ee2ad9c`** retained conversion of all 45 profiles but restricted Apply-one Host planning to the requested profile. Against the unchanged loaded runtime, the fresh AprilAire plan selected family **3813845**, had **114 changes**, **14 run effects**, zero refusals, and hash **`12DF8B5967B8A884`**. The sole Apply returned an authoritative failed receipt before migration: `ReconcileFamily.Execute` recomputed **`98AFB19C7704BE06`** and refused because the plan hash drifted. Receipt fields were `success=false`, `converged=false`, with empty residue, errors, and global diagnostics. No Apply retry or no-op Apply ran.

The driver's raw-string rollback comparison reported false because capture property order changed. Independent recursive key canonicalization proves the before and after models are semantically identical: both canonical SHA-256 values are **`69BE50D4D21644BEDEA0931BC0F2C8A64259E12B425D53415956876C1FA6A360`**. The open disposable file's shared-read SHA-256 remains **`8107AD50ADBD7BB9866287F0C8DB9168FD88ABE3132206356B717E24F2EE46B1`**, exactly matching the untouched original fixture. The AprilAire evidence is `.artifacts/runs/monthly45-host-apply-aprilaire800/`; see `responses/91-apply.json`, `capture-comparison.json`, `journal3673-apply-tail.txt`, and `post-apply-custody.json`.

The controlled session remains active and quarantined for a later payload refresh; this checkpoint does not claim the newer capture guard, Fahrenheit parser, or box changes are loaded. After the hash-drift repair lands in a clean root, the prepared SDK sequence is: record the final root SHA and build identities; run `dotnet <candidate-cli> session hr --id ff-profile-proof-25 --restart --timeout-seconds 300 --json`; verify the replacement PID/start, generation, loaded Pe.App/FamilyFoundry/Scripting hashes, active disposable path, quarantine hold, and protected identities; then run the same Apply-one driver into a new artifact directory. The next run must use a newly planned hash and must not reuse or retry the failed receipt.
