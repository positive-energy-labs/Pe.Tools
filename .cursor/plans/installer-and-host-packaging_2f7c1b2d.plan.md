---
name: installer-and-host-packaging
overview: Package the out-of-proc settings-editor host as a first-class release artifact without collapsing it back into the Revit add-in process. Update the existing build/MSI/bundle pipeline so Revit-loaded files and host files have separate staging, install roots, and update rules.
todos:
  - id: stage-host-publish
    content: Add an explicit build/publish staging step for Pe.SettingsEditor.Host in the release pipeline.
    status: pending
  - id: split-installer-inputs
    content: Refactor installer generation so Revit add-in payloads and host payloads are modeled as separate inputs.
    status: pending
  - id: separate-install-roots
    content: Update MSI layout to install Revit files to Autodesk addins folders and host files to an app-owned host directory.
    status: pending
  - id: define-bundle-policy
    content: Choose and document whether the Autodesk bundle remains Revit-only or carries host companion files.
    status: pending
  - id: runtime-host-path
    content: Add a runtime/config strategy for resolving the installed host location without reintroducing in-proc coupling.
    status: pending
  - id: compatibility-guardrails
    content: Add host/add-in compatibility checks based on the shared contracts’ transport version seams.
    status: pending
  - id: document-update-model
    content: "Document the rough update strategy: MSI-first near term, split activation rules for host vs Revit-loaded payloads."
    status: pending
isProject: false
---

# Installer And Host Packaging Plan

## Decision Context

### Why the architecture stays split

- `Pe.SettingsEditor.Contracts` is intentionally shared, but
  `Pe.SettingsEditor.Host` must remain a separate executable/app so the web
  server and bridge host stay out of the Revit process.
- The out-of-proc boundary is preserved by process topology and install layout,
  not just by code organization.
- Revit-loaded payloads and host payloads have different runtime/update
  constraints, so packaging should model them separately.

### Why installer work is still required

- The current build graph compiles the host because it is now in
  `[Pe.Tools.slnx](c:\Users\kaitp\source\repos\Pe.Tools\Pe.Tools.slnx)`, but the
  packaging graph still only harvests
  `[Pe.App](c:\Users\kaitp\source\repos\Pe.Tools\source\Pe.App\Pe.App.csproj)`
  publish folders.
- Current evidence:

```34:40:build/Modules/CreateInstallerModule.cs
var wixTarget = new File(Projects.Pe_App.FullName);
var wixInstaller = new File(Projects.Installer.FullName);
var wixToolFolder = await InstallWixAsync(context, cancellationToken);
```

```54:64:build/Modules/CreateInstallerModule.cs
var targetDirectories = wixTarget.Folder!
    .GetFolder("bin")
    .GetFolders(folder => folder.Name == "publish")
    .Select(folder => folder.Path)
    .ToArray();
```

- The MSI currently installs only to Revit addins roots:

```28:33:install/Installer.cs
void BuildSingleUserMsi() {
    project.Scope = InstallScope.perUser;
    project.OutFileName = $"{outputName}-{project.Version}-SingleUser";
    project.Dirs = [
        new InstallDir(@"%AppDataFolder%\Autodesk\Revit\Addins\", wixEntities)
    ];
```

## Recommended Direction

- Keep one release pipeline, but split it into two payload lanes:
- `Revit add-in payload`: versioned Revit files from
  `[source/Pe.App/](c:\Users\kaitp\source\repos\Pe.Tools\source\Pe.App)`
- `Host payload`: published runtime files from
  `[source/Pe.SettingsEditor.Host/](c:\Users\kaitp\source\repos\Pe.Tools\source\Pe.SettingsEditor.Host)`
- Keep shared contracts in
  `[source/Pe.SettingsEditor.Contracts/](c:\Users\kaitp\source\repos\Pe.Tools\source\Pe.SettingsEditor.Contracts)`
  as compile-time/shared DTO infrastructure only.

## Implementation Outline

### 1. Add explicit host staging to the build pipeline

- Extend
  `[build/Modules/CompileProjectModule.cs](c:\Users\kaitp\source\repos\Pe.Tools\build\Modules\CompileProjectModule.cs)`
  or add a follow-on packaging module that explicitly publishes
  `[source/Pe.SettingsEditor.Host/Pe.SettingsEditor.Host.csproj](c:\Users\kaitp\source\repos\Pe.Tools\source\Pe.SettingsEditor.Host\Pe.SettingsEditor.Host.csproj)`.
- Stage host output into a stable intermediate folder under `output/` or another
  pipeline-owned staging root.
- Do not rely on `Pe.App` publish transitively producing host runtime files; it
  does not today.

### 2. Split installer inputs into add-in vs host payloads

