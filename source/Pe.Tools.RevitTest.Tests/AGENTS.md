# Pe.Tools.RevitTest.Tests

This project is a `ricaun.RevitTest` / NUnit spike for running real Revit-backed
integration tests against `Pe.App`. This project will mainly house document-requiring tests for `Pe.FamilyFoundry` (Nice3point.TUnit.Revit cannot handle opening documents in the way that we need, nor can run tests in a running revit instance).

## Core model

- Tests run inside real Revit, not a fake host.
- This project is VSTest-based, not TUnit-based.
- In this repo, `global.json` forces Microsoft Testing Platform, so `dotnet test`
  is awkward for this project. Prefer `dotnet build` + `dotnet vstest`.
- The `ricaun` runner can reuse an already-open same-version Revit session. This
  is the intended path for debugging and potentially hot reload experiments.
- The code actually executed in Revit comes from the addin-loaded assemblies in
  `%AppData%\Autodesk\Revit\Addins\2025\Pe.App`, not from `.artifacts/tests`,
  except for the test assembly itself.
- Building this test project in a `.Tests` config is safe during a live
  Rider/Revit debug session and is the preferred way to prep `ricaun` runs.
  That build updates the test assembly and runs the post-build Rider hot-reload
  helper, but it does not by itself guarantee that Revit loaded fresh runtime
  code.
- `ricaun` filter support is limited to `FullyQualifiedName` and `Name`.
- `RICAUN_REVITTEST_TESTADAPTER_*` env vars exist for adapter settings, but this
  project intentionally does not depend on custom in-test env vars for fixture
  or template discovery. Reused Revit processes make that contract unreliable.

## Preferred loop

1. Launch Revit from Rider using the existing `Pe.App` runtime debug config for
   the target Revit year.
2. Build `source/Pe.Tools.RevitTest.Tests/Pe.Tools.RevitTest.Tests.csproj` in
   the matching `.Tests` config, usually `Debug.R25.Tests`.
3. Let the post-build helper open changed runtime `.cs` files in Rider and try
   to apply hot reload automatically.
4. Run focused `dotnet vstest` commands from terminal.
5. If logs do not reflect the new code, assume runtime staleness first, then
   verify hot reload actually applied or redeploy/restart the runtime lane if
   needed.

## Commands

Build:

```powershell
dotnet build source/Pe.Tools.RevitTest.Tests/Pe.Tools.RevitTest.Tests.csproj -c "Debug.R25.Tests" /p:WarningLevel=0
```

- This build is expected to print:
  - `Running Rider hot reload prep...`
  - `Running add-in auto-approval watcher...`
- Those post-build helpers are convenience steps for the live debug workflow.
  They do not replace checking that Revit actually picked up the runtime edit.

Run one test:

```powershell
dotnet vstest .artifacts/tests/bin/Debug.R25.Tests/net8.0-windows/Pe.Tools.RevitTest.Tests.dll /Tests:Can_create_generic_model_family_document_from_rft
```

Other useful tests:

```powershell
dotnet vstest .artifacts/tests/bin/Debug.R25.Tests/net8.0-windows/Pe.Tools.RevitTest.Tests.dll /Tests:Can_open_real_family_fixture_document
dotnet vstest .artifacts/tests/bin/Debug.R25.Tests/net8.0-windows/Pe.Tools.RevitTest.Tests.dll /Tests:FFManager_magic_box_profile_roundtrips_on_real_family_document
dotnet vstest .artifacts/tests/bin/Debug.R25.Tests/net8.0-windows/Pe.Tools.RevitTest.Tests.dll /Tests:FFManager_magic_box_profile_roundtrips_on_generic_model_template_document
```

## Fixtures and template path

- Real family fixture path is intentionally fixed in the harness:
  `C:\Users\kaitp\Positive Energy Dropbox\PE Team Folder\06 PE BIMCAD Resources\Revit Resources\2_Families\Generic Primitives\box 24 (me).rfa`
- Family template path is intentionally fixed in the harness:
  `C:\ProgramData\Autodesk\RVT 2025\Family Templates\English-Imperial\Generic Model.rft`
- Do not reintroduce custom env-var-based path overrides here unless the process
  boundary story is reworked. With `ricaun`, a reused Revit process is normal.

## Output artifacts

- FF roundtrip tests create a temp output folder per run.
- The exact path is printed into standard output as:

```text
[PE_FF_OUTPUT_DIRECTORY] C:\Users\...\AppData\Local\Temp\...
```

- Do not assume the folder is directly under `%TEMP%\Pe.Tools.RevitTest.Tests`.
- `ricaun.RevitTest` may execute under GUID-scoped temp roots such as:
  - `%TEMP%\<guid>\Pe.Tools.RevitTest.Tests`
  - `%TEMP%\<guid>\RevitTest\Pe.Tools.RevitTest.Tests`
- Prefer the printed path over manually guessing temp locations.

## What works

- Opening a real `.rfa` fixture works.
- Creating a new family from `Generic Model.rft` works via
  `Application.NewFamilyDocument(...)`.
- Running FF roundtrip tests in `ricaun` works better than the Nice3point/TUnit
  lane for heavy FF processing; tests complete and return actionable assertions.
- Saving processed family copies to the printed output directory works for both
  real fixture docs and template-created family docs.
- Unsaved template-created family docs no longer need a fake "internal path"
  workaround to save an output copy.

## Critical caveat

- If you change `Pe.App`, `Pe.FamilyFoundry`, `Pe.Global`, `Pe.SettingsCatalog`,
  etc., rebuilding only this test project does not update the code already loaded
  in Revit.
- Hot reload can patch many runtime edits into the live Rider/Revit session, but
  not every change is hot-reloadable. If a new log line or behavior is missing,
  suspect that the runtime patch did not apply.
