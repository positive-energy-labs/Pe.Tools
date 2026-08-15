# Family Foundry typed operation census

## Decisions

- `DesiredParameterCompiler.Compile(BaseProfile, IDesiredParameterProfile, ...)` is interface-based. Both
  `DesiredFamilyMigrationProfile` and `FFMigratorProfile` satisfy it, but the typed ops use
  `DesiredFamilyMigrationProfile`: it already feeds `DesiredFamilyMigrationQueueBuilder` and
  `Document.ApplyDesiredFamilyMigrationProfile`, preserving the desired-state compiler/lowerer path and
  per-field provenance without translating through the legacy migrator profile.
- Profile input is always inline JSON. The operation boundary uses strict deserialization so unknown or stale
  fields become named `InvalidProfileJson` diagnostics with their JSON path; no operation accepts a profile path.
- A plan hash is SHA-256 over one canonical JSON serialization of the projected reconciliation plan. Family
  selection is not part of the hash because the compiler plan is profile/parameter-definition truth shared by
  every selected family; the response repeats that projection per family for caller ergonomics.
- Loaded-family projection is a read operation, but it is not a cheap project-only collector. Full dense
  `FFManagerProfile` projection needs the family document: `Document.EditFamily` opens it, snapshot collectors
  read it without a transaction, and the handler closes it with `Close(false)`. It does not save or reload the
  family, so its honest intent is `Read`; its cost tier is `Expensive` and its supported document kind is
  `ProjectOnly`.
- `host.shell.open` is host-local. It is registered in the TypeScript-only operation schema/catalog and dispatched
  in the host process; it never crosses the Revit bridge and requires no active document or bridge session.

## Operation map

| Operation | Metadata / seam | Library entry point | Input DTO | Output DTO | Proof lane |
| --- | --- | --- | --- | --- | --- |
| `familyfoundry.plan` | C# bridge op; `Read`, `ProjectOnly`, bounded | strict `DesiredFamilyMigrationProfile` parse; `DesiredParameterCompiler` through the document-owned compile helper | `{ profileJson: string, familyId?: long }` | `{ planHash, families[], diagnostics[] }`; each family carries identity plus the reconciliation projection: resolved parameter definition, assignment, values-by-type, migration, per-field provenance, required APS names, local family-parameter names, and lowered actions | No-Revit wire/schema tests; deterministic SHA-256 unit test; source compile. Live Revit execution is deferred in `SHIMS.md`. |
| `familyfoundry.apply` | C# bridge op; `Mutate`, `ProjectOnly`, mutation cost | recompile with the same desired helper; compare hash; then `Document.ApplyDesiredFamilyMigrationProfile` once per explicit family so one failure cannot abort later families | `{ profileJson: string, familyIds: long[], expectedPlanHash: string }` | `{ planHash, refused, diagnostics[], receipts[] }`; receipt includes family identity, success/error, operations run, parameters changed, diff summary, and artifact directory | No-Revit wire/schema tests; source compile. Runtime mutation proof is explicitly out of scope and remains checked in `SHIMS.md`. |
| `familyfoundry.project` | C# bridge op; `Read`, `ProjectOnly`, expensive | `Document.EditFamily` -> `Document.CaptureFamilySnapshot` -> `FamilySnapshotProfileProjector.ProjectToProfile` -> strict inline JSON; always `Close(false)` when the handler opened the document | `{ familyIds: long[] }` | `{ projections[], diagnostics[] }`; each projection includes family identity and dense `FFManagerProfile` JSON as `profileJson` | No-Revit wire/schema tests; source compile. Full capture behavior requires the deferred FreshRevitProcess proof. |
| `host.shell.open` | TypeScript host-local op; `Mutate`, no active document | validate absolute existing path -> OS default handler (`Process.Start` semantics through the host process) | `{ path: string }` | `{ opened: boolean, path: string }` | Host-local contract/dispatch unit tests plus TypeScript check/build; no Revit lane. |

## Acceptance receipts

This section is updated only from commands actually run.

- Passed: isolated `Debug.R25` builds for `Pe.Shared.HostContracts`, `Pe.Revit.FamilyFoundry`, `Pe.App`,
  `Pe.Shared.Tests`, and the touched offline-catalog package `Pe.Dev.Cli` (0 warnings and 0 errors in each
  final build).
- Passed: `dotnet test source/Pe.Shared.Tests/Pe.Shared.Tests.csproj -c Debug.R25` (107 passed).
- Passed: the no-Revit plan-hash determinism test proves identical plans hash identically, dictionary insertion
  order is ignored, and a field change produces a different 64-character lowercase SHA-256 hash.
- Passed: `pnpm --filter @pe/host-contracts test` (16 passed) and `pnpm --filter @pe/host test`
  (45 passed, 2 skipped), including all four DTO shapes and host-local shell dispatch validation.
- Passed: from `source/pe-tools`, `pnpm codegen` and `pnpm codegen:check` generated and verified 57
  offline catalog operations, including all three `familyfoundry.*` operations. Root aliases were added so
  these mission commands are directly runnable.
- Passed: scope audit found no mission changes under `source/pe-tools/apps/web/src`; concurrent web work remains
  user-owned and excluded from every mission commit.
- Out of scope: live/FreshRevitProcess behavior proof; tracked in `SHIMS.md`.
