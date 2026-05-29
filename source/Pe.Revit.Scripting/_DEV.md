# Pe.Revit.Scripting

## Mental Model

This package is the Revit-side execution pipeline for a submitted C# source set. Callers decide when to run; this package decides how source becomes a `PeScriptContainer` executing on the Revit thread.

## Architecture

- Bootstrap creates or refreshes a host-owned workspace and `PeScripts.csproj`.
- Source normalization turns inline content or a workspace path into a `ScriptExecutionPlan`.
- Reference resolution reads project references/packages and separates compile/runtime assets.
- Shared scripting services compile source, produce diagnostics, and find entry-point candidates.
- Policy runs before compilation and rejects process/shell, unmanaged interop, and script-owned Revit transactions.
- Execution assigns `RevitScriptContext`, captures output, writes artifacts, and optionally wraps the run in one host-owned transaction.
- Bridge-dispatched requests reach the Revit thread through `ScriptingBridgeMessageHandler` and `ExternalEvent`.

## Key Flows

### Workspace bootstrap

- Resolve Revit version and target framework.
- Ensure product-home guidance files exist.
- Create/refresh the workspace and generated project files.
- Preserve supported user references/packages.
- Generate README/AGENTS/JOIN_GUIDE/sample files when appropriate.

### Host-backed execute

- Caller hits `Pe.Host`.
- Host forwards one scripting request over the private Host/Revit bridge.
- Revit handles the request on the Revit thread.
- The scripting runtime returns one final result payload.

## Validation Posture

- Plain terminal `dotnet build` proves the isolated compile lane only.
- Live scripting validation uses the assemblies loaded in the running Revit process. If runtime packages changed, refresh that runtime first (`pe-dev sync` in repo-local RRD work) before trusting `pea script ...` behavior.

## Open Questions

- How source-package sharing should reuse this pipeline without weakening the stable single-file lane.
- Where a future out-of-proc host-composition runner should live if scripts need host-client joins without running inside a bridge request.
