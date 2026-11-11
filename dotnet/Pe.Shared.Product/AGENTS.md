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
- `ProductLane` / `ProductRuntimeLayout` — the process's one runtime record (lane, owner root, state root) and its state/log/cache/scratch trees, including APS tokens. No binary paths.
- `ProductUserContentLayout` / `ScriptingWorkspaceLayout` — content preferences and portable Pods.
- `ProductPathing` — the two content homes (ADR 0035 rule 11): `UserRoot()` always (isolated `PE_TOOLS_PRODUCT_HOME`, else the Documents known folder's `Pe.Tools`, OneDrive when it redirects Documents) takes every write and all Work; optional `SharedRoot()` (`PE_TOOLS_SHARED_ROOT`) reads after it, so `ContentHomes()` is `[user, shared?]` and the user's copy wins; `SharedFirmDir()` / `SharedKeysPath()` are `<shared>\Firm` and `<shared>\keys.json`, null without a shared root. The host resolves the same names. Also safe subdirectory resolution and the pure `StateRoot(lane, ownerRoot, home, shared, user)`: `<home>\.local-state` under the override (an isolated run shares no state with the owner's host), else the dev checkout's `.artifacts\pe-tools`, else the SDK install root verbatim; it refuses a root at or under the shared root or the Documents user root. TS `stateRoot` and PowerShell `Resolve-ProductRuntimeRoot` assert the same `ts/packages/host-contracts/tests/runtime-ownership.fixture.json`.

## Hard Dependency Rule

Pure .NET/BCL. No Revit API, ASP.NET/host packages, `HttpClient`, JSON dependency, or other `Pe.*` project references. Keep the project free of `PackageReference` entries.

## Transport Boundary

Transport lives in `Pe.Shared.HostContracts`: `HostEndpoint`, `TsHostCallClient`, and the SDK-owned read-only `PeServiceDiscovery` projection. `HostEndpoint` reads only `ProductRuntimeLayout.Current`; the dependency points from transport to product identity, never back.

## Target Local Contract

```text
%LocalAppData%\Positive Energy\Pe.Tools\
  state\
  logs\
  cache\

<user root: PE_TOOLS_PRODUCT_HOME, else Documents\Pe.Tools>\   (every write; also Work\)
  AGENTS.md
  README.md
  preferences.json
  Pods\<local-folder>\{pod.json,settings\,src\,assets\,output\,AGENTS.md,README.md,PeScripts.csproj,.vscode\}

<PE_TOOLS_SHARED_ROOT>\   (optional, read after the user root, never written)
  Pods\  Pages\  Catalogs\
  Firm\<owner>.json
  keys.json
```

The installer also lays binaries under the product root; their names and shape come from `product.payloads.json`, not this package.

The local folder is a filesystem address, not pod identity. Authored JSON, scripts, assets, and useful output stay inside that pod folder. Do not add legacy path fallbacks or dual-read/dual-write behavior here.

## Consumer Guidance

- Ask for intentful paths and perform IO at the caller boundary; resolution creates no directories.
- Ownership is told, never inferred (kaitpw, 2026-11-03): each shell calls `ProductRuntimeLayout.Configure` once from facts it was given — Pe.App from `PePayloadContext` (installed root = the SDK `InstallRoot`; a dev payload without a session descriptor refuses), `Pe.Host.Tray` and `Pe.Rhvac.Tool` from a leading `--lane --root` argv (one grammar, `ProductRuntimeLayout.ParseOwnerArguments`), `Pe.Dev.Cli` from the operator's checkout. A second call throws; reading `Current` before it throws. Revit test runs need no fixture: the SDK boots Pe.App, which configures. Libraries read `Current`; nothing walks up from an assembly location. An installed runtime refuses `PE_TOOLS_PRODUCT_HOME` as v0.7.30 did; that refusal lives in the pure state-root rule of all three languages.
- Every Pe.Tools-owned path, including scratch, must derive from `ProductRuntimeLayout` / `ProductUserContentLayout`, TS `productRoot(owner)` / `hostOwnership.rootPath` / `product-paths`, or PowerShell `tools/product-paths.ps1`. `PE_TOOLS_PRODUCT_HOME` selects the whole environment. The production-only `product-environment.guard.test.ts` rejects direct OS-root reads outside these resolvers; each third-party or SDK exception names its reason.
- Build and installer code reads installed-layout facts directly from `product.payloads.json`.
- Repo artifact topology belongs to `build/ProductLayoutAuthority.cs` and `build/BuildArtifactLayout.cs`.
