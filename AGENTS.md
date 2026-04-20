---
alwaysApply: true
---

# Pe.Tools

## Scope

Repo-wide agent guidance for conventions, current paths, validation habits, Revit workflow constraints, and cross-package terminology that repeatedly matters across the codebase. 

## Purpose and Philosophy

This repo exists to improve Engineering Designer workflows for MEP firms through strongly typed, debuggable Revit tooling. Optimize for linear execution flow, fail-fast behavior, composable systems, and most of all wrappers around finicky Revit API behavior. *This repo is greenfeild*; features and refactors should always take a "move fast and break things" approach, back compat is never a consideration unless as a temporarily compile shim. Our ultimate goal is to find the best long-term shapes and architectures that optimize for *both* DX and UX. New features and paradigms are always encouraged, but their complexity should be weighed against they're potential utility.

## Critical Entry Points

- `source/Pe.App/Application.cs` — Revit add-in startup, host bridge bootstrap, ribbon/task initialization.
- `source/Pe.App/ButtonRegistry.cs` — top-level command/ribbon exposure.
- `source/Pe.Host/Program.cs` — external settings host, HTTP/SSE entrypoint.
- `source/Pe.Shared.StorageRuntime/` — schema generation, field options, module registration, storage/document validation.
- `source/Pe.Shared.StorageRuntime/`, `source/Pe.Revit.Global/Revit/Lib/Schedules/`, and `source/Pe.Revit.FamilyFoundry/Profiles/` / `SchemaDefinitions/` — settings manifests, schema-definition registration, and module composition owned close to their runtime features.
- `source/Pe.Revit.Extensions` — strong primitives such as FamilyDocument, SetValue w/ coercion context, TrySetFormula/Fast, w/ formula validation, FindParameter & GeValue, etc.
- `source/Pe.Revit.FamilyFoundry/OperationProcessor.cs` — main FF execution orchestrator.
- `source/Pe.Revit.Tests/AGENTS.md` — runner-specific Revit test workflow.
- `docs/features/family-foundry/_DEV.md` and `docs/features/family-foundry/_GOALS.md` — cross-package FF transparency model, debugging read order, and long-term output contract.

## Builds and Env

Protect the current RRD session aggressively, breaking it can easily turn a small edit into a multi-minute restart plus document reopen wait. This is often the biggest source of friction in Revit development.

The biggest rule: *don't build `Pe.App` unless asked* (nor the root `Pe.Tools.slnx`), doing so during RRD *will always break HR* and require a restart to continue iterating. Building `Pe.Host` is always safe. When given permission, prefer low-noise commands like: `dotnet build -c "Debug.R25" /p:WarningLevel=0`. Building `Pe.Revit.Tests` is encouraged, but generally avoid it if RRD is not running because it will start a new, non-HR-able Revit session. Due to this possibility and the fact that building tests do not redeply `Pe.App` dlls, treat `.Tests` config builds as test-runner prep, not proof that the deployed Revit add-in is fresh. If asked for Revit-backed validation, prefer the relevant solution `.Tests` configuration and focused runs before broad suite runs. Here are some rapid fire reminders:

- If behavior diverges from source during live Revit work, confirm with a targeted log or artifact before assuming the logic is wrong.
- Hot reload concerns must not narrow the intended fix. Apply the correct fix first, then state whether Rider/Revit likely needs restart.
- Treat hot reload as RR-debug-only capability, not a general live Revit capability.
- Always assume stale assemblies are possible during live Revit work.
- A `.Tests` build does not redeploy `%APPDATA%\Autodesk\Revit\Addins\{RevitVersion}\Pe.App` while Revit is running.
- If deployed dlls are stale a RRD restart is required
- Hot reload is not trustworthy after many runtime shape or metadata changes, including added/removed members, signature changes, constructor changes, enum/record shape changes, new nested runtime types, and some attribute changes. This is a common cause of staleness
- If the user explicitly says they restarted Revit from Rider using the normal runtime config, treat the deployed add-in as fresh unless behavior proves otherwise.


TODO: add explanation of the new automation cli


## Testing, Validation, and Exploration

