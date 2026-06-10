# Pea/Peco LSP MVP context

## Current posture

This is deferred exploration, not an approved product commitment. Motivation shifted after `dotnet format --verify-no-changes --severity info` proved to cover most Peco style/Problems-panel needs without Rider UI scraping. Do not promote LSP as the first-class diagnostics path until repo cleanup reduces current analyzer/style output volume.

## Constraints

- Pea is the deployed Revit/operator workbench; Peco is repo coding tooling. Their LSP needs overlap, but Pea has stricter install/product constraints.
- Pea users are Windows/Revit users, not assumed C# developers.
- Reasonable Pea assumptions: Windows, Revit, Pe-installed binaries/assemblies, Pea-owned scripting workspace.
- Unsafe Pea assumptions: full .NET SDK, `dotnet` on PATH, Rider/VS/VS Code, Roslyn LSP, `csharp-ls`, user-edited config files.
- Installer/package implications are the current blocker; Pe packages also are not yet shaped as external-library-friendly references.
- LSP value for Pea is C# script authoring/API discovery, not repo refactoring.

## Decisions so far

- Do not build a Rider Problems-panel route unless Roslyn/dotnet-format paths miss valuable Rider-only inspections.
- For Peco diagnostics/style, prefer `dotnet format ... --verify-no-changes --severity info` before LSP/Rider integration.
- For Pea LSP, keep the exposed tool surface tiny and Pea-shaped:
  - `script_lsp_status`
  - `script_lsp_inspect`
  - `script_lsp_diagnostics`
  - `script_lsp_signature_help`
  - optional later: `script_lsp_find_symbol`
- Do not expose broad generic LSP/refactor tools in Pea MVP: rename, apply edit, blast radius, cross-repo refs, run_build/run_tests, code actions, completions.
- If LSP becomes a product feature, Pea should own startup/config/workspace/recovery; no manual user config.

## Candidate architecture

Preferred experiment order:

1. Try Mastra's built-in/custom `lsp_inspect` path with a Pea-controlled generated config, if it can launch an explicit C# server path and target the Pea scripting workspace.
2. If lifecycle/config/control is insufficient, use `agent-lsp` as an internal engine, not as a 66-tool Pea surface.
3. Only after local proof, decide whether to bundle a C# server (`csharp-ls` first candidate; Roslyn LSP if needed).

Potential Pea runtime shape:

```text
Pea wrapper tools
  -> Pea-owned LSP service/config
    -> Mastra LSP or bundled agent-lsp.exe
      -> bundled/managed C# language server
        -> Pea scripting workspace .csproj
          -> Pe.* refs + RevitAPI refs + adjacent XML docs
```

## MVP proof questions

Before installer work, prove locally against a Pea-like scripting workspace:

- Can the C# server start from an explicit path with no PATH dependency?
- Can it load the generated `.csproj`?
- Can it resolve Pe assemblies and Revit API assemblies?
- Do hovers show XML docs from adjacent `.xml` files?
- Does signature help work for common Pe/Revit calls?
- Do diagnostics return useful file-local compiler/style issues?
- Are failures diagnosable enough for `script_lsp_status` to guide recovery?

## Stop conditions

Pause productization if C# server packaging requires full SDK/Rider/VS, XML docs do not surface reliably, or Pe scripting references are not stable enough to behave like library references.