- Refactor
  `[build/Modules/CreateInstallerModule.cs](c:\Users\kaitp\source\repos\Pe.Tools\build\Modules\CreateInstallerModule.cs)`
  so it passes both:
- Revit publish directories from `Pe.App/bin/**/publish`
- host publish directory from the new host staging step
- Update
  `[install/Installer.Generator.cs](c:\Users\kaitp\source\repos\Pe.Tools\install\Installer.Generator.cs)`
  so it can generate WiX entities for two payload classes instead of assuming
  every input directory is a Revit-year folder.

### 3. Install the host outside Autodesk addins folders

- Keep Revit payload installation in the current `%AppDataFolder%` /
  `%CommonAppDataFolder%` Autodesk addins roots.
- Install host payload to an app-owned location such as
  `%LocalAppData%\Pe.Tools\SettingsEditorHost` for per-user and a machine-owned
  equivalent for per-machine.
- Update
  `[install/Installer.cs](c:\Users\kaitp\source\repos\Pe.Tools\install\Installer.cs)`
  to define both install roots in the MSI.
- This is the main operational guarantee that the host remains out-of-proc and
  independently replaceable.

### 4. Decide bundle behavior explicitly

- Current bundle creation in
  `[build/Modules/CreateBundleModule.cs](c:\Users\kaitp\source\repos\Pe.Tools\build\Modules\CreateBundleModule.cs)`
  also only packages `Pe.App` publish content.
- Choose one of these policies:
- Near-term default: MSI ships both add-in and host; Autodesk bundle remains
  Revit-only.
- Longer-term option: bundle also carries host companion files, but the host is
  not registered as a Revit component in `PackageContents.xml`.
- Favor the near-term default unless there is a clear Autodesk-store requirement
  for bundling the host.

### 5. Add runtime path/config support for installed host location

- Today the browser launcher in
  `[source/Pe.Revit.Global/Services/SettingsEditor/SettingsEditorLauncher.cs](c:\Users\kaitp\source\repos\Pe.Tools\source\Pe.Revit.Global\Services\SettingsEditor\SettingsEditorLauncher.cs)`
  only opens the frontend URL.
- Add a clear config/path story for where the installed host lives and how users
  or future automation start it.
- Keep manual host start as the first supported release behavior unless
  automatic host lifecycle is intentionally revisited.

### 6. Add compatibility/version checks before deeper update work

- Use the existing seams in
  `[source/Pe.SettingsEditor.Contracts/SettingsEditorContracts.cs](c:\Users\kaitp\source\repos\Pe.Tools\source\Pe.SettingsEditor.Contracts\SettingsEditorContracts.cs)`
  to fail fast on host/add-in incompatibility.
- Specifically validate `SettingsEditorProtocol.ContractVersion` and
  `SettingsEditorBridgeProtocol.ContractVersion` at startup/handshake.
- This reduces risk if host and add-in ship on slightly different cadences
  later.

## Rough Update Strategy

- Near-term, least-friction release/update path:
- keep the existing MSI as the main install artifact for the Revit add-in
- include host files in that installer, but install them to a separate host root
- host can be stopped/replaced/restarted independently
- Revit-loaded files still only truly activate safely on next Revit launch
- Medium-term, cleaner update model:
- one GitHub release
- two payload classes: `Revit add-in` and `SettingsEditor host`
- host can update immediately after stop/restart
- Revit payload updates stage now and activate on next safe Revit start
- The current repo already supports the “existing MSI remains the primary
  distribution primitive” direction via:
- `[build/Program.cs](c:\Users\kaitp\source\repos\Pe.Tools\build\Program.cs)`
- `[build/Modules/CreateInstallerModule.cs](c:\Users\kaitp\source\repos\Pe.Tools\build\Modules\CreateInstallerModule.cs)`
- `[install/Installer.cs](c:\Users\kaitp\source\repos\Pe.Tools\install\Installer.cs)`

## External Reference Notes

- RevitTemplates bundle docs are useful context for how the Autodesk bundle is
  shaped, but they do not solve the host packaging problem automatically because
  that template still assumes Revit-distributed payloads are the main artifact:
- `[RevitTemplates/docs/Autodesk-Store-bundle.md](c:\Users\kaitp\source\repos\RevitTemplates\docs\Autodesk-Store-bundle.md)`
- If needed later, also review RevitTemplates guidance on extra published
  files/content inclusion for a lower-effort transitional approach.

## Risks To Watch

- Accidentally installing host files under Revit addins roots, which muddies
  process boundaries and update behavior.
- Treating a host build as equivalent to a host publish; the host likely needs
  full runtime payload staging, not just a single exe/dll.
- Over-coupling bundle support before deciding whether the host truly needs to
  ship in Autodesk bundle artifacts.
