---
alwaysApply: true
---

# Pe.Shared.Product

## Purpose

Product identity and the local paths the product owns for its mutable and user-authored files:

1. What is this product called by machines and users?
2. Where do product-owned state, logs, caches, and user-authored documents live?

It is not the installed-layout authority. `product.payloads.json` is the single source of truth for payload names, entry executables, binary/shim shape, service routes, and the SDK-installed layout.

## Contents

- `ProductIdentity` — vendor, product, and user-visible names.
- `ProductPathNames` — product-owned state and user-content names.
- `ProductRuntimeLayout` — LocalAppData state/log/cache trees, including APS tokens. No binary paths.
- `ProductUserContentLayout` / `ScriptingWorkspaceLayout` — `Documents\Pe.Tools\...` settings, workspaces, inline scripts, and output.
- `ProductPathing` — safe subdirectory resolution and LocalAppData lookup.

## Hard Dependency Rule

Pure .NET/BCL. No Revit API, ASP.NET/host packages, `HttpClient`, JSON dependency, or other `Pe.*` project references. Keep the project free of `PackageReference` entries.

## Transport Boundary

Transport lives in `Pe.Shared.HostContracts`: `HostEndpoint`, `TsHostCallClient`, and the SDK-owned read-only `PeServiceDiscovery` projection. `HostEndpoint` reads only `ProductRuntimeLayout.ForCurrentUser().RootPath`; the dependency points from transport to product identity, never back.

## Target Local Contract

```text
%LocalAppData%\Positive Energy\Pe.Tools\
  state\
  logs\
  cache\

Documents\Pe.Tools\
  AGENTS.md
  README.md
  settings\<module>\<root>\
  settings\Global\{settings.json,fragments\,schemas\}
  workspaces\<slug>\{pod.json?,AGENTS.md,README.md,PeScripts.csproj,src\,.vscode\}
  inline-scripts\
  output\
```

The installer also lays binaries under the product root; their names and shape come from `product.payloads.json`, not this package.

Settings stay flattened as `settings/<module>/<root>/`. Workspace keys are one user-facing slug: `default` or lowercase ASCII letters/digits with hyphen separators. Do not add legacy path fallbacks or dual-read/dual-write behavior here.

## Consumer Guidance

- Ask for intentful paths and perform IO at the caller boundary; resolution creates no directories.
- Build and installer code reads installed-layout facts directly from `product.payloads.json`.
- Repo artifact topology belongs to `build/ProductLayoutAuthority.cs` and `build/BuildArtifactLayout.cs`.
