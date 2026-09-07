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
