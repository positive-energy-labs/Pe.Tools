# Environment and Repo Workflows

`../BUILD.md` is the canonical repo guide for build, runtime, package, install, and Revit proof lanes. Keep command decision tables and build/runtime vocabulary there.

Use this file only for environment-specific recovery notes that do not belong in the root build guide.

## Dotnet sandbox recovery

Use the wrapper only as an escape hatch when `dotnet` reports unsafe Windows environment variables or `Value cannot be null. (Parameter 'path1')`.

```powershell
.\tools\dotnet-sandbox-safe.ps1 build .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25
```

The script repairs child-process environment, shuts down poisoned build servers, and adds `--disable-build-servers` where supported.

## Current workflow map

- Safe source compile, package, publish, installed-lane, codegen, Pea dev refresh, and Revit proof-lane commands: `../BUILD.md`.
- Runtime path and install ownership model: `../BUILD.md`.
- Pea operator/deployed-agent model: `source/pea/AGENTS.md`.
- Revit test runner specifics: `source/Pe.Revit.Tests/AGENTS.md`.

Do not restore removed public `pe-dev` command groups (`doctor`, `status`, `sync`, `env`, `revit`, or `verify`) as environment guidance. Attached RRD work now uses Rider/IDE builds plus dev-agent live-loop tooling.