- To test changed runtime behavior after a failed or unsupported hot reload, the
  deployed addin binaries may need to be rebuilt into
  `%AppData%\Autodesk\Revit\Addins\2025\Pe.App` and Revit restarted.
- This is the main workflow impediment for hot reload experiments, not the
  `.Tests` build itself.

## Hot reload experiment status

- Confirmed workflow: launch Revit from Rider using the existing `Pe.App`
  `Debug.R25` debug config, then run `ricaun` tests from terminal against that
  same live Revit session.
- A smoke test passed in that mode without rebuilding:

```powershell
dotnet vstest .artifacts/tests/bin/Debug.R25.Tests/net8.0-windows/Pe.Tools.RevitTest.Tests.dll /Tests:Can_create_generic_model_family_document_from_rft
```

- Verified behavior:
  - Building `Pe.Tools.RevitTest.Tests` in `Debug.R25.Tests` is safe while the
    user is debugging `Pe.App` in `Debug.R25`.
  - That build does **not** directly update the runtime code already loaded in
    Revit.
  - The post-build script can still help by opening changed runtime files in
    Rider and triggering Rider hot reload automatically.
  - The AutoHotkey trigger now shows a topmost warning/countdown before it
    focuses Rider and sends keys. Default is 3 seconds.
  - `PrepareRiderHotReload.ps1` accepts `-WarningSeconds <n>` to tune that
    delay and `-SkipWarning` to suppress it for unattended runs.
  - Tests execute against the live code currently loaded in the Rider-launched
    Revit session.
  - If a `Pe.App` / `Pe.FamilyFoundry` file is hot reloaded in Rider, the
    subsequent `ricaun` test run sees the hot-reloaded behavior.
- Practical workflow:
  1. Launch Revit from Rider using `Pe.App` in `Debug.R25`.
  2. Do not rebuild `Pe.App` after that if you want to preserve hot reload.
  3. Make test and/or runtime code edits.
  4. Build `Pe.Tools.RevitTest.Tests` in `Debug.R25.Tests`.
  5. Let the post-build helper attempt Rider hot reload for changed runtime
     files.
  6. If needed, manually confirm Rider reports successful hot reload.
  7. Run focused `ricaun` tests from terminal with `dotnet vstest`.
- This is the preferred iteration loop.

## Dead ends / do not do this

- Do not assume rebuilding `Pe.Tools.RevitTest.Tests` in `.Tests` means Revit is
  now running the fresh `Pe.App` / `Pe.FamilyFoundry` bits. It is not.
- Do not rebuild `Pe.App` while the user is in a live Rider Revit debug session
  unless they explicitly accept losing future hot reload for that session.
- Do not treat `%AppData%` addin deployment and `.artifacts/tests` output as the
  same runtime lane.
- Do not use `dotnet test` for this project in this repo. Prefer `dotnet build`
  - `dotnet vstest`.
- Do not assume `dotnet build ... Debug.R25.Tests` updates assemblies already
  loaded inside a live Rider/Revit debug session.
- Do not rely on Nice3point/TUnit for heavy FF roundtrips. That path produced
  hangs/crashes and was inferior to `ricaun` for this use case.
- Do not infer real source breakage from giant transient Rider hot reload
  CS0234/CS0246 cascades if LSP is otherwise clean.
- Do not infer real source breakage from an old log stream. If newly-added debug
  messages do not appear, the runtime lane is probably stale or the hot reload
  patch failed.
- Do not create/open new family documents from `.rft` through the old
  Nice3point/TUnit lane. That was host-problematic. The `ricaun` lane works.
- Do not assume `doc.ActiveView` is valid in blank family documents created from
  templates during tests. Use explicit non-template view fallback.
- Do not assume an FF roundtrip failure means the authoring op failed. We found
  at least one case where extrusion snapshot recognition lagged behind the
  authoring model.

## Current FF findings

- Template-based FF roundtrip now gets through parameter, ref plane, and
  dimension creation after adding view fallback logic.
- The `ParamDrivenSolids` spike now has passing `ricaun` coverage for:
  rectangle roundtrip, cylinder roundtrip, stacked shared constraints,
  box-plus-cylinder-on-face-equivalent-plane, and ambiguity-blocks-execution.
- A major source of confusion during this spike was stale runtime behavior. The
  reliable signal was whether newly-added debug logs from `Pe.FamilyFoundry`
  appeared during `ricaun` runs.
- The snapshot collector now has more robust fallback logic for alignment-based
  and semantically recoverable circle/cylinder cases. Future failures in this
  area should be investigated with runtime logs before changing the public model.

## Files of interest

- `source/Pe.Tools.RevitTest.Tests/FamilyFoundryRoundtripTests.cs`
- `source/Pe.Tools.RevitTest.Tests/RevitFamilyFixtureHarness.cs`
- `source/Pe.App/Commands/FamilyFoundry/CmdFFManager.cs`
- `source/Pe.FamilyFoundry/Helpers/RefPlaneDimCreator.cs`
- `source/Pe.FamilyFoundry/Operations/MakeConstrainedExtrusions.cs`
- `source/Pe.FamilyFoundry/Snapshots/ExtrusionSectionCollector.cs`

## Guidance for future agents

- Do not assume `dotnet test` is the right runner here.
- Do not assume `.artifacts/tests` binaries are the same binaries executing
  inside Revit.
- Be extremely careful not to rebuild `Pe.App` while the user is in a Rider
  Revit debug session unless they explicitly want to give up future hot reload.
- If behavior does not match source edits, suspect stale deployed addin
  assemblies or a failed hot reload first.
- The fastest sanity check is to add a targeted `Log.Debug(...)` in the runtime
  path you changed and confirm that exact message appears in the next `ricaun`
  run.
