# RevitDBExplorer Integration

## Current State

As of April 7, 2026, `Pe.Tools` integrates with RevitDBExplorer through the upstream `RevitDBExplorer.API` package, not through an embedded fork.
As of April 10, 2026, `Pe.Tools` integrates RDBE via nuget, the maintainer merged the pr and released a new verison. see https://github.com/NeVeSpl/RevitDBExplorer/pull/36

## Architecture

- `source/Pe.App/Services/RevitDbExplorerService.cs`
  - thin wrapper around `RevitDBExplorer.API`
  - owns all user-facing fallback dialogs
  - detects missing installs, known unsupported versions, and generic handoff failures
- `source/Pe.App/Commands/Palette/...`
  - palette actions call the local service
  - callers stay unaware of package/feed/runtime probing details

## Runtime Flow

1. Palette code calls `RevitDbExplorerService.TrySnoopObject(...)` or `TrySnoopObjects(...)`.
2. The service filters nulls and materializes the input into an `object[]`.
3. The service calls `RevitDBExplorer.API.RevitDBExplorer.CreateController()`.
4. If Revit already loaded the full `RevitDBExplorer` add-in, the API package creates the controller and forwards the exact object(s) to RDBE.
5. If RDBE is missing, too old, or the handoff fails, `Pe.Tools` shows a TaskDialog with a link to `https://github.com/NeVeSpl/RevitDBExplorer/releases/latest`.
