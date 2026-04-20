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

The biggest rule: *don't build `Pe.App` directly unless asked* (nor the root `Pe.Tools.slnx`) during RRD. For compile verification, use `./build`, not direct `Pe.App` builds. Building `Pe.Host` is always safe. Building `Pe.Revit.Tests` is encouraged, but generally avoid it if RRD is not running because it may start a new non-HR-able Revit session. Treat `.Tests` builds as test-runner prep, not proof that the deployed Revit add-in is fresh. If asked for Revit-backed validation, prefer the relevant `.Tests` configuration plus focused `dotnet test --filter ...` runs before broad suite runs. Here are the reminders that matter most:

- If behavior diverges from source during live Revit work, confirm with a targeted log or artifact before assuming the logic is wrong.
- Hot reload concerns must not narrow the intended fix. Apply the correct fix first, then state whether Rider/Revit likely needs restart.
- Treat hot reload as RR-debug-only capability, not a general live Revit capability.
- Always assume stale assemblies are possible during live Revit work.
- `.Tests` outputs are isolated and RRD-safe. They do not compile `Pe.App` against the live deployed `Debug.R*` add-in outputs Rider is using.
- A `.Tests` build does not redeploy `%APPDATA%\Autodesk\Revit\Addins\{RevitVersion}\Pe.App` while Revit is running.
- Pre-test hot reload is best-effort runtime alignment, not proof that the live runtime is fresh.
- If deployed dlls are stale, a full Rider `Pe.App` restart is required.
- Hot reload is not trustworthy after many runtime shape or metadata changes, including added/removed members, signature changes, constructor changes, enum/record shape changes, new nested runtime types, and some attribute changes. This is a common cause of staleness.
- If the user explicitly says they restarted Revit from Rider using the normal runtime config, treat the deployed add-in as fresh unless behavior proves otherwise.

### Build System

`Pe.Tools.slnx`, `Directory.build.props`, `./install/Installer.cs`, and `./build/Program.cs` are the main touchpoints for the build system. `slnx` and `build.props` orchestrate configuration, most notably TFM/Revit-year. Revit 2025 config is enforced as the default to allow maximum compatibility with IDEs and no-config-specified dotnet commands. `./build` is the compile-verification entrypoint used in `.github/workflows/Compile.yml`. `./install` remains the release/publish entrypoint.

The key commands are:

- Safe-compile: `dotnet run -c Debug -- --configuration Debug.R25` or `dotnet run -c Release` from `./build`
- Pack/release automation still lives under `./build` and `./install`; do not reintroduce direct `Pe.App` compile verification as the primary path
```
./build
    # safe-compile; non-disruptive to RRD/HR
    dotnet run -c Debug -- --configuration Debug.R25
    dotnet run -c Release
    # publish/pack
    dotnet run -c Release -- pack
    dotnet run -c Release -- pack publish # for CI only, published Github release
    
./source
    # start host
    cd Pe.Host; dotnet run
    # NOT RRD/HR-safe
    cd Pe.App; dotnet build -c "Debug.R25"
    cd Pe.App; dotnet build # build.props supplies Debug.R25 if no confix specified
    
./source/Pe.Revit.Tests
    dotnet test -c Debug.R25.Tests --filter "Name~FFManager_round_duct_connector_roundtrips_and_stub_resizes_across_types" --no-build

    
  
```

The dev-automation CLI is `pe-dev`:

- `pe-dev revit session`
- `pe-dev revit logs all --tail 50`
- `pe-dev revit hot-reload`
- `pe-dev revit approve --revit-year 2025`
- `pe-dev revit script --stdin --name Probe.cs`


## Testing, Validation, and Exploration

Tests are still the last resort, but the guidance is now much simpler:

1. For compile verification, use `./build`.
2. For live probing, use `pe-dev revit script ...`, especially `--stdin` inline snippets.
3. For Revit-backed verification, use focused `dotnet test` in a `.Tests` configuration.

The easiest sandbox for ad hoc probing, scripting, and behavior verification is `pe-dev revit script --stdin --name Probe.cs`, or creating files in `<User>\Documents\Pe.Scripting` when you want to persist the probe. Before assuming source/runtime divergence, check:

- `pe-dev revit session`
- `pe-dev revit logs all --tail 50`

The default focused Revit test loop is:

```powershell
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c "Debug.R25.Tests" /p:WarningLevel=0
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "FullyQualifiedName~Can_create_generic_model_family_document_from_rft"
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~FFManager_round_duct_connector_roundtrips" --no-build
```

`dotnet test` now triggers the pre-`VSTest` approval + hot-reload hook automatically. That hook is best-effort. If it warns that restart is likely or hot reload failed, treat the live runtime as suspect even though the `.Tests` assembly is fresh.

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
