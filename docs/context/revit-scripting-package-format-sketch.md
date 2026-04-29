# Revit Scripting Package Format Sketch

Saved context for the future `Pe.Revit.Scripting` sharing model.

This is a format sketch, not an implementation plan.

## North Star

- Keep the scripting system source-first.
- Let users share zipped script workspaces, not compiled plugins.
- Reuse the existing `Pe.Revit.Scripting` compile/resolve/execute pipeline instead of inventing a second runtime.

## Recommended Shape

A shareable package should be a zip containing a small workspace-like folder:

```text
MyPackage.zip
  package.json
  src/
    Entry.cs
    Helpers.cs
  lib/
    OptionalPrivateDependency.dll
  content/
    OptionalNonCodeFiles.json
```

## Manifest

Use one lightweight manifest such as `package.json`.

Suggested keys:

```json
{
  "id": "pe.sample.duct-tools",
  "name": "Duct Tools",
  "version": "0.1.0",
  "description": "Small Revit-side helpers for duct workflows.",
  "entry": "src/Entry.cs",
  "workspaceKey": "duct-tools",
  "references": [
    { "kind": "package", "name": "Some.Package", "version": "1.2.3" },
    { "kind": "lib", "path": "lib/OptionalPrivateDependency.dll" }
  ]
}
```

Keep the manifest intentionally narrow:

- one package id
- one version
- one entry file
- explicit references only
- no arbitrary install scripts
- no arbitrary post-build hooks

## Execution Contract

- Import/unpack the zip into a controlled workspace root.
- Materialize or generate the constrained project content from the manifest plus repo defaults.
- Compile from source through the existing `Pe.Revit.Scripting` pipeline.
- Require exactly one non-abstract `PeScriptContainer` entrypoint for execution.
- Treat the package as a source bundle, not as a binary plugin.

## Dependency Modes

Prefer only these dependency modes:

1. repo/runtime references already supplied by `Pe.Revit.Scripting`
2. NuGet package references with explicit versions
3. optional local `lib/*.dll` private dependencies bundled in the zip

Avoid these by default:

- arbitrary probing of random machine-installed DLLs
- GAC-style assumptions
- project-to-project references outside the unpacked package root
- precompiled third-party plugin bundles as the primary format

## Why Source-First

Source-first packages keep the model simpler:

- easier to inspect and review
- easier to version and diff
- fewer machine-specific binary issues
- less target-framework drift across Revit years
- better fit with the current workspace/project/reference pipeline

## Why Not Binary-First

Binary-first packages would raise the hard problems immediately:

- Revit-year compatibility
- target framework compatibility
- dependency collisions inside one Revit process
- unload/reload limitations
- trust and signing concerns
- much worse debugging ergonomics

## Best Reuse From Existing Systems

### From `Pe.Revit.Scripting`

Reuse this as the real foundation:

- workspace bootstrap
- constrained project generation
- explicit reference resolution
- compile/runtime reference distinction
- compile/load/execute orchestration

### From `ricaun.RevitTest`

Reuse only the structural lesson:

- a small Revit-resident helper plus an out-of-proc controller is a valid shape

Do not treat it as the runtime model for shareable script packages. Its process model is test-oriented, not a clean reusable package host.

### From `pyRevit`

Study it mainly for UX:

- package layout
- discovery model
- grouping/command ergonomics
- what metadata humans actually need

Do not copy its execution model blindly just because the bundle UX is good.

## Constraints To Preserve

- keep one public operator surface: `pe-dev` plus host HTTP
- keep script/package execution bounded to controlled workspace roots
- keep references explicit by default
- keep multi-file support source-based, not “drop random DLLs into Revit”
- keep the system reviewable by humans and legible to agents

## Good First Future Slice

If this ever gets implemented, the first slice should be intentionally small:

- support zip import/export of a workspace-shaped package
- allow multiple `.cs` files under `src/`
- allow one manifest
- allow explicit NuGet references
- allow optional bundled private DLLs under `lib/`
- still require exactly one `PeScriptContainer` entrypoint

That would unlock shareable multi-file authoring without committing to a full plugin ecosystem.
