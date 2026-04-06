# Pe.Tools.RevitTest.Tests

This project runs real Revit-backed integration tests through
`ricaun.RevitTest` and NUnit. Treat it as the preferred lane for document-heavy
family tests.

## Core model

- Tests run inside real Revit, not a fake host.
- This project is VSTest-based.
- In this repo, `dotnet test` is awkward here because `global.json` forces
  Microsoft Testing Platform. Prefer `dotnet build` plus `dotnet vstest`.
- The test assembly comes from `.artifacts/tests`, but runtime code still comes
  from the assemblies already loaded by Revit from the deployed addin lane.
- A `.Tests` build is safe test-lane prep during a live Rider/Revit debug
  session. It does not prove that Revit loaded fresh runtime code.
- If the user restarted Revit from Rider by launching the normal `Pe.App`
  debug configuration, treat the deployed runtime lane as fresh by default.
- A `.Tests` build does not redeploy the `%APPDATA%\Autodesk\Revit\Addins\2025`
  addin copy while Revit is open. If you truly need a fresh deployed runtime,
  that has to come from a normal `Pe.App` debug launch/restart.

## Preferred loop

1. Launch Revit from Rider using the normal `Pe.App` runtime debug config.
2. Edit code.
3. Build this project in the matching `.Tests` configuration.
4. Let the post-build helper attempt Rider hot reload for changed runtime files.
5. Run focused `dotnet vstest` commands from terminal.
6. If behavior or logs do not match source, assume stale runtime assemblies
   first. Confirm hot reload actually applied or restart the runtime lane.
7. After a fresh Rider `Pe.App` restart, do not keep blaming stale assemblies
   unless there is concrete divergence between source and runtime behavior.

## Commands

Build:

```powershell
dotnet build source/Pe.Tools.RevitTest.Tests/Pe.Tools.RevitTest.Tests.csproj -c "Debug.R25.Tests" /p:WarningLevel=0
```

Run one test:

```powershell
dotnet vstest .artifacts/tests/bin/Debug.R25.Tests/net8.0-windows/Pe.Tools.RevitTest.Tests.dll /Tests:Can_create_generic_model_family_document_from_rft
```

Run one test and print artifact paths:

```powershell
dotnet vstest .artifacts/tests/bin/Debug.R25.Tests/net8.0-windows/Pe.Tools.RevitTest.Tests.dll /Tests:FFManager_round_duct_connector_roundtrips_and_stub_resizes_across_types /logger:"console;verbosity=detailed"
```

## Runtime staleness

- If behavior does not match source edits, suspect stale in-process assemblies
  before assuming the change failed.
- Apply the correct code fix first; do not narrow the implementation just to
  stay hot-reload-safe.
- Hot reload is not trustworthy after runtime member-shape changes such as:
  added or removed members, method signature changes, constructor changes,
  enum shape changes, record shape changes, or new nested/private runtime types.
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

- Prefer focused `vstest` runs while iterating. Use the full suite after the
  local change is stable.
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
