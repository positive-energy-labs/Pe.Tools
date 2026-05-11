# Revit Scripting Bundle Sketch

Saved context for the future `Pe.Revit.Scripting` sharing model.

This is a format sketch, not an implementation plan. Defer implementation until workspace scripts are solid.

## North Star

- Keep the scripting system source-first.
- Let users share zipped script workspaces, not compiled plugins.
- Reuse the existing `Pe.Revit.Scripting` compile/resolve/execute pipeline instead of inventing a second runtime.
- Treat bundle import/export as distribution, not execution.

## Recommended Shape

A shareable bundle should be a zip containing a workspace-shaped folder:

```text
MyBundle.zip
  PeScripts.csproj
  README.md
  AGENTS.md
  src/
    Main.cs
    Helpers.cs
  scratch/
```

After import, the bundle is just a normal workspace under:

```text
Documents\Pe.Tools\scripting\workspace\<workspaceKey>\
```

Run it through the normal command shape:

```powershell
pea script --workspace connector-audit src\Main.cs
```

## Execution Contract

- Import/unpack the zip into a controlled workspace root.
- Compile through the normal workspace script pipeline.
- Compile the workspace source set from disk.
- Execute the selected `.cs` file's exactly-one concrete `PeScriptContainer`.
- Treat one broken file under `src/` as a workspace compile failure.
- Use named workspaces as the isolation mechanism.

## Dependency Modes

Prefer the existing workspace dependency mechanisms:

1. repo/runtime references supplied by `Pe.Revit.Scripting`
2. package references declared by `PeScripts.csproj`
3. explicit local references contained inside the unpacked workspace, if later allowed

Avoid by default:

- arbitrary probing of random machine-installed DLLs
- GAC-style assumptions
- project-to-project references outside the unpacked workspace root
- precompiled third-party plugin bundles as the primary format
- arbitrary install scripts or post-build hooks

## Why Source-First

Source-first bundles keep the model simpler:

- easier to inspect and review
- easier to version and diff
- fewer machine-specific binary issues
- less target-framework drift across Revit years
- better fit with the workspace/project/reference pipeline
- better fit for humans and coding agents

## Why Not Binary-First

Binary-first packages raise the hard problems immediately:

- Revit-year compatibility
- target framework compatibility
- dependency collisions inside one Revit process
- unload/reload limitations
- trust and signing concerns
- much worse debugging ergonomics

## Constraints To Preserve

- keep one public operator surface: `pea script`
- keep script/bundle execution bounded to controlled workspace roots
- keep references explicit by default
- keep multi-file support source-based
- keep the system reviewable by humans and legible to agents
- keep bundles as zipped workspace conventions, not a separate runtime model

## Good First Future Slice

If this gets implemented, the first slice should be intentionally small:

```powershell
pea script export --workspace connector-audit connector-audit.zip
pea script import connector-audit.zip --workspace connector-audit
pea script --workspace connector-audit src\Main.cs
```

That unlocks shareable multi-file authoring without committing to a full plugin ecosystem.
