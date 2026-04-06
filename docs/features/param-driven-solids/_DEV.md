# Param-Driven Solids

## Mental Model

`ParamDrivenSolids` is the semantic geometry-authoring layer for Family Foundry. Authors describe intended solids and driving constraints; compiler and runtime layers translate that intent into the lower-level Revit constructs needed to execute it.

## Architecture

- authored profiles carry the compact `ParamDrivenSolids` shape
- compiler/resolution code expands that shape into an executable plan
- runtime operations create or modify the underlying Revit geometry constructs
- snapshots and reverse inference try to emit authored-friendly output back in the same conceptual shape

## Key Relationships

- package-local runtime ownership sits mainly in `Pe.Revit.FamilyFoundry`
- feature intent lives here because the capability spans authoring, compilation, reverse inference, snapshots, tests, and replay
- the compiled execution plan is an internal runtime artifact, not a second public authoring model

## Reader Shortcut

If you are trying to understand this feature quickly:
1. read `GOALS.md`
2. inspect the Family Foundry compiler/resolution path
3. inspect the snapshot/reverse-inference path
4. only then drop into the lower-level operation plumbing
