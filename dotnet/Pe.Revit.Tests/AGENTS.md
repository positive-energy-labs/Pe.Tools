# Pe.Revit.Tests

## Scope

Owns the VSTest-based Revit-backed test harness for this repo. The harness uses `ricaun.RevitTest` from NuGet.

## Purpose

`Pe.Revit.Tests` is a test harness, not a product. It exists to verify real Revit behavior through explicit verify targets instead of pretending `.Tests` builds prove anything about the loaded desktop runtime by themselves.

## Critical Entry Points

- `Pe.Revit.Tests.csproj` - explicit-year `.Tests` configurations, warning policy, and adapter metadata.
- `..\Pe.App\Pe.App.csproj` - desktop add-in graph under test.
- `..\..\.config\dotnet-tools.json` - repo-local SDK `pe-revit` tool pin.
- `Proofs/` - durable Revit/API behavior observations. These are not ordinary package regression tests.
- `LibraryBehavior/` - Revit-backed package behavior that needs a real document/session or currently depends on Revit-runtime target frameworks.
- `Diagnostics/` - operational environment probes and proof-lane diagnostics.
- `Performance/` - explicit scale/performance loops, not normal coverage.
- `Harness/` - reusable test fixtures, builders, probes, and assertions.
- `ReviewLater/` - quarantined tests that are suspect, low-value, or wrong-abstraction until reviewed.

## Validation

`pe-revit test --project <P>` is the whole test surface. It reads the project and picks the rung; there are no test sub-verbs. This package is `PeProjectKind=RevitTests`, so it never takes the deterministic rung — a year-neutral project (no referenced add-in project, not `RevitTests`) does, and that is where a non-Revit contract test belongs instead of here.

Default: the **fresh** rung. One ephemeral controlled Revit on the installed payload, the year's add-in quarantine leased, the process stopped at the end.

```powershell
dotnet tool run pe-revit -- test --project .\dotnet\Pe.Revit.Tests\Pe.Revit.Tests.csproj --filter "Name~Reports_runtime_assembly_load_paths" --timeout-seconds 900 --json
```

Override with **attached** only when the running session's documents, UI state, or loaded assemblies are the thing under test. `--attach` converges that session first, so the code under test is the code you just saved:

```powershell
dotnet tool run pe-revit -- test --project .\dotnet\Pe.Revit.Tests\Pe.Revit.Tests.csproj --attach --id pe.app-25 --filter "Name~SomeFocusedTest" --timeout-seconds 900 --json
```

For freshness outside a test run, `pe-revit session converge` attaches the hot-reload emitter to a live session and `pe-revit session restart` is the mechanism that actually reloads. Run `pe-revit test --plan --project <P>` when the rung is not obvious, and `pe-revit guide test` for the refusal table.

## Shared Language

| Term                  | Meaning                                                                            | Prefer / Avoid                                                     |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **rung**              | One branch of the `pe-revit test` ladder — deterministic, fresh, attached — chosen by the verb from the project and disclosed | Prefer this over "lane" for a test mode; never write `test fresh` as a verb |
| **attached**          | The rung that runs inside a controlled session that already exists (MSBuild `PeVerifyTarget=attached`) | Prefer this for proof against the running dev session              |
| **fresh**             | The rung that owns one ephemeral controlled Revit (MSBuild `PeVerifyTarget=fresh`) | Prefer this over vague `isolated test` phrasing              |
| **test harness**      | `Pe.Revit.Tests` owns verification orchestration, not a deployable product         | Avoid talking about this package as if it were a shipping artifact |

## Living Memory

- Tests are guilty until proven useful. Keep a test only when it protects package capability, durable Revit/API proof knowledge, diagnostics, or a performance/proof lane.
- Delete low-value tests when the decision is clear. Quarantine only when deleting would lose review context.
- `Proofs/` tests should say they document Revit behavior; do not present them as ordinary package regression coverage.
- `Diagnostics/` and `Performance/` tests should be `[Explicit]` unless a named proof lane intentionally runs them by default.
- `ReviewLater/` files must include a short top-level comment explaining why they are suspect and what decision remains.
- Non-Revit contract/library tests belong in ordinary test packages such as `Pe.Shared.Tests`, not in this Revit-backed harness.
- Tests run inside real Revit, not a fake host.
- `ricaun.RevitTest` handles Revit process launching. If Revit is already open for the configured year, RevitTest can reuse it by default. That is not conducive to always-fresh assemblies, particularly when the open Revit instance is the dev session.
- Prefer explicit-year `dotnet test`, not raw artifact-path `dotnet vstest`.
- Explicit-year `dotnet test -c Debug.R25.Tests ...` defaults to the `attached` verify target and runs against assemblies already loaded in a running session. Raw `dotnet test` is banned for this package; `pe-revit test --project <P>` is the sanctioned path.
- `.Tests` build artifacts can be fresh while a running session's loaded assemblies are still stale. The build proves compilation, not loaded-assembly freshness.
- After `pe-revit session restart`, treat the session's payload as fresh: restart materializes a new generation before stopping the old process.
- AGENT GUIDANCE: the attached rung uses assemblies already loaded in the session. If runtime code changed, let `--attach` converge it (or `pe-revit session restart` for a rude edit) before reading the result; an isolated `dotnet build` is not runtime freshness proof.
- Explicit-year raw `.Tests` runs are intentionally modeled as attached verification, not ordinary `Build`.
- The pre-`VSTest` hook is an attached session check only. It is not proof of runtime freshness and not a substitute for converging or restarting the session.
- Raw `dotnet test` still inherits the adapter defaults unless you override them. If you need a dedicated Revit the run owns and stops, use `pe-revit test --project <P>` instead of assuming the adapter will do the right thing.
- The fresh rung intentionally avoids every existing session: it quarantines the deployed desktop add-in for the target year, launches one exact descendant Revit under an ephemeral session receipt, and stops only that incarnation. `session status` shows the row while it runs; `session gc` sweeps it if a run dies badly.
- Do not assume an already-open test-owned Revit is safe to reuse for runtime freshness. If a stale one survives a failure or timeout, `pe-revit session gc` sweeps its ephemeral row; `--unstick` reclaims a verifiably orphaned year lease.
- Apply the correct code fix first; do not narrow the implementation just to stay hot-reload-safe.
- Hot reload is not trustworthy after runtime member-shape changes such as added or removed members, method signature changes, constructor changes, enum shape changes, record shape changes, or new nested/private runtime types.
- When those changes happen, treat the session as restart-required — that is what converge reports as `session.restart-required`.
- A repo-specific hot-reload failure mode can show up as `ENC0003` against generated `*.AssemblyInfo.cs` metadata. Treat that as restart-required and verify non-release informational-version stability before retrying.
- Another repo-specific hot-reload failure mode can show up as `ENC2014` or missing output assembly state for an `MVID`. Treat that as a lost emitter baseline and suspect build-mode collisions or replaced interactive outputs before blaming the code change itself.
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
