# Agent Standards (MUST READ)

TUnit is built on top of the Microsoft.Testing.Platform. Combined with
source-generated tests, running your tests is available in multiple ways.

`dotnet run` For simple project execution, dotnet run is the preferred method,
allowing easier command line flag passing.

```powershell
cd 'C:/Your/Test/Directory'
dotnet run -c "Release.R26"
```

`dotnet test` dotnet test requires the configuration to target the desired Revit
version.

```powershell
cd 'C:/Your/Test/Directory'
dotnet test -c "Release.R26"
```

---

## LIVING MEMORY (update as needed to avoid common mistakes and bad assumptions)

- if tests fail to due to file access issues, do not work around this. Instead
  defer to the user to properly close all their terminals, IDEs, Revit itself,
  etc.
