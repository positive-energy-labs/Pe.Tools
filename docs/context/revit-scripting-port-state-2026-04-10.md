# Revit Scripting Productization State

## Scope Completed

- Added a new scripting contract lane in `Pe.Shared.HostContracts`.
- Added a dedicated `Pe.Revit.Scripting` runtime project.
- Added a dedicated `Pe.Scripting.Cli` package for workspace-first script execution without a VSIX.
- Ported and re-sliced:
  - workspace/bootstrap generation
  - csproj parsing and regeneration
  - local DLL hint-path resolution
  - `PackageReference` resolution from the NuGet cache with separate compile/runtime asset selection
  - Roslyn compile/load/execute for `PeScriptContainer`
  - automatic transaction wrapper with nested-transaction retry
- Added opt-in Revit bridge auto-connect through `PE_SETTINGS_BRIDGE_AUTO_CONNECT=true`.
- Added Revit test coverage for project generation, resolution, workspace-path execution, and container validation behavior.

## DTOs And Types Added

Shared contracts:

- `ScriptWorkspaceBootstrapRequest`
- `ScriptWorkspaceBootstrapData`
- `ExecuteRevitScriptRequest`
- `ExecuteRevitScriptData`
- `ScriptExecutionSourceKind`
- `ScriptExecutionStatus`
- `ScriptDiagnostic`
- `ScriptDiagnosticSeverity`

Runtime surface:

- `PeScriptContainer`
- `RevitScriptContext`
- `RevitScriptBridgeService`
- `RevitScriptExecutionService`
- `ScriptOutputSink`
- `ScriptWorkspaceBootstrapService`
- `ScriptProjectGenerator`
- `ScriptReferenceResolver`

## Storage Layout

Base root:

- `Documents\Pe.Scripting`

Current default workspace:

- `Documents\Pe.Scripting\workspace\default`

Generated layout:

- `PeScripts.csproj`
- `AGENTS.md`
- `.vscode/settings.json`
- `README.md`
- `src/`
- `src/SampleScript.cs`
- `AiGeneratedSnippets/`

## Generated Project Shape

The generated project currently:

- preserves user `<Reference>` entries with `HintPath`
- preserves user `<PackageReference>` entries
- injects current-runtime defaults for:
  - `TargetFramework`
  - `LangVersion`
  - `PlatformTarget`
  - `EnableDefaultCompileItems`
  - `OutputType`
  - `ProduceReferenceAssembly`
  - `ImplicitUsings`
  - `Nullable`
- injects default package references for:
  - `Nice3point.Revit.Api.RevitAPI`
  - `Nice3point.Revit.Api.RevitAPIUI`
- injects a local runtime reference to `Pe.Revit.Scripting.dll`
- injects global using entries for common .NET and Revit namespaces plus `Pe.Revit.Scripting`
- emits generated `README.md` and `AGENTS.md` guidance for the supported workspace-first single-file lane

## Extension Seams

These are the intended patch points for future work:

- request normalization and guard logic:
  - `source/Pe.Revit.Scripting/Execution/RevitScriptExecutionService.cs`
- CLI run flow:
  - `source/Pe.Scripting.Cli/Program.cs`
- project regeneration policy:
  - `source/Pe.Revit.Scripting/Bootstrap/ScriptProjectGenerator.cs`
- workspace file policy and storage layout:
  - `source/Pe.Revit.Scripting/Bootstrap/ScriptWorkspaceBootstrapService.cs`
  - `source/Pe.Revit.Scripting/Storage/RevitScriptingStorageLocations.cs`
- csproj parsing policy:
  - `source/Pe.Revit.Scripting/References/CsProjReader.cs`
- assembly/package resolution policy:
  - `source/Pe.Revit.Scripting/References/ScriptReferenceResolver.cs`
- assembly load and type-identity behavior:
  - `source/Pe.Revit.Scripting/Execution/ScriptAssemblyLoadService.cs`
- compile-time usings and Roslyn behavior:
  - `source/Pe.Revit.Scripting/Execution/ScriptCompilationService.cs`
- transaction policy and execution staging:
  - `source/Pe.Revit.Scripting/Execution/RevitScriptExecutionService.cs`
- direct transport wiring:
  - `source/Pe.Revit.Scripting/Transport/ScriptingPipeServer.cs`
  - `source/Pe.Revit.Scripting/Transport/ScriptingPipeMessageHandler.cs`
  - `source/Pe.Scripting.Cli/Program.cs`

## Known Limitations Intentionally Deferred

- no arbitrary local file execution outside the workspace
- no multi-file execution
- no source-bundle/package execution format yet
- no script guard or security review stage yet
- no Task Palette integration
- no cancellation yet
- output capture still supports `Console.WriteLine(...)` as a compatibility path via process-global redirection
- sibling DLL discovery is directory-based and pragmatic, not a strict dependency graph loader
- no attempt to unload compiled script assemblies between runs

## Next Recommended Tasks

- add request-level script guard and policy enforcement before resolution/compile
- harden runtime diagnostics around assembly load failures and version mismatches
- decide whether to replace console capture with a less process-global compatibility strategy
- add cancellation and long-running execution controls
- add explicit snippet persistence mode for AI-generated source
- design manifest-first source-package sharing without destabilizing the single-file lane

## Validation Performed

- `dotnet build Pe.Tools.slnx -c Debug.R25 /p:WarningLevel=0`
- `dotnet run --project source/Pe.Scripting.Cli/Pe.Scripting.Cli.csproj -- --help`
- `dotnet run --project source/Pe.Scripting.Cli/Pe.Scripting.Cli.csproj -- src\DoesNotExist.cs`

The implementation compiles for the `Debug.R25` solution configuration. CLI argument/path validation was smoke-checked locally. No Revit-backed smoke tests were run in this pass.

## Resume Here

- add script guard / security policy stage
- add AI snippet persistence mode
- add source-package sharing model
- add cancellation / execution control
- decide Task Palette integration or keep separate