Tests are discouraged... but Revit is a fickle beast with little transparency nor predictability. The resources available to you are `Pe.Revit.Scripting` scripts, existing `Pe.Host` HTTP endpoints, and `Pe.Revit.Tests` tests. Prefer them in that order, resorting to tests last. The Revit API docs/content library are invaluable for research as well. 

The easiest sandbox for ad hoc probing, scripting, POC'ing is `Pe.Revit.Scripting` *inline snippets*, or creating files in user `<User>\Documents\Pe.Scripting` for files you want to persist. Use for quick experiments, reflection probes, behavior verification, and performance comparisons when possible instead of polluting repo runtime code.


## Shared Language

### Runtime / iteration language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **RRD** | The live Rider-driven Revit debug session for Pe.App. Treat it as expensive state: restarting it can cost several minutes before Revit is usable again, and reopening the working document may add several more. | Prefer this over vague phrases like `live debug`; avoid implying hot reload exists outside RRD |
| **HR** | Rider hot reload into the already-running RRD session. It is *indispensibly* useful... but not fully trustworthy: some changes will not apply cleanly, and stale in-process assemblies are a common source of confusion. | Avoid treating HR as proof that Revit is running fresh code |

### Repo-wide language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **FF** | Family Foundry | Prefer `Family Foundry` on first mention in prose; use `FF` after context is clear |
| **SP** | Shared Parameter | Avoid using `shared parameter` without clarifying project vs family scope when the distinction matters |
| **FP** | Family Parameter | Avoid saying just `parameter` in family/project merge discussions |
| **PP** | Project Parameter | Avoid conflating with shared parameters bound into projects |
| **PSP** | Project Shared Parameter | Use when both shared GUID identity and project binding matter |
| **package** | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry` | Prefer this over `project` when discussing one code area; avoid `assembly` unless the built artifact/runtime identity is what matters |
| **app** | `Pe.App`, the in-proc Revit add-in runtime rooted in the `Pe.App` package | Prefer this for the Revit-side runtime add-in; avoid using `app` to mean the whole repo or product |
| **host** | `Pe.Host`, the out-of-proc HTTP/SSE settings backend | Avoid using `host` for the Revit add-in bridge |
| **bridge** | The Revit-side named-pipe connection to `Pe.Host` | Avoid calling HTTP endpoints the bridge |
| **document-owned** | Behavior that can be derived from a specific `Document` without needing active/open UI session state | Prefer `Document` extensions for this; avoid burying it in session/global manager types |
| **document session** | Open/active/UI-tab state for documents in the current Revit process | Prefer session services or `UIApplication` helpers for this; avoid presenting it as pure `Document` behavior |
| **document key** | The canonical identity string used to describe or match an open Revit document | Prefer one shared implementation near `Pe.Revit.Global`; avoid ad hoc cache keys per caller when the concept is the same |

### Portable Revit state language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **collect** | Read live Revit state into a transient catalog, list, context, or other discovery/query result | Prefer this for live-document queries; avoid using it for durable portable state |
| **capture** | Convert live Revit state into a durable snapshot or spec, with provenance when it matters | Prefer this when the output is meant to survive document/session/version boundaries |
| **create** | Materialize new Revit objects, elements, or documents when no compatible target exists yet | Use carefully; in current code this is mostly a lower-level implementation concern inside broader apply flows |
| **spec** | A composable building block of authored intent or normalized portable structure | Prefer this for reusable building blocks that can appear inside profiles and snapshots |
| **structural validation** | Parse/schema/composition validation that does not require a live Revit document | Avoid implying it covers FF semantic or operation-time rules |
| **live-document** | Behavior that requires the active Revit document/thread | Prefer this over older capability wording like `RevitAssemblyOnly` |
| **snapshot** | Durable captured point-in-time state composed of reusable specs plus source/provenance metadata where needed | Avoid using it as the umbrella term for every derived output |
| **projection** | A target-shaped derived output such as a matrix, dataset, csv, profile fragment, or profile-shaped view | Prefer this for derived output shapes; avoid using it for captured source state |
| **apply** | Write compatible authored or captured state back into live Revit | Prefer this over `replay` when the behavior is patch/merge oriented rather than sequential |
| **profile** | The top-level authored settings document that drives a command or workflow | Avoid using it as a synonym for snapshot output or reusable building blocks |

## Living Memory
- Minimize API surface area. Favor type-safety, nullability correctness, generics, `nameof`, pattern matching, and small explicit contracts.
- Prefer `Result<T>` / `Try...` patterns on public or user-facing flows instead of exceptions when failure is expected.
- Use Serilog `Log.*` instead of `Console.WriteLine` or `Debug.WriteLine` in runtime code.
- Prefer LINQ/fluent APIs and extracted helpers over deep nesting. Keep execution flow easy to debug.
- Delete dead code and rename-era leftovers instead of preserving compatibility shims.
- Keep docs local and current. Remove stale goals, stale paths, and rename-era references rather than preserving history.
- For docs reshaping or consolidation work, use the `document-project-docs` skill in `C:\Users\kaitp\.agents\skills\document-project-docs`; repo docs use `AGENTS.md`, `_DEV.md`, and `_GOALS.md` naming.
- Prefer semantic role names over vague suffixes: `Collector` for live gathering, `Snapshot` for captured portable state, `Projection` for derived target shapes, and `Spec` for reusable authored/portable building blocks.
- Use verb-to-noun pairing consistently: `Collect...` returns collections/catalogs, `Capture...` returns snapshots, `ProjectTo...` returns projections, and `Apply...` mutates live Revit from specs/snapshots/projections.
- Ground the language in real public seams before standardizing it repo-wide. Current anchors:
  - `Capture...` -> `Document.CaptureFamilySnapshot()` / `FamilyDocument.CaptureFamilySnapshot()`
  - `Collect...` -> query-style collectors such as `ScheduleCatalogCollector`, `ScheduleQueryCollector`, `ProjectLoadedFamilyCollector`, `ProjectParameterCatalogCollector`, and FF source collectors behind `IFamilySnapshotCollector` / `IProjectSnapshotCollector`
  - `ProjectTo...` -> `Pe.Revit.FamilyFoundry.Profiles.FamilySnapshotProfileProjector`, `FamilyParamProfileAdapter.ProjectSnapshotsToProfile(...)`
  - `Apply...` -> document-owned `ApplyFamilyProfile(...)` / `ApplyFamilyMigrationProfile(...)` extensions plus operation queues such as `SetKnownParams`, `SetLookupTables`, and related mutation operations
- Treat `snapshot` as the noun pair for `capture`: current concrete snapshot types are `FamilySnapshot`, `ParameterSnapshot`, `RefPlaneSnapshot`, and `ParamDrivenSolidsSnapshot`.
- Treat `profile` as the noun for top-level authored settings documents: current concrete examples are `FFManagerProfile`, `FFMigratorProfile`, and `ScheduleProfile`.
- Put document-owned identity/path/binding helpers on `Document` extensions as close to `Pe.Revit.Global` as possible. Keep open/active/navigation behavior in session-aware services or `UIApplication` extensions.
- Prefer `Document` / `FamilyDocument` as the public entrypoints for document-owned collect/capture/apply flows, even when the returned models still live in a feature package.
- Keep feature-owned captured shapes and apply policy in the owning package until the concept proves broader than one feature; only then lift the models and helpers closer to `Pe.Revit.Global`.
- Current naming debt to reduce over time:
  - `SnapshotCollector` is the preferred FF capture noun for fragment-level live document reads
  - `Snapshots/` currently mixes captured models and legacy/resolved `Spec` types
  - `Capture/` vs `Snapshots/` is the preferred split, but callers and docs should keep reinforcing that boundary consistently
- Do not force `create` / `apply` into fake purity when one workflow mixes both. Reserve `create` for cases where the primary semantic value is materializing a new target; otherwise prefer `apply` for the caller-facing workflow and let lower-level helpers create as needed.
- Do not let multiple packages invent competing document-key or document-path logic. Collapse those behind one document-owned seam before adding more callers.
- Do not strip native Revit types out of specs or snapshots just for portability. Keep them when they materially help correctness, but require human-readable converters and schema metadata/options/examples at authoring and persistence boundaries.


## Outstanding Guidance to add:

- the WPF BAML resolution errors that occasionally happen. ***major*** blocker, but cause still unknown/unsolved
- build/release/publish workflow. First need to resolve installer.csproj build though
