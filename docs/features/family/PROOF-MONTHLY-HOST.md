# Monthly profiles through Host operations

## Prepared chain

`scripts/familyfoundry-monthly-host-proof.mjs` removes the test-adapter dependency from the next monthly-profile run. It uses the checkout-pinned Pea CLI (`vp run @pe/pea#pea`) for every Revit call:

1. `revit.context.summary` refuses a family document, read-only/modifiable document, session mismatch, or any active path other than the explicitly supplied disposable Old Template copy.
2. A `ReadOnly` `pea script execute` call reads the frozen 45-profile composed corpus and company definitions, then calls the public production `FamilyProfileConverter.Convert` against the active project's units. It returns each native `patchJson`, source path, and `ExecutionOptions`; it does not mutate the document.
3. `familyfoundry.plan` receives each complete native patch without `familyId`, so production `FamiliesMatching` evaluates the authored selector across every eligible project family. One failed profile is recorded and the remaining profiles continue. The checkpoint is rewritten after every profile.
4. `apply-one` requires an explicit source and a family ID that appeared in that profile's selector-driven plan. It captures before state, applies with the exact plan hash, trusts the receipt's replacement family ID, captures again, replans, applies the no-change plan once, captures, and replans a final time.
5. A failed receipt records exact before/after `modelJson` equality as rollback evidence. A missing response/receipt or target mismatch is `outcomeUnknown` and blocks replay.

The production seams are `FamilyFoundryBridgeOps.PlanFamilies` and `ApplyFamilies` (`source/Pe.App/Host/FamilyFoundryBridgeOps.cs:31,64`). Apply creates one `OperationProcessor` per selected family and consumes the expected plan hash (`:80-87`); project capture is the readback seam (`:102`). The converter is the public corpus adapter (`source/Pe.Revit.FamilyFoundry/Apply/FamilyProfileConverter.cs:30`) and returns both patch and options (`:723`). The existing native test uses this same converter plus `FamiliesMatching` for all 45 profiles (`source/Pe.Revit.Tests/LibraryBehavior/FamilyFoundry/FamilyFoundryBulkMigrationHarnessTests.cs:815-870`).

## Runtime prerequisites and commands

P owns session lifecycle and document custody. Before either command, P must provide:

- a controlled dev snapshot whose loaded payload contains the converter and current Family Foundry operations;
- the exact bridge session ID and source Host selector/URL;
- an activated, writable, unmodifiable **copy** of Old Template and its absolute path; the original must remain unopened by this workflow;
- a fresh artifact directory. `pe-revit doc current --id <session-id>` is the SDK-side identity receipt; the driver independently verifies the same active path through Host.

From the same checkout whose payload is loaded:

```powershell
node scripts/familyfoundry-monthly-host-proof.mjs --host dev --bridge-session-id <bridge-id> --document-path <absolute-disposable-Old_Template.rvt> --original-document-path <absolute-original-Old_Template.rvt> --artifact-dir <absolute-artifact-dir> --mode plan
```

After reviewing one selector result, run the bounded mutation against that exact pair:

```powershell
node scripts/familyfoundry-monthly-host-proof.mjs --host dev --bridge-session-id <bridge-id> --document-path <absolute-disposable-Old_Template.rvt> --original-document-path <absolute-original-Old_Template.rvt> --artifact-dir <new-absolute-artifact-dir> --mode apply-one --profile <exact-corpus-source> --family-id <selected-family-id>
```

The driver calls no `pe-revit session` or `pe-revit doc` verb and never saves, closes, opens, or copies a Revit document. All JSON reaches Pea as process argv entries rather than a PowerShell JSON command line. The operation-call CLI currently uses `--bridgeSessionId`; script execution uses its kebab-cased `--bridge-session-id`.

## Artifact contract

`monthly-host-proof.json` is the resumable index:

- `sourceCommit`, `requestedSession`, and `document` bind source, target, and disposable document identity.
- `profiles[45]` records source, conversion status, native patch SHA-256, converted execution options, full selector plan, selected count, and any error.
- `applyOne` records the requested and authoritative family IDs, before/apply/after/no-op/reapply/final responses, rollback comparison, and terminal status.
- `executionOptionsTransported` is deliberately `false` until the Host apply contract carries the converter result's options.

`requests/*.json` contains the exact operation key/request/session fixtures. `responses/*.json` contains parsed Host envelopes, while adjacent stdout/stderr files preserve raw CLI evidence. `convert-company-profiles.cs` is the exact generated ReadOnly script submitted to the controlled snapshot.

## Honest acceptance boundary

This prepares all 45 composed profiles and preserves every converted operation. It does not replace them with the older 38-parameter mapping. The frozen selector census remains 36 exact-name, six empty/all, one category, one placed-only, and one exact-name-plus-category selector. The six SavedEquip `__CURRENT_FAMILY__` profiles legitimately select no Old Template family because the source contains no project assignment; the driver records that result and invents no target.

The current Host apply request contains only `patchJson` and `expectedPlanHashes` (`source/Pe.Shared.HostContracts/Operations/FamilyFoundryHostContracts.cs:27`). It does not thread the converter's `ExecutionOptions` into `OperationProcessor`, which is constructed with defaults. Thirteen corpus profiles author non-default option objects: six disable both `SingleTransaction` and type optimization, three disable `SingleTransaction`, and four have other explicit combinations. Full-family rollback remains owned by the outer family visit, as settled, but this Host proof cannot claim the remaining authored option choices were consumed. The driver exposes rather than hides that dependency.

No native run was performed in this preparation slice. Plan, apply, receipt, rollback, and reapply remain pending P's controlled disposable session.
