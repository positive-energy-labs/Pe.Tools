# Pe.Revit.Tests

## Scope

Owns the VSTest-based Revit-backed test harness for this repo. The harness uses `ricaun.RevitTest` from NuGet.

## Purpose

`Pe.Revit.Tests` is a test harness, not a product. It exists to verify real Revit behavior through explicit verify targets instead of pretending `.Tests` builds prove anything about the live desktop runtime by themselves.

## Critical Entry Points

- `Pe.Revit.Tests.csproj` - explicit-year `.Tests` configurations, warning policy, and adapter metadata.
- `..\Pe.App\Pe.App.csproj` - desktop add-in graph under test.
- `..\Pe.Dev.Cli\AGENTS.md` - explicit `pe-dev test` helper behavior and repo-local operator policy.
- `Proofs/` - durable Revit/API behavior observations. These are not ordinary package regression tests.
- `LibraryBehavior/` - Revit-backed package behavior that needs a real document/session or currently depends on Revit-runtime target frameworks.
- `Diagnostics/` - operational environment probes and proof-lane diagnostics.
- `Performance/` - explicit scale/performance loops, not normal coverage.
- `Harness/` - reusable test fixtures, builders, probes, and assertions.
- `ReviewLater/` - quarantined tests that are suspect, low-value, or wrong-abstraction until reviewed.

## Validation

Two verify targets matter here:

- `AttachedRrd`
  - execution policy:
    `RrdRequired`
  - use when:
    iterating collaboratively against the already-running Rider-driven desktop session
  - required posture:
    prepare package-local/runtime outputs only when the attached runtime needs them, use dev-agent live-loop tooling for runtime freshness, then run focused explicit-year `dotnet test` as behavior evidence
- `FreshRevitProcess`
  - execution policy:
    `NoRrdContact`
  - use when:
    you need a dedicated fresh Revit process that must not reuse `RRD`
  - current helper:
    `pe-dev test ...`

Canonical attached-runtime loop:

1. Prepare any package-local/runtime outputs only when the attached runtime actually needs them. Do not treat that build as the freshness proof.
2. Use dev-agent live-loop tooling to establish session state, refresh/restart when needed, and decide whether attached proof is trustworthy.
3. Run focused explicit-year tests as behavior evidence:

```powershell
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~SomeFocusedTest" --no-build
```

Current dedicated fresh-process helper (routes tests to Revit years based on execution policy):

```powershell
pe-dev test --filter "Name~Reports_runtime_assembly_load_paths" --timeout-seconds 900
```

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **AttachedRrd** | Verification against the already-running Rider-driven desktop Revit debug session | Prefer this over vague `live test` phrasing |
| **FreshRevitProcess** | Verification in a newly launched dedicated Revit process that must not reuse `RRD` | Prefer this over vague `isolated test` phrasing |
| **test harness** | `Pe.Revit.Tests` owns verification orchestration, not a deployable product | Avoid talking about this package as if it were a shipping artifact |

## Living Memory

- Tests are guilty until proven useful. Keep a test only when it protects package capability, durable Revit/API proof knowledge, diagnostics, or a performance/proof lane.
- Delete low-value tests when the decision is clear. Quarantine only when deleting would lose review context.
- `Proofs/` tests should say they document Revit behavior; do not present them as ordinary package regression coverage.
- `Diagnostics/` and `Performance/` tests should be `[Explicit]` unless a named proof lane intentionally runs them by default.
- `ReviewLater/` files must include a short top-level comment explaining why they are suspect and what decision remains.
- Non-Revit contract/library tests belong in ordinary test packages such as `Pe.Shared.Tests`, not in this Revit-backed harness.
- Tests run inside real Revit, not a fake host.
- `ricaun.RevitTest` handles Revit process launching. If Revit is already open for the configured year, RevitTest can reuse it by default. That is not conducive to always-fresh assemblies, particularly when the open Revit instance is RRD.
- Prefer explicit-year `dotnet test`, not raw artifact-path `dotnet vstest`.
- Explicit-year `dotnet test -c Debug.R25.Tests ...` defaults to the `AttachedRrd` verify target and runs against assemblies already loaded in RRD unless you use the fresh helper.
- `.Tests` build artifacts can be fresh while the already-running `RRD` runtime is still stale. The build proves compilation, not loaded-assembly freshness.
- If the user restarted Revit from Rider by launching the normal `Pe.App` debug configuration, treat the deployed runtime add-in as fresh by default.
- AGENT GUIDANCE: AttachedRrd validation uses assemblies already loaded in RRD. If runtime code changed, coordinate package-local/runtime refresh through dev-agent live-loop tooling before attached-runtime `dotnet test`; an isolated `dotnet build` is not runtime freshness proof.
- Explicit-year raw `.Tests` runs are intentionally modeled as `AttachedRrd` verification, not ordinary `Build`.
- The pre-`VSTest` hook is an `AttachedRrd` session check only. It is not proof of runtime freshness and not a substitute for the explicit sync step.
- Raw `dotnet test` still inherits the adapter defaults unless you override them. If you need the runner-opened Revit process to behave like a dedicated fresh controlled host, use the explicit helper instead of assuming the adapter will do the right thing.
- The current `FreshRevitProcess` helper intentionally avoids `RRD`, quarantines the deployed desktop add-in for the target year, launches a fresh test-owned Revit process, and closes that process after the run.
- Do not assume an already-open test-owned Revit instance is safe to reuse for runtime freshness. If a stale owned process survives a failure or timeout, recycle it before another run.
- Apply the correct code fix first; do not narrow the implementation just to stay hot-reload-safe.
- Hot reload is not trustworthy after runtime member-shape changes such as added or removed members, method signature changes, constructor changes, enum shape changes, record shape changes, or new nested/private runtime types.
- When those changes happen, treat the Rider/Revit session as restart-required.
- A repo-specific HR failure mode can show up as `ENC0003` against generated `*.AssemblyInfo.cs` metadata. Treat that as restart-required and verify non-release informational-version stability before retrying.
- Another repo-specific HR failure mode can show up as `ENC2014` or missing output assembly state for an `MVID`. Treat that as lost HR baseline state and suspect build-mode collisions or replaced interactive outputs before blaming the code change itself.
- If a fix appears missing, verify a new targeted runtime log line or output artifact before concluding the logic is wrong.
- Prefer focused `dotnet test --filter ...` runs while iterating. Use the full suite after the local change is stable.
- The pre-`VSTest` session check still runs for filtered `dotnet test` and `dotnet test --no-build`, but it remains validation only.
- When validating constrained family behavior, test across multiple family types or multiple parameter states. Single-state checks miss broken associations.
- Revit-backed runs can leave `Revit.exe` or runner processes alive after timeouts. If later builds or deploys fail on file locks, clean up the stale process first.

### FF Triage Ladder

When a Family Foundry test fails, identify the failing layer first:

1. semantic/compiler validation
2. authored profile layout/orientation
3. operation-time logic
4. transaction commit warning/failure processing
5. snapshot / reverse-inference diagnostics

This avoids masking profile issues as runtime API bugs and vice versa.

### Output Artifacts

- FF roundtrip tests create a temp output folder per run.
- The exact path is printed to standard output as:

```text
[PE_FF_TEST_OUTPUT_DIRECTORY] C:\Users\...\AppData\Local\Temp\...
```

- Prefer the printed path over guessing temp locations.
