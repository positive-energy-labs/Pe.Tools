This document saves a workflow for posterity. Its the best approach to using open source code if the appropriate nuget packages are not published and/or
patching upstream is necessary. The below was copy pasted from old docs on RDBE and not modified afterwards. Its still uses rdbe specific info
but the ideas are still applicable

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
