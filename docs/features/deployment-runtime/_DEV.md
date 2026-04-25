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
