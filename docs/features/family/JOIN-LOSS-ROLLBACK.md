# MSZ-GL join-loss rollback slice

Base: `c6b34a1e523ddf7444758a5cb65983c0821e56a2`

## Evidence and identifier

Wave 16 posted `Can''t keep elements joined.` in `ReconcileFamily` for extrusion 5693840, then required a manual OK and continued. The journal contains no failure GUID, so it cannot distinguish same-text IDs by itself. Revit 2025''s local API documentation exposes the exact semantic identifier `BuiltInFailures.JoinElementsFailures.CannotKeepJoined` with that description. The implementation compares the native `FailureDefinitionId`; it does not compare localized text.

Other Revit IDs have the same English description (`CannotJoinElementsWarn`, structural, multi-plane, and error variants). They are deliberately unchanged until native evidence identifies one of them.

## Shared policy and callers

`FamilyVisitScope.Edit` and `FamilyVisit.Run`''s `LoadFamily` failure scope now share `PeToolsFailureHandling.RejectJoinLoss`. It:

- records every observed failure through the existing `(IsError, Message)` diagnostic shape;
- includes the native failure-definition GUID in every message;
- treats only `CannotKeepJoined` as rollback-worthy when Revit reports it as a warning;
- returns `ProceedWithRollBack` and relies on existing `SetClearAfterRollback(true)`;
- never resolves a failure or deletes/detaches geometry;
- retains existing warning suppression for unrelated warnings when `SuppressWarnings` is enabled.

All `OperationProcessor` project-family and family-document paths route through `FamilyVisit`. `FamilyVisitSession` and `RenameParamAcross` inherit the same boundary. The scripting service, Host data request service, parameter value applier, legacy `ProcessFamily`, benchmarks, and their existing resolving/suppressing policies are separate callers of `PeToolsFailureHandling.CreatePreprocessor` or `RejectErrors`; this slice does not alter them.

## Regression

`Old_template_Mitsubishi_MSZ_GL_preserves_join_graph_or_rolls_back` uses a disposable copy of the real `Old_Template.rvt` and the real `Mitsubishi_MSZ-GL` family. It requires a non-vacuous joined edge involving an Extrusion, captures canonical native `GeomCombination.AllMembers` sets keyed by member UniqueId/type/category, runs the same 38-definition company migration, and then requires:

- commit: converged receipt, 38/38 shared identities, and identical family combination membership; or
- refusal: the exact `CannotKeepJoined` GUID, unchanged project family identity, unchanged parameter matrix, and identical family combination membership.

The original fixture hash is checked after close. The test was compiled only; the proof owner must run it in fresh Revit. The underlying operation that causes Revit to lose the join remains untraced.

## Validation and behavior tally

- Compile lane: `dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests`
- Result: exit 0, 0 errors, 127 warnings.
- Changed behavior: one exact warning ID now refuses and rolls back Family Foundry edit/load.
- Preserved behavior: all unrelated warnings and all non-FamilyVisit failure-policy callers.
- Native acceptance: pending; no runtime or session was started.

## Wave 18 probe correction

The first probe called `JoinGeometryUtils.GetJoinedElements`, which Revit correctly refused because it is project-document-only. Family joins/cuts are represented by `CombinableElement.Combinations` and each `GeomCombination.AllMembers` collection. The corrected probe deduplicates combinations by native element ID, requires at least two members, sorts each member set by stable UniqueId/type/category, and retains the non-vacuous Extrusion membership precondition. Runtime re-execution remains with the proof owner.
- Follow-up compile: Debug.R25.Tests exit 0, 0 errors, 126 warnings.
