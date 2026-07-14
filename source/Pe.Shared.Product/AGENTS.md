---
alwaysApply: true
---

# Pe.Shared.Product

## Purpose

`Pe.Shared.Product` is the repo's foundational authority for product identity and local layout. It answers two questions:

1. What is this product called by machines, users, installers, and Revit?
2. Where should product-owned files live on the local machine or in user-authored document space?

Keep this package small, pure, and boring. It should be safe to reference from build scripts, installer code, TS host packaging, `pea` support code, Revit packages, automation packages, and tests.

## Taxonomy

Use this package for:

- **Product identity**: vendor name, product name, executable names, add-in manifest names, stable command names, folder names, and machine identity strings.
- **User space**: user-authored settings, scripting workspaces, fragments, and durable command output roots.
- **Runtime locations**: installed binaries, mutable state, logs, caches, token stores, test-owned state, and quarantine roots.
- **Deployment identity**: Revit add-in manifest naming and per-user add-in manifest paths.
- **Build-facing projection**: pure identity/layout projections that build props, installer code, and other non-runtime tooling can generate from.

Do not use this package for:

- HTTP routes, operation keys, SSE event names, WebSocket frame contracts, or bridge protocol payloads.
- Host startup orchestration, process probing, request execution, or ASP.NET behavior.
- Revit API collection, document state, UI session behavior, WPF, ribbon, or add-in startup.
- Settings schema generation, module registration, profile validation, or storage runtime behavior.
- TypeScript generation mechanics. Generate from this package later if needed, but do not make this package depend on generators.

## Hard Dependency Rule

This package must remain pure .NET/BCL:

- No Revit API references.
- No ASP.NET or host package references.
- No TypeGen/codegen references.
- No Newtonsoft/System.Text.Json dependency unless explicitly justified by a runtime manifest type.
- No dependency on other `Pe.*` packages unless this guidance is intentionally revised.

## Target Local Contract

Runtime files are rooted under:

```text
%LocalAppData%\Positive Energy\Pe.Tools\
  bin\
    host\
    pea\
  state\
  logs\
  cache\
```

User-authored files are rooted under:

```text
Documents\Pe.Tools\
  AGENTS.md
  README.md
  settings\
    <module>\
      <root>\
    Global\
      settings.json
      fragments\
      schemas\
  workspaces\
    <slug>\
      pod.json (optional; turns the workspace into strict Pod mode)
      AGENTS.md
      README.md
      PeScripts.csproj
      src\
      .vscode\
  inline-scripts\
  output\
```

Settings are flattened as `settings/<module>/<root>/`; do not reintroduce `settings/<module>/settings/<root>/`.

Workspace keys are user-facing slugs and must stay single-segment: `default` or lowercase ASCII letters/digits with hyphen separators. Do not allow nesting, spaces, dots, rooted paths, path separators, uppercase aliases, or compatibility fallbacks. `pod.json` is the product-level manifest filename because Pods and loose workspaces share this root.

Revit add-in manifests still live in Autodesk's per-user add-in folder:

```text
%AppData%\Autodesk\Revit\Addins\<year>\Pe.App.addin
```

The manifest path belongs here because it is product deployment identity, even though Revit loads it.

## API Shape

Prefer immutable typed layout objects with domain-nested properties:

```csharp
var runtime = ProductRuntimeLayout.ForCurrentUser();
var hostExe = runtime.Binaries.HostExecutablePath;
var hostLog = runtime.Logs.HostLogPath;
var tokenStore = runtime.State.ApsTokenStorePath;

var userContent = ProductUserContentLayout.ForCurrentUser();
var workspaceRoot = userContent.Scripting.ResolveWorkspaceRoot(workspaceKey);
```

Avoid generic string dictionaries, stringly typed path IDs, or a single `Locations` god class. The object graph should teach the domain boundary to humans and agents.

## Migration Posture

This repo is greenfield. Prefer clean target paths over compatibility shims.

- Do not preserve old `Documents\Pe.App` or `Documents\Pe.Scripting` paths in this package.
- Do not add dual-read/dual-write behavior here.
- If a one-time migration is needed later, put it in an explicit migration/operator flow, not in the core layout authority.

## Consumer Guidance

Consumers should request intentful paths from this package and do their own IO:

- This package may return paths that do not exist yet.
- This package should not create directories as a side effect of path resolution.
- Callers that write files are responsible for creating directories at the boundary where they write.

## Transport Boundary

Transport contracts remain outside this package:

- Host HTTP routes and operation keys belong with host contracts.
- Bridge frame contracts belong with host bridge contracts.
- Host startup, probing, ASP.NET, and browser-launch behavior belong with app/host runtime code.

Product/process identity remains here even when transport code consumes it. If a value names a file, folder, executable, add-in manifest, local product root, product-owned environment variable, or canonical local process URL, it probably belongs here. If a value names a route, event, request method, protocol version, payload, or execution behavior, it probably does not.

## Build Projection

When MSBuild, installer authoring, or repo tooling needs this package's local layout identity, prefer a generated or serialized projection rooted in this package instead of retyping the same vendor/product/bin path strings in props or installer code.

- `ProductBuildLayoutProjection` is allowed here because it is still pure identity/layout data.
- Installer manifests belong to the SDK installer payload contract; keep only durable product identity/layout data here.
- Repo artifact topology such as `.artifacts`, package roots, publish roots, and staging roots does not belong here; use `build/ProductLayoutAuthority.cs` and `build/BuildArtifactLayout.cs`.
- Build and installer projections should consume `ProductBuildLayoutProjection` or serialized manifests directly, not generated MSBuild props.
