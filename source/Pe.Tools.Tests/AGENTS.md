# Agent Standards (MUST READ)

TUnit is built on top of the Microsoft.Testing.Platform. Combined with
source-generated tests, running your tests is available in multiple ways.

`dotnet run` For simple project execution, dotnet run is the preferred method,
allowing easier command line flag passing.

```powershell
cd 'C:/Your/Test/Directory'
dotnet run -c "Release.R26"
```

For Revit-backed test runs that must not disturb an active debug session, use
the `.Tests` configurations. Choose this by default. They isolate `bin/obj` into the repo
`.artifacts/tests` lane and disable addin deployment from dependent Revit
projects such as `Pe.App`.

```powershell
cd 'C:/Your/Test/Directory'
dotnet run -c "Debug.R25.Tests"
```

`dotnet test` dotnet test requires the configuration to target the desired Revit
version.

```powershell
cd 'C:/Your/Test/Directory'
dotnet test -c "Release.R26"
```

---

## LIVING MEMORY (update as needed to avoid common mistakes and bad assumptions)

- Prefer `Debug.R25.Tests`-style configs for `Pe.Tools.Tests`. These configs
  route outputs to `.artifacts/tests` and prevent `Pe.App` from deploying into
  `%AppData%\Autodesk\Revit\Addins\...` during test builds.
- This runner is TUnit on Microsoft.Testing.Platform, not VSTest. Do not use
  `--filter`; use `--treenode-filter` instead.
- Example focused run:

```powershell
dotnet run --project source/Pe.Tools.Tests/Pe.Tools.Tests.csproj -c "Debug.R25.Tests" -- --disable-logo --no-progress --output Normal
```

- `dotnet run` always builds unless `--no-build` is passed. For iterative runs,
  build once and then rerun with `--no-build` to avoid touching the executable
  path repeatedly.
- If `Pe.Tools.Tests.exe` is locked during rebuild, the previous test host is
  still running. Clean it up before retrying:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'Pe.Tools.Tests.exe'" | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate }
```

- Interrupting a TUnit/Revit run can leave `Pe.Tools.Tests.exe` alive. Assume
  the process is still resident until proven otherwise.
- The old repo-root scratch folders `.tmphostbuild` and `.tmprevitcheck` were
  workaround lanes and are superseded for test runs by the `.Tests`
  configurations.
