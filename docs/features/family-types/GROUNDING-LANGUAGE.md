# The standardized language (in-repo FamilyFoundry + shared contracts) — 2026-07-12

THE design precedent per user steer. Source-indexed from `source/Pe.Revit.FamilyFoundry` and
`source/Pe.Shared.RevitData`. The family-types state model speaks THIS language.

## The anchors (STABLE — build on these)

- **`ParameterIdentity`** (`Pe.Shared.RevitData/ParameterContracts.cs:19-26`):
  `(Key, Kind: SharedGuid|BuiltInParameter|ParameterElement|NameFallback, Name, BuiltInParameterId?, SharedGuid?, ParameterElementId?)`.
  Key strings: `shared:{guid}`, `builtin:{id}`, `parameter-element:{id}`, `name:{lower}`.
  TRAP: `DesiredParameterCompiler` mints a divergent `shared-guid:` prefix — mint identities ONLY
  via `RevitParameterDefinition.CreateIdentity` (`source/Pe.Revit/Parameters/RevitParameterDefinition.cs:193-225`).
- **`ParameterDefinitionDescriptor`** (`ParameterContracts.cs:38-45`): `(Identity, IsInstance?,
  DataTypeId?, DataTypeLabel?, GroupTypeId?, GroupTypeLabel?)` — serialization-clean canonical descriptor.
- **`FamilyParameterSnapshot`** (`Families/FamilySnapshotContracts.cs:12-22`) — "canonical family/
  parameter record language shared by DocumentData collection, FamilyFoundry capture, and the matrix
  wire." Built on the descriptor. Single producer: `FamilySnapshotExtractor` (one pass, no
  CurrentType switching).
- **Name-first authoring** (`Parameters/AuthoredParameterContracts.cs`): declarations key on `Name`
  with `Value` XOR `Formula` (`AuthoredParameterAssignment(Kind: Value|Formula, Value)`); identity
  resolved at compile. → Our name-based cell keys + staged edits ARE the sanctioned idiom.
- **Provenance idiom**: `ResolvedParameterMetadataProvenanceSet` — every resolved field records its
  origin (Authored|ParameterService|...|SnapshotOrFixture|Unresolved). Our `proposal.source` +
  `by` + `confidence` is the web-side cousin; keep provenance first-class.
- **Desired state** (`FamilyFoundry/DesiredState/DesiredFamilyMigrationProfile.cs`): authored
  declarations + `DesiredPerTypeAssignmentRow { Parameter, [JsonExtensionData] ValuesByType }` →
  `DesiredParameterCompiler.Compile` → `FamilyMigrationReconciliationPlan` (resolved params +
  lowered actions + actionable InvalidOperationException on ambiguity). The editor's staged-cells →
  apply-edits flow is a lightweight sibling of this compile step.
- Validation idiom: hard compile-time errors with actionable messages, surfaced in preview UI as
  `IsValid / AppliedFixes / RemainingErrors / Warnings`. `dryRun` precedent EXISTS:
  `ParameterValueApplyRequest.DryRun` (`ParameterValueApplyContracts.cs:11`).
- **Never treat `PE_*` name prefixes as authority** — classification via ParameterIdentity/GUIDs
  (FF `_README.md:39-40`).

## The churn surfaces (do NOT build new state on these)

- `FamilyEditorParameterSnapshot` / `FamilyEditorApply*` (`FamilySnapshotContracts.cs:41-83`) —
  flat, name-only wire for `family.editor.*` ops; mid-migration toward the canonical descriptor
  (family-sheet PLAN directed convergence; unfinished). **Our pass: additive alignment only —
  attach `Identity` to snapshot params, keep flat fields, note full convergence in ledger.**
  Verified: the PLAN's extension fields (identity/dependsOn/dependents/associations/dryRun) have
  NOT landed in C# yet — Wave 1B adds them.
- `ParameterSnapshot` (FF-local, `Snapshots/ParameterSnapshot.cs`) — typed view being subordinated;
  has `FromCanonical`/`ToCanonical`.
- Legacy geometry/spec types — irrelevant here.

## Operations relevant to a param editor (FF `Operations/`)

SetParamValues (global value/formula, uses set-unset trick), SetParamValuesPerType,
AddParamsFromSettings, AddSharedParams, Map*/MapReplaceParams, BacklinkParamsToBuiltIn,
DeleteParams/PurgeParams, SortParams, CreateFamilyTypes/FinalizeFamilyTypes.
(Add/delete/type-creation stay unbridged this pass — ledger 6.)

## Unverified (check before relying)

- `family.editor.snapshot` internals (`RevitDataRequestService.GetFamilyEditorSnapshotCore`) —
  whether it reuses FamilySnapshotExtractor. Read before extending.
- `shared:` vs `shared-guid:` Key-prefix divergence — potential latent dedup bug (ledger).
