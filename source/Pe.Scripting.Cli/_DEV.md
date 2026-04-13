# Pe.Scripting.Cli

## Mental Model

The CLI is the stable run-first outer loop for scripting. It validates the supported input shape, posts one sync request to `Pe.Host`, and prints the returned output and diagnostics.

## Architecture

- argument parsing and local workspace preflight happen first
- request construction can include:
  - inline source
  - workspace-relative source path
  - current `PeScripts.csproj` content
- execution goes through host HTTP, not directly to the Revit pipe
- host then proxies to the internal scripting pipe
- one response returns buffered output plus structured diagnostics

## Key Flows

- workspace file run:
  - `pe-script src\MyProbe.cs`
  - validates the file under the default workspace root
  - posts `ExecuteRevitScriptRequest` to `/api/scripting/execute`
- stdin run:
  - `Get-Content .\Scratch.cs | pe-script --stdin --name Scratch.cs`
  - posts inline snippet content to the same host endpoint
- `new` command:
  - stays local-only
  - creates a workspace-relative `.cs` file skeleton

## Open Questions

- whether the CLI should eventually grow explicit bootstrap/status subcommands
- whether host auto-start is worth adding once the sync lane is stable
