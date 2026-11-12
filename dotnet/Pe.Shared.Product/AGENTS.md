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
- `ProductUserContentLayout` / `ScriptingWorkspaceLayout` — the user home's preferences and the names inside a pod. `ProductPathing.MachinePropsPath` is the per-machine half of a pod's script project (`%LocalAppData%\Positive Energy\PeScripts.props`), outside every home and outside the installed root.
- `ProductPathing` — the content homes (ADR 0037): `Homes(pointer)` returns `ProductHomes` (`User`, `Project?`, `Firm?`, `SharedDriveRoot?`, `FirmConflict`), read order `[user, project, firm]`. A folder is a home only when its `pe-home.json` reads exactly `{"tier":"<tier>"}` (`MarkerTier`). The user home is `UserRoot()` (isolated `PE_TOOLS_PRODUCT_HOME`, else the Documents known folder's `Pe.Tools`). The firm home is probed on every drive (`<L>:\Shared drives\<child>\04 PE Software Files\Pe.Tools`, then `<L>:\04 PE Software Files\Pe.Tools`); two firm markers are a conflict and none is accepted. `PE_TOOLS_SHARED_ROOT` is a dev override that names the firm home itself and still needs the marker. The project home is `<shared drive root>\<pointer>\Pe.Tools`, where the shared drive root is the firm home's grandparent. Firm settings are `<firm>\Settings\<owner>.json` and `<firm>\keys.json`. The pure overload takes every fact as an argument, and TS asserts the same `ts/packages/host-contracts/tests/runtime-ownership.fixture.json` (`markers`, `homes`, `stateTree`). Also safe subdirectory resolution and the pure `StateRoot(lane, ownerRoot, home, shared, user)`: `<home>\.local-state` under the override (an isolated run shares no state with the owner's host), else the dev checkout's `.artifacts\pe-tools`, else the SDK install root verbatim; it refuses a root at or under the firm override or the Documents user root. TS `stateRoot` and PowerShell `Resolve-ProductRuntimeRoot` assert the fixture's `stateRoots`; PowerShell resolves no home.

## Hard Dependency Rule

Pure .NET/BCL. No Revit API, ASP.NET/host packages, `HttpClient`, JSON dependency, or other `Pe.*` project references. Keep the project free of `PackageReference` entries.

## Transport Boundary

Transport lives in `Pe.Shared.HostContracts`: `HostEndpoint`, `TsHostCallClient`, and the SDK-owned read-only `PeServiceDiscovery` projection. `HostEndpoint` reads only `ProductRuntimeLayout.Current`; the dependency points from transport to product identity, never back.

## Target Local Contract

```text
%LocalAppData%\Positive Energy\Pe.Tools\      (the machine state root; a dev checkout uses .artifacts\pe-tools)
  state\
    Work\  T3\
    Agent\AGENTS.md                           (the agent's guide, rewritten by bootstrap)
    Pages\<slug>\
    Runs\<pod-id>\<run-id>\                    (every run's input, outputs and receipt)
    Runs\_no-pod\                             (runs with no pod, and per-module task output)
    Runs\_inline\                             (the source of each inline snippet that ran; no run id)
    Blobs\sha256\<hash>
  logs\
  cache\

%LocalAppData%\Positive Energy\PeScripts.props  (this machine's script references; bootstrap rewrites it)

<a home: user, project or firm>\              (found by pe-home.json; the user home takes new pods)
  pe-home.json
  Pods\<local-folder>\{pod.json,settings\,src\,assets\,AGENTS.md,README.md,PeScripts.csproj}
  Pages\  Catalogs\
  Settings\<owner>.json
  keys.json                                   (firm home only)
  preferences.json                            (user home only)
```

The installer also lays binaries under the product root; their names and shape come from `product.payloads.json`, not this package.

The local folder is a filesystem address, not pod identity. A pod holds authored files only: a home may be shared, so nothing a machine derives and no run output is written into it. Native code never joins a folder name onto a home to find a pod; the host names the pod's absolute folder. Do not add legacy path fallbacks or dual-read/dual-write behavior here.

## Consumer Guidance

- Ask for intentful paths and perform IO at the caller boundary; resolution creates no directories.
- Ownership is told, never inferred (kaitpw, 2026-11-03): each shell calls `ProductRuntimeLayout.Configure` once from facts it was given — Pe.App from `PePayloadContext` (installed root = the SDK `InstallRoot`; a dev payload without a session descriptor refuses), `Pe.Host.Tray` and `Pe.Rhvac.Tool` from a leading `--lane --root` argv (one grammar, `ProductRuntimeLayout.ParseOwnerArguments`), `Pe.Dev.Cli` from the operator's checkout. A second call throws; reading `Current` before it throws. Revit test runs need no fixture: the SDK boots Pe.App, which configures. Libraries read `Current`; nothing walks up from an assembly location. An installed runtime refuses `PE_TOOLS_PRODUCT_HOME` as v0.7.30 did; that refusal lives in the pure state-root rule of all three languages.
- Every Pe.Tools-owned path, including scratch, must derive from `ProductRuntimeLayout` / `ProductUserContentLayout`, TS `productRoot(owner)` / `hostOwnership.rootPath` / `product-paths`, or PowerShell `tools/product-paths.ps1`. `PE_TOOLS_PRODUCT_HOME` selects the whole environment. The production-only `product-environment.guard.test.ts` rejects direct OS-root reads outside these resolvers; each third-party or SDK exception names its reason.
- Build and installer code reads installed-layout facts directly from `product.payloads.json`.
- Repo artifact topology belongs to `build/ProductLayoutAuthority.cs` and `build/BuildArtifactLayout.cs`.
