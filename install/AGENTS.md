# install

## Scope

Owns MSI authoring for the per-user Pe.Tools install.

## Purpose

The installer is the product bootstrap for local terminal and desktop Revit use. It turns the build-authored installer payload manifest into a selectable per-user MSI while keeping install ownership, PATH registration, and uninstall cleanup explicit.

## Critical Entry Points

- `Installer.cs` - installer entrypoint; reads `--manifest`, validates payload identity, builds the WiX project, and wires component actions.
- `Installer.Components.cs` - installer product-slice/component taxonomy and ownership-policy vocabulary.
- `Installer.Configuration.cs` - resolves WiX install roots from `Pe.Shared.Product` layout projection.
- `Installer.RevitAddinComponent.cs` - desktop Revit add-in files installed into `%AppData%\Autodesk\Revit\Addins\<year>`.
- `Installer.HostRuntimeComponent.cs` - installed shared `Pe.Host` runtime under `%LocalAppData%\Positive Energy\Pe.Tools\bin\host`.
- `Installer.PeaCliComponent.cs` - PATH-visible `pea` bootstrap plus payload package/custom action handling.
- `Installer.CustomActions.cs` - generated install state expansion/removal and Revit add-in cleanup.

## Shared Language

| Term | Meaning |
| --- | --- |
| **installer product slice** | User-facing install concern such as `desktop-runtime` or `pea-cli-bootstrap`. A slice may contain multiple MSI components. |
| **installer component** | Concrete authored unit that contributes directories, files, PATH entries, or custom actions to the MSI. |
| **desktop runtime** | The installed Revit add-in plus the shared installed host runtime it launches. Keep this in Addins/year layout to match the Nice3point SDK local debug provenance model. |
| **CLI bootstrap** | PATH-visible command entrypoint installed under the product runtime root. Bootstrap files are distinct from generated payload/version state. |
| **owned install tree** | Files/directories the MSI or product custom actions own and may remove on uninstall. |
| **generated install state** | Files created after MSI file copy, such as `pea` extracted versions and `current.txt`; cleanup must be custom-action owned. |
| **user runtime state** | Durable user state/log/cache under the product runtime root; do not remove during ordinary uninstall without an explicit purge feature. |
| **legacy install shape** | Previously authored product path that is no longer current. Cleanup is optional and must be conservative/product-identified. |

## Living Memory

- Keep Revit desktop install in `%AppData%\Autodesk\Revit\Addins\<year>` unless the provenance model changes. The Nice3point SDK dev workflow copies to the same Addins/year shape during debug sessions, and matching prod/dev provenance avoids loaded-assembly ambiguity.
- Use installer product slices for user-facing grouping and installer components for implementation details. Do not overload WiX `Feature` as the only architecture vocabulary.
- PATH registration is part of CLI bootstrap ownership. The installer owns `pea` PATH behavior only; `pe-dev` is source/dev-only and must not become an MSI slice again.
- Uninstall cleanup should remove owned/generated install trees, not user runtime state/log/cache by default.
- MSI upgrades intentionally replace the installed host runtime tree under `%LocalAppData%\Positive Energy\Pe.Tools\bin\host`; the host component may stop a running installed `Pe.Host.exe` before `InstallFiles` so stable .NET file versions cannot leave stale host contracts behind.
- Never point installed host cleanup at `%LocalAppData%\Positive Energy\Pe.Tools\dev\bin\host`; that dev-lane root is owned by interactive builds/RRD sync, not the MSI.
- Legacy-shape cleanup removes early beta names such as `PE_Tools` from both per-user and ProgramData `Autodesk\ApplicationPlugins` roots, including `.bundle` directories, and from both per-user and ProgramData `Autodesk\Revit\Addins\<year>` roots. Keep this conservative and product-name based.
