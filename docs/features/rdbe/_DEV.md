# RevitDBExplorer Integration

## Current State

As of April 7, 2026, `Pe.Tools` integrates with RevitDBExplorer through the upstream `RevitDBExplorer.API` package, not through an embedded fork.

That means:

- `Pe.Tools` compiles against `RevitDBExplorer.API`
- users install full RevitDBExplorer separately
- at runtime, `Pe.Tools` asks the API package to hand specific objects off to the separately loaded RDBE add-in

This keeps RDBE ownership with upstream while still letting `Pe.Tools` snoop exact objects like `Family`, `FamilySymbol`, `FamilyParameter`, `Connector`, `View`, and similar items.

## Architecture

- `source/Pe.App/Services/RevitDbExplorerService.cs`
  - thin wrapper around `RevitDBExplorer.API`
  - owns all user-facing fallback dialogs
  - detects missing installs, known unsupported versions, and generic handoff failures
- `source/Pe.App/Commands/Palette/...`
  - palette actions call the local service
  - callers stay unaware of package/feed/runtime probing details
- `NuGet.Config`
  - adds the repo-local feed at `.nuget/local`
- `tools/rdbe/refresh-rdbe-api.ps1`
  - refreshes the vendored API package from upstream into the local feed
- `tools/rdbe/rdbe-api.lock.json`
  - pins the upstream repo ref used by the refresh script

## Runtime Flow

1. Palette code calls `RevitDbExplorerService.TrySnoopObject(...)` or `TrySnoopObjects(...)`.
2. The service filters nulls and materializes the input into an `object[]`.
3. The service calls `RevitDBExplorer.API.RevitDBExplorer.CreateController()`.
4. If Revit already loaded the full `RevitDBExplorer` add-in, the API package creates the controller and forwards the exact object(s) to RDBE.
5. If RDBE is missing, too old, or the handoff fails, `Pe.Tools` shows a TaskDialog with a link to `https://github.com/NeVeSpl/RevitDBExplorer/releases/latest`.

## Known Compatibility Issue

The latest public RDBE release we tested was `v2.5.0`, built from upstream commit `8c3dc4c`.

That version currently has a compatibility problem with the `RevitDBExplorer.API` snoop path used by `Pe.Tools`.

Observed failure:

- `Pe.Tools` passes a non-null `Document` into `controller.Snoop(doc, objectList)`
- upstream `APIAdapter` creates `SourceOfObjects` without preserving that `Document`
- later, the RDBE UI attempts to synchronize selection using `UIDocument`
- on `v2.5.0`, that path can fail with an `ArgumentNullException` involving `APIUIDocumentProxy.cpp` and `Parameter name: document`

Because this failure is confusing for end users, `Pe.Tools` now detects that specific error shape and shows a clearer message:

- `RevitDBExplorer 2.5.0 and below cannot snoop objects handed off from Pe.Tools. Please install a newer RevitDBExplorer release.`

All other unknown failures still go through the generic RDBE handoff error dialog.

## Upstream PR Filed

We filed an upstream PR on April 7, 2026 to fix the document propagation bug in the API path.

The fix is small:

- add a `SourceOfObjects` constructor that accepts a `Document`
- update `APIAdapter` to pass the `revitDocument` it already receives into that constructor

This is the bug `Pe.Tools` currently works around with the explicit `v2.5.0 and below` compatibility message.

Note:

- upstream commit `6bb4ed5` already fixed one downstream crash guard in this area after `v2.5.0`
- our PR addresses the deeper API-path issue by preserving document context at source construction time

## Refreshing the Vendored API Package

`RevitDBExplorer.API` is not currently consumed from public NuGet. To keep `Pe.Tools` CI-friendly, the package is vendored into this repo through a repo-local feed.

Refresh flow:

1. Run `tools/rdbe/refresh-rdbe-api.ps1`.
2. The script clones upstream RDBE into a temporary directory.
3. It checks out the pinned ref from `tools/rdbe/rdbe-api.lock.json`.
4. It runs `dotnet pack` on `sources/RevitDBExplorer.API/RevitDBExplorer.API.csproj`.
5. It replaces the package under `.nuget/local`.
6. It updates the `RevitDBExplorer.API` version in `source/Pe.App/Pe.App.csproj`.
7. It rewrites the lock file with the resolved commit and packaged version.

This keeps the refresh workflow reproducible and avoids side effects under `~/source/repos`.

## Why This Approach Was Chosen

- It keeps `Pe.Tools` CI-friendly.
  - The compile-time dependency is a tiny vendored package, not a user-specific local NuGet source.
- It keeps RDBE lifecycle ownership with upstream.
  - Users install and update RDBE through its normal release flow.
- It preserves object-level snooping.
  - `Pe.Tools` still hands exact Revit objects to RDBE instead of only opening RDBE on selection.
- It keeps palette code simple.
  - All runtime probing and fallback UX stays in one local service.

## Why Other Approaches Were Rejected

- Embedded fork with `EmbeddedInitializer`
  - This was the original implementation direction.
  - It required `Pe.Tools` to depend on a forked embedded RDBE package that only existed in a user-local feed.
  - CI and release builds broke because restore depended on a machine-specific NuGet source.
  - It also made `Pe.Tools` responsible for RDBE startup/bootstrap behavior that upstream already owns.

- Direct full-DLL reference to `RevitDBExplorer.dll`
  - This would make RDBE a hard runtime dependency instead of an optional integration.
  - Missing installs become assembly-load problems instead of a recoverable user-facing call to action.

- Raw vendored DLL with `HintPath`
  - This works, but it is a worse maintenance shape than vendoring the `.nupkg`.
  - Package restore is clearer and more reproducible than hand-managed local assembly references.

- Reflection-only integration implemented in `Pe.Tools`
  - This is technically possible.
  - We avoided it because it would duplicate the lookup/shim logic that upstream already packaged in `RevitDBExplorer.API`.
  - That would push more maintenance into `Pe.Tools`, which is the opposite of the goal.
