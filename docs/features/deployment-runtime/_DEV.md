# Deployment Runtime

## Mental Model

- `Documents` is for user-authored content.
- `%LocalAppData%\Positive Energy\Pe.Tools\` is for deployed runtime files and mutable runtime data.
- `Pe.Host` stays a headless local transport/process boundary.
- `pe-dev` stays a separate CLI executable installed beside `Pe.Host`.

## Supported Install Scope

- Supported deployed shape: per-user only
- Installed runtime root: `%LocalAppData%\Positive Energy\Pe.Tools\`
- Installed runtime binaries: `%LocalAppData%\Positive Energy\Pe.Tools\Host\`
- Revit add-in install: `%AppData%\Autodesk\Revit\Addins\`
- No PATH registration for `pe-dev`
- No multi-user installer contract in this slice

## Path Contract

| Area | Path | Ownership |
| --- | --- | --- |
| Settings documents | `Documents\Pe.App\...` | user-authored |
| Global fragments | `Documents\Pe.App\Global\fragments\...` | user-authored |
| Scripting workspace | `Documents\Pe.Scripting\workspace\<key>\...` | user-authored |
| Existing command/task outputs | `Documents\Pe.App\...\output\...` | user-facing output |
| Installed host + CLI | `%LocalAppData%\Positive Energy\Pe.Tools\Host\...` | deployed runtime |
| Runtime state | `%LocalAppData%\Positive Energy\Pe.Tools\State\...` | mutable runtime state/cache |
| Logs | `%LocalAppData%\Positive Energy\Pe.Tools\Logs\...` | mutable runtime logs |
| Reserved cache root | `%LocalAppData%\Positive Energy\Pe.Tools\Cache\...` | reserved for future runtime cache use |

## Authored vs Runtime Rules

- Keep authored settings and script sources in `Documents`.
- Keep logs out of `Documents`.
- Keep operational state and caches out of `Documents`.
- Do not route local dev builds through the installed runtime root.
- Do not make `Pe.Host` own desktop UI or updater windows.

## Dev vs Prod Resolution

- Deployed runtime discovery resolves installed binaries under `%LocalAppData%\Positive Energy\Pe.Tools\Host\`.
- Override-first behavior remains valid for local development.
- Rider/package-local outputs remain the dev truth for RRD, hot reload, test hooks, and local CLI usage.
- `source/Pe.App/Pe.App.csproj` build hooks continue using repo-local `PeStableCliPath`.
- `source/Pe.App/SettingsEditor/SettingsEditorHostLauncher.cs` still prefers `PE_SETTINGS_EDITOR_HOST_EXECUTABLE_PATH` before installed-path probing.

## Assembly Control

- RRD is the only lane where Rider hot reload can patch already-loaded `Pe.App` runtime assemblies.
- Plain terminal `dotnet build` now writes isolated outputs under `.artifacts/...`; that lane is compile-safe but does not refresh assemblies already loaded into any running Revit process.
- Rider builds and explicit `/p:PeIsolatedBuild=false` shell builds write package-local interactive outputs; those outputs are the baseline Rider hot reload and live desktop debugging work against.
- The deployed `%AppData%\Autodesk\Revit\Addins\<year>\Pe.App.addin` path controls normal desktop add-in bootstrap for that Revit year.
- `pe-dev revit script ...` and raw `.Tests` runs do not become fresh just because the isolated lane rebuilt. If the probe depends on changed runtime packages, the RRD lane still needs explicit `pe-dev revit sync-runtime` first.
- `pe-dev revit test ...` intentionally avoids RRD. It quarantines the deployed `Pe.App` add-in for the selected year, launches a dedicated test-controlled Revit process, and runs against the freshly built isolated `.Tests` graph instead of the deployed desktop add-in graph.
- The Revit window left behind by `pe-dev revit test` is useful for inspection, but not as a freshness-safe reusable host for `Pe.App` graph changes. Under the current `ricaun.RevitTest` execution model, the next test run should recycle that owned session instead of attaching to it.

## Freshness Rules

- Isolated build freshness means: the files under `.artifacts/...` are current.
- RRD freshness means: Rider hot reload or a Rider-driven Revit restart has updated the live in-memory desktop runtime.
- Dedicated test freshness means: `pe-dev revit test` launched a fresh test-controlled Revit process for the selected year after hiding the deployed desktop add-in for that year.
- These freshness states are not interchangeable. One can be fresh while the others are stale.

## Update Ownership

- No auto-update or silent update in this slice.
- Installer owns install and replace.
- Future visible update UX should be Revit-owned, not host-owned.
- `Pe.Host` should not become an updater or WPF shell.

## Scripting Entry Point

- Keep `pe-dev revit script ...` as the primary operator entrypoint.
- Keep script execution flowing through host HTTP.
- Do not collapse the CLI into `Pe.Host.exe`.
- Use `pe-dev revit session` as the unified status command for local process state plus host-status visibility.
