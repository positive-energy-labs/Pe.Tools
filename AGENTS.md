---
alwaysApply: true
---

# Pe.Tools

## Scope

Repo-wide agent guidance for current paths, validation habits, Revit workflow constraints, and cross-package terminology that repeatedly matters across the codebase.

## Purpose

This repo exists to improve Engineering Designer workflows for MEP firms through strongly typed, debuggable Revit tooling. Optimize for linear execution flow, fail-fast behavior, composable systems, and wrappers around finicky Revit API behavior.

## Critical Entry Points

- `source/Pe.App/Application.cs` — Revit add-in startup, host bridge bootstrap, ribbon/task initialization.
- `source/Pe.App/ButtonRegistry.cs` — top-level command/ribbon exposure.
- `source/Pe.Host/Program.cs` — external settings host, HTTP/SSE entrypoint.
- `source/Pe.Shared.StorageRuntime/` — schema generation, field options, module registration, storage/document validation.
- `source/Pe.Shared.SettingsCatalog/` — settings manifests and schema-definition registration.
- `source/Pe.Revit.Extensions` — strong primitives such as FamilyDocument, SetValue w/ coercion context, TrySetFormula/Fast, w/ formula validation, FindParameter & GeValue, etc.
- `source/Pe.Revit.FamilyFoundry/OperationProcessor.cs` — main FF execution orchestrator.
- `source/Pe.Revit.Tests/AGENTS.md` — runner-specific Revit test lane workflow.
- `.cursor/rules/family-foundry-dev.mdc` and `.cursor/rules/family-foundry-architecture.mdc` — dense local FF debugging/architecture guidance.

## Validation

- Do not build unless the user asked. Building during RR debug always breaks hot reload.
- If the user asked for Revit-backed validation, prefer the relevant `.Tests` lane and focused runs before broad suite runs.
- If given permission to build, prefer low-noise commands like:
  - `dotnet build -c "Debug.R25" /p:WarningLevel=0`
