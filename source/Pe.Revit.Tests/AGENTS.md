# Pe.Revit.Tests

This project runs real Revit-backed integration tests through `ricaun.RevitTest`.

## Core model

- Tests run inside real Revit, not a fake host.
- This project is VSTest-based.
- Prefer `dotnet test`, not raw artifact-path `dotnet vstest`.
- `.Tests` outputs are isolated and RRD-safe. They do not build against or redeploy the live `%APPDATA%\Autodesk\Revit\Addins\{RevitVersion}\Pe.App` copy Rider is using.
- A `.Tests` build can be fresh while the already-running RRD runtime is still stale.
- If the user restarted Revit from Rider by launching the normal `Pe.App` debug configuration, treat the deployed runtime add-in as fresh by default.
- `pe-dev revit test ...` is now the preferred deterministic path when test freshness depends on a changed `Pe.App` dependency graph. By default it auto-selects a safe Revit year in the same runtime family that is not already running, then forces a dedicated test Revit process and temporarily quarantines the deployed `Pe.App` add-in for that year.
- The Revit window left open after `pe-dev revit test` is only for inspection or ad hoc debugging. The next `pe-dev revit test` run should recycle that owned session instead of attaching to it, because attach-mode reuse proved stale for `Pe.App` graph validation.

## Preferred loop

1. Launch Revit from Rider using the normal `Pe.App` runtime debug config.
2. Edit code.
3. Build the affected runtime package-local outputs if the test depends on live in-process code changes.
4. Run `pe-dev revit sync-runtime` and confirm it succeeded.
5. Build this project in the matching `.Tests` configuration.
6. Run focused `dotnet test` commands from terminal.
7. Treat the pre-`VSTest` hook as best-effort backup only, not the primary refresh step.
8. If behavior or logs do not match source, assume stale runtime assemblies first. Confirm hot reload actually applied or restart the runtime add-in.
9. After a fresh Rider `Pe.App` restart, do not keep blaming stale assemblies unless there is concrete divergence between source and runtime behavior.

For a dedicated fresh-process lane that should not reuse RRD or auto-load the deployed desktop add-in, prefer:

```powershell
pe-dev revit test --filter "FullyQualifiedName~Can_create_generic_model_family_document_from_rft"
```

## Commands

Build:

```powershell
pe-dev revit sync-runtime
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c "Debug.R25.Tests" /p:WarningLevel=0
```

Deterministic fresh-process test run:

```powershell
pe-dev revit test --filter "Name~AssemblyLoadDiagnostics"
```

Run one test:

```powershell
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "FullyQualifiedName~Can_create_generic_model_family_document_from_rft"
```

Run one named test without rebuilding:

```powershell
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~FFManager_round_duct_connector_roundtrips_and_stub_resizes_across_types" --no-build
```

## Runtime staleness

- If behavior does not match source edits, suspect stale in-process assemblies before assuming the change failed.
- Explicit `pe-dev revit sync-runtime` before `dotnet test` is the required posture when the test depends on changed live runtime packages.
- Raw `dotnet test` still inherits the adapter defaults unless you override them. If you need the runner-opened Revit process to behave like a fresh controlled host, prefer `pe-dev revit test`.
- Raw `dotnet test` now emits a pre-`VSTest` warning in this project unless the run is being orchestrated by `pe-dev revit test`. Treat that warning as intentional steering, not noise.
- Do not assume an already-open test-owned Revit instance is safe to reuse for runtime freshness. Under the current `ricaun.RevitTest` flow, process reuse was not trustworthy even when the target year and test assembly were stable.
- The pre-test hot reload hook is best-effort alignment, not proof of runtime freshness and not a substitute for the manual HR step.
- Apply the correct code fix first; do not narrow the implementation just to stay hot-reload-safe.
- Hot reload is not trustworthy after runtime member-shape changes such as: added or removed members, method signature changes, constructor changes, enum shape changes, record shape changes, or new nested/private runtime types.
- When those changes happen, treat the Rider/Revit session as restart-required.
- A recent repo-specific HR failure mode came from generated `*.AssemblyInfo.cs` metadata churn. If Rider reports `ENC0003` against generated assembly-info files, treat the session as restart-required and verify non-release informational-version stability before retrying.
- A recent repo-specific HR failure mode also shows up as `ENC2014` / missing output assembly for an MVID. Treat that as lost HR baseline state and suspect lane collisions or replaced interactive outputs before blaming the code change itself.
- If a fix appears missing, verify a new targeted runtime log line or output
  artifact before concluding the logic is wrong.

## FF triage ladder

When a Family Foundry test fails, identify the failing layer first:

1. semantic/compiler validation
2. authored profile layout/orientation
3. operation-time logic
4. transaction commit warning/failure processing
5. snapshot / reverse-inference diagnostics

This avoids masking profile issues as runtime API bugs and vice versa.

## Test guidance

- Prefer focused `dotnet test --filter ...` runs while iterating. Use the full suite after the local change is stable.
- The pre-`VSTest` automation still runs for filtered `dotnet test` and for `dotnet test --no-build`, but it is backup automation only.
- When validating constrained family behavior, test across multiple family
  types or multiple parameter states. Single-state checks miss broken
  associations.
- Revit-backed runs can leave `Revit.exe` or runner processes alive after
  timeouts. If later builds or deploys fail on file locks, clean up the stale
  process first.

## Output artifacts

- FF roundtrip tests create a temp output folder per run.
- The exact path is printed to standard output as:

```text
[PE_FF_TEST_OUTPUT_DIRECTORY] C:\Users\...\AppData\Local\Temp\...
```

- Prefer the printed path over guessing temp locations.
