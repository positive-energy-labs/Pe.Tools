# Pe.Revit.Tests

This project runs real Revit-backed integration tests through `ricaun.RevitTest`.

## Core model

- Tests run inside real Revit, not a fake host.
- This project is VSTest-based.
- Prefer `dotnet test`, not raw artifact-path `dotnet vstest`.
- `.Tests` outputs are isolated and RRD-safe. They do not build against or redeploy the live `%APPDATA%\Autodesk\Revit\Addins\{RevitVersion}\Pe.App` copy Rider is using.
- A `.Tests` build can be fresh while the already-running RRD runtime is still stale.
- If the user restarted Revit from Rider by launching the normal `Pe.App` debug configuration, treat the deployed runtime add-in as fresh by default.

## Preferred loop

1. Launch Revit from Rider using the normal `Pe.App` runtime debug config.
2. Edit code.
3. Build this project in the matching `.Tests` configuration.
4. Run focused `dotnet test` commands from terminal.
5. Let the pre-`VSTest` hook start `pe-dev revit approve` and attempt `pe-dev revit hot-reload`.
6. If behavior or logs do not match source, assume stale runtime assemblies first. Confirm hot reload actually applied or restart the runtime add-in.
7. After a fresh Rider `Pe.App` restart, do not keep blaming stale assemblies unless there is concrete divergence between source and runtime behavior.

## Commands

Build:

```powershell
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c "Debug.R25.Tests" /p:WarningLevel=0
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
- The pre-test hot reload hook is best-effort alignment, not proof of runtime freshness.
- Apply the correct code fix first; do not narrow the implementation just to stay hot-reload-safe.
- Hot reload is not trustworthy after runtime member-shape changes such as: added or removed members, method signature changes, constructor changes, enum shape changes, record shape changes, or new nested/private runtime types.
- When those changes happen, treat the Rider/Revit session as restart-required.
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
- The pre-`VSTest` automation still runs for filtered `dotnet test` and for `dotnet test --no-build`.
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
