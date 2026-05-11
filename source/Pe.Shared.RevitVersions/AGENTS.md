# Pe.Shared.RevitVersions

## Scope

Owns shared Revit compatibility metadata that must be visible to build tooling, developer CLI flows, and Design Automation orchestration.

## Boundary

Keep this package separate from `Pe.Shared.Product`. Product identity/layout answers where Pe.Tools lives locally; Revit version metadata answers which Autodesk Revit versions, engines, package versions, and target frameworks a workflow can use.

This package is the right place for:

- Revit year to configuration suffix mapping, e.g. `2025` -> `R25`.
- Design Automation engine IDs and package versions.
- Revit-version target-framework metadata needed outside MSBuild.
- Whether a Revit year is supported for Design Automation execution.

This package is not the place for:

- `.artifacts` paths or package output paths.
- installed product roots, user-content roots, runtime bins, or host/pea directory names.
- build workflow policy such as package/publish/verify execution policy.

## Living Memory

- Revit 2023 remains a desktop/runtime compatibility target, but it is not a Design Automation execution target.
- Design Automation support currently starts at Revit 2024. Legacy/source 2023 models should route through supported upgrade/execution paths, not through a Revit 2023 DA appbundle.
- Keep `build/authored/BuildMatrix.props` and `RevitVersionCatalog` semantically aligned: if a year stops supporting DA in one, update the other and regenerate build contracts.