- Treat `.Tests` builds as test-lane prep, not proof that the deployed Revit add-in lane is fresh.
- If behavior diverges from source during live Revit work, confirm with a targeted log or artifact before assuming the logic is wrong.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **FF** | Family Foundry | Prefer `Family Foundry` on first mention in prose; use `FF` after context is clear |
| **SP** | Shared Parameter | Avoid using `shared parameter` without clarifying project vs family scope when the distinction matters |
| **FP** | Family Parameter | Avoid saying just `parameter` in family/project merge discussions |
| **PP** | Project Parameter | Avoid conflating with shared parameters bound into projects |
| **PSP** | Project Shared Parameter | Use when both shared GUID identity and project binding matter |
| **package** | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry` | Prefer this over `project` when discussing one code area; avoid `assembly` unless the built artifact/runtime identity is what matters |
| **app** | `Pe.App`, the in-proc Revit add-in runtime rooted in the `Pe.App` package | Prefer this for the Revit-side runtime lane; avoid using `app` to mean the whole repo or product |
| **host** | `Pe.Host`, the out-of-proc HTTP/SSE settings backend | Avoid using `host` for the Revit add-in bridge |
| **bridge** | The Revit-side named-pipe connection to `Pe.Host` | Avoid calling HTTP endpoints the bridge |
| **RR debug** | A live Rider/Revit debug session against the deployed runtime lane, and the only normal lane where hot reload is available | Prefer this over vague phrases like `live debug`; avoid implying hot reload exists outside RR debug |
| **collect** | Gather live Revit data for discovery, catalogs, or broad inspection | Prefer this for collectors and broad read flows; avoid using it for preserved portable state |
| **capture** | Convert live Revit state into a durable captured form | Prefer this when the output is intended to survive document/session/version boundaries |
| **spec** | A composable building block of authored intent or normalized portable structure | Prefer this for reusable building blocks that can appear inside profiles and snapshots |
| **structural validation** | Parse/schema/composition validation that does not require a live Revit document | Avoid implying it covers FF semantic or operation-time rules |
| **live-document** | Behavior that requires the active Revit document/thread | Prefer this over older capability wording like `RevitAssemblyOnly` |
| **snapshot** | Captured point-in-time state composed of reusable specs plus source/provenance metadata where needed | Avoid using it as the umbrella term for every derived output |
| **projection** | A target-shaped derived output such as a matrix, dataset, csv, profile fragment, or profile-shaped view | Prefer this for derived output shapes; avoid using it for captured source state |
| **apply** | Write compatible specs, snapshots, or projections back into live Revit | Prefer this over `replay` when the behavior is patch/merge oriented rather than sequential |
| **profile** | Authored settings input that drives Family Foundry or related commands | Avoid using it as a synonym for snapshot output |

## Living Memory
- Repo is greenfeild. Always tend towards making changes that serve long-term, "ideal" shapes. Back compat is *rarely* a concern unless explicitly stated. Research existing patterns before changing code and follow repo conventions, but refactor when the current shape is clearly worse.
- Minimize API surface area. Favor type-safety, nullability correctness, generics, `nameof`, pattern matching, and small explicit contracts.
- Prefer `Result<T>` / `Try...` patterns on public or user-facing flows instead of exceptions when failure is expected.
- Use Serilog `Log.*` instead of `Console.WriteLine` or `Debug.WriteLine` in runtime code.
- Prefer LINQ/fluent APIs and extracted helpers over deep nesting. Keep execution flow easy to debug.
- Delete dead code and rename-era leftovers instead of preserving compatibility shims.
- Keep docs local and current. Remove stale goals, stale paths, and rename-era references rather than preserving history.
- For docs reshaping or consolidation work, use the `document-project-docs` skill in `C:\Users\kaitp\.agents\skills\document-project-docs`; repo docs use `AGENTS.md`, `_DEV.md`, and `_GOALS.md` naming.
- Prefer semantic role names over vague suffixes: `Collector` for live gathering, `Snapshot` for captured portable state, `Projection` for derived target shapes, and `Spec` for reusable authored/portable building blocks.
- Use verb→noun pairing consistently: `Collect...` returns collections/catalogs, `Capture...` returns snapshots, `ProjectTo...` returns projections, and `Apply...` mutates live Revit from specs/snapshots/projections.
- Do not strip native Revit types out of specs or snapshots just for portability. Keep them when they materially help correctness, but require human-readable converters and schema metadata/options/examples at authoring and persistence boundaries.

### Revit runtime / hot reload

- RR debug restart is expensive; avoid unnecessary builds, redeploy assumptions, or casual restart suggestions during an active session.
- Hot reload concerns must not narrow the intended fix. Apply the correct fix first, then state whether Rider/Revit likely needs restart.
- Treat hot reload as RR-debug-only capability, not a general live Revit capability.
- Always assume stale assemblies are possible during live Revit work.
- A `.Tests` build does not redeploy `%APPDATA%\Autodesk\Revit\Addins\{RevitVersion}\Pe.App` while Revit is running.
- If the deployed addin needs refreshing, that must happen before Revit launches or after the user restarts the Rider debug session.
- Hot reload is not trustworthy after runtime member-shape changes: added/removed members, signature changes, constructor changes, enum/record shape changes, new nested runtime types.
- If the user explicitly says they restarted Revit from Rider using the normal runtime config, treat the deployed lane as fresh unless behavior proves otherwise.

### Testing / exploration

- The easiest sandbox for ad hoc POCs is `C:\Users\kaitp\OneDrive\Documents\ArchSmarter\Launchpad VS Code\LaunchpadScripts`.
- Use that sandbox for quick experiments, reflection probes, behavior verification, and performance comparisons when possible instead of polluting repo runtime code.
- If Launchpad cannot reach the needed internals, a temporary task-palette path is acceptable, but treat it as a fallback.

### Family Foundry

- Use the FF debugging ladder before changing code:
  1. semantic/compiler validation
  2. authored profile/layout issue
  3. operation-time API/logic issue
  4. transaction-commit warning or failure-processing issue
  5. snapshot / reverse-inference / diagnostics issue
- Do not skip straight to suppression or heuristics until the failing rung is clear.
- Architect FF code for logging, snapshots, and testability. Favor simple APIs with few dependencies.
- When validating parameter-driven geometry or connector behavior, assert across multiple family types or parameter states.

## Outstanding Guidance to add:

- the wpf baml resolution errors that occasional happen. ***major*** blocker, but cause still unknown/unsolved
- build/release/publish workflow. First need to resolve installer.csproj build though
