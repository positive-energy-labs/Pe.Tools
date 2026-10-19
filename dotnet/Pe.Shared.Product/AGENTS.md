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
- `ProductUserContentLayout` / `ScriptingWorkspaceLayout` — `Documents\Pe.Tools\preferences.json` and portable Pods.
- `ProductPathing` — the product home (`PE_TOOLS_PRODUCT_HOME`, else `Documents\Pe.Tools`; the host resolves the same variable), safe subdirectory resolution and the machine-local runtime root (`%LOCALAPPDATA%\Positive Energy\Pe.Tools`, or `<home>\.local-state` when the override is set, so an isolated run shares no state with the owner's host; the host's `productRoot` resolves the same way).

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
  preferences.json
  Pods\<local-folder>\{pod.json,settings\,src\,assets\,output\,AGENTS.md,README.md,PeScripts.csproj,.vscode\}
```

The installer also lays binaries under the product root; their names and shape come from `product.payloads.json`, not this package.

The local folder is a filesystem address, not pod identity. Authored JSON, scripts, assets, and useful output stay inside that pod folder. Do not add legacy path fallbacks or dual-read/dual-write behavior here.

## Consumer Guidance

- Ask for intentful paths and perform IO at the caller boundary; resolution creates no directories.
- Every Pe.Tools-owned path, including scratch, must derive from `ProductRuntimeLayout` / `ProductUserContentLayout`, TS `productRoot` / `product-paths`, or PowerShell `tools/product-paths.ps1`. `PE_TOOLS_PRODUCT_HOME` selects the whole environment. The production-only `product-environment.guard.test.ts` rejects direct OS-root reads outside these resolvers; each third-party or SDK exception names its reason.
- Build and installer code reads installed-layout facts directly from `product.payloads.json`.
- Repo artifact topology belongs to `build/ProductLayoutAuthority.cs` and `build/BuildArtifactLayout.cs`.
