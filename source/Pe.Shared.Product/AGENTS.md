---
alwaysApply: true
---

# Pe.Shared.Product

## Purpose

Product identity and the local paths the product owns for its own mutable and user-authored files. Two questions only:

1. What is this product called by machines and users?
2. Where do product-owned state, logs, caches, and user-authored documents live?

It is NOT the installed-layout authority. `product.payloads.json` at the repo root is the single source of truth for the installed layout (payload names, entry executables, `bin/`, `shims/`, service ports and routes), and the SDK's `InstalledProduct` reads it. Nothing in this package restates it.

## Contents

- `ProductIdentity` — vendor name, product name, user-visible name.
- `ProductPathNames` — names of product-owned directories/files (`state`, `logs`, `cache`, `settings`, `workspaces`, `inline-scripts`, `output`, `Global`, `AGENTS.md`, `README.md`, `pod.json`, `host.log.txt`, `revit.log.txt`).
- `ProductRuntimeLayout` — the per-user product root plus the state/log/cache trees under it, including the APS token store. No binary paths.
- `ProductUserContentLayout` / `ScriptingWorkspaceLayout` — `Documents\Pe.Tools\...` settings, workspaces, inline scripts, output.
- `ProductPathing` — safe subdirectory resolution and LocalAppData lookup.
- `ProductRuntimeLane` — `Dev` / `Installed`.

## Hard Dependency Rule

Pure .NET/BCL. No Revit API, no ASP.NET/host packages, no `HttpClient`, no Newtonsoft or System.Text.Json, no other `Pe.*` project references. The csproj carries zero `PackageReference` entries; keep it that way.

## Transport Boundary

Transport left this package. `HostEndpoint` (service name, health/shutdown paths, `PE_TOOLS_*` env vars, base-URL resolution), `TsHostCallClient`, and the vendored `PeServiceDiscovery` live in `Pe.Shared.HostContracts/Transport` and `.../Vendor`. `HostEndpoint` reads `ProductRuntimeLayout.ForCurrentUser().RootPath` to find SDK service files — that is the only remaining coupling, and it points one way.

## Target Local Contract

Product-owned runtime files:

```text
%LocalAppData%\Positive Energy\Pe.Tools\
  state\
  logs\
  cache\
```

(The installer also lays binaries under this root. Their names and shape come from `product.payloads.json`, not from here.)

User-authored files:

```text
Documents\Pe.Tools\
  AGENTS.md
  README.md
  settings\<module>\<root>\
  settings\Global\{settings.json,fragments\,schemas\}
  workspaces\<slug>\{pod.json?,AGENTS.md,README.md,PeScripts.csproj,src\,.vscode\}
  inline-scripts\
  output\
```

Settings are flattened as `settings/<module>/<root>/`; do not reintroduce `settings/<module>/settings/<root>/`.

Workspace keys are user-facing slugs and must stay single-segment: `default` or lowercase ASCII letters/digits with hyphen separators. No nesting, spaces, dots, rooted paths, path separators, uppercase aliases, or compatibility fallbacks. `pod.json` is the manifest filename because Pods and loose workspaces share this root.

## Consumer Guidance

- Ask for intentful paths; do your own IO. Returned paths may not exist.
- This package never creates directories as a side effect of resolution.
- Greenfield: no `Documents\Pe.App` / `Documents\Pe.Scripting` fallbacks, no dual-read/dual-write. A one-time migration belongs in an explicit operator flow.
- Build and installer code that needs installed-layout facts reads `product.payloads.json` directly (see `build/Modules/CreateInstallerModule.cs`). Repo artifact topology belongs to `build/ProductLayoutAuthority.cs` and `build/BuildArtifactLayout.cs`.
