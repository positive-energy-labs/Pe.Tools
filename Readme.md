# Pe.Tools

A suite of Revit add-ins and supporting libraries.

## Add-ins

- Views Palette, browse all the views in a document, open them, and preview information about them.
- Command Palette, browse all the commands in the document and run them.
- Family Palette, browse all the families in the document and pick one to place or open.
- Family Elements Palette, browse all the elements in a family and pick one to edit.
- FF Manager, a command for managing individual families.
- FF Migrator, a command for bulk processing families.
- FF Param Aggregator, a command for aggregating parameter data across an entire project.

## Revit Scripting

This repo includes a Revit scripting lane aimed at daily API probes and small automation loops without growing the main add-in assembly.

Current supported path:

- bootstrap a persistent workspace under `Documents\Pe.Scripting\workspace`
- author single-file container scripts under `src/`
- run them from the CLI with `pe-script src\MyProbe.cs`
- or call `Pe.Host` over HTTP:
  - `POST /api/scripting/workspace/bootstrap`
  - `POST /api/scripting/execute`
- receive final buffered output and structured diagnostics in one response

Transport posture:

- `Pe.Host` is the public scripting surface for frontend and CLI callers
- `Pe.Scripting.Cli` posts to host HTTP
- `Pe.Host` forwards scripting requests to the internal `Pe.Scripting.Revit` named pipe
- the Revit runtime executes through `ExternalEvent`
- scripting v1 requires exactly one connected Revit bridge session

Current non-goals:

- no SSE or async execution sessions
- no cancellation
- no multi-session scripting
- no multi-file execution
- no source-package execution
- no arbitrary local file execution outside the workspace
