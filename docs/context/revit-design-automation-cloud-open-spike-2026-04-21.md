# Revit Design Automation Cloud-Open Spike Notes — April 21, 2026

This is a saved technical context note for the auth-first cloud-open spike. It intentionally preserves the command loop and the output shapes that mattered during the investigation without trying to become the durable architecture doc.

For the durable conceptual doc, see:

- `docs/features/revit-design-automation/_DEV.md`
- `docs/features/revit-design-automation/_GOALS.md`

## Command Loop Used

### 1. Build the CLI and orchestration packages

```powershell
dotnet build source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25 /p:WarningLevel=0
```

Observed output shape:

```text
Determining projects to restore...
...
Pe.Dev.RevitAutomation -> ...\Pe.Dev.RevitAutomation.dll
Pe.Dev.Cli -> ...\pe-dev.dll

Build succeeded.
```

### 2. Inspect a previously submitted workitem

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation workitem-status --workitem-id <workitem-id> --mask false
```

Observed output shape for a failed engine-load case:

```text
Workitem: <workitem-id>
Status: failedInstructions
ReportUrl: <presigned-report-url>
Classification: CloudModelOpenFailed
Report:
[...]
Error: Application revitcoreconsole.exe exits with code 4 which indicates an error.
Error: An unexpected error happened during phase CoreEngineExecution of job.
```

At this stage there were no `PE_AUTOMATION_PROBE START` markers, which strongly implied the worker never actually loaded.

### 3. Rerun the probe after changing bundle packaging / manifest logic

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation probe-access --region US --project-guid <project-guid> --model-guid <model-guid> --expected-title "<expected-title>" --mask false --timeout-seconds 600
```

Observed output shape for the pre-fix failure:

```text
Auth: acquiring management token
Auth: acquiring delegated user token
Building worker project (Debug.R25)
Automation: resolving appbundle
Automation: resolving activity
Automation: submitting workitem
Automation: workitem <workitem-id>
Classification: CloudModelOpenFailed
Engine: Autodesk.Revit+2025
Region: US
Project: <project-guid>
Model: <model-guid>
Workitem: <workitem-id>
Report:
[...]
Error: Application revitcoreconsole.exe exits with code 4 which indicates an error.
```

### 4. Fetch the full raw report directly from `ReportUrl`

```powershell
$reportUrl = '<ReportUrl copied from workitem-status>'
(Invoke-WebRequest -UseBasicParsing -Uri $reportUrl).Content
```

This exposed the decisive root-cause line:

```text
Got exception for '<package-path>': System.IO.DirectoryNotFoundException: Could not find *.bundle in AppBundle
```

That proved the problem was the uploaded zip shape, not cloud auth, region, project GUID, or model GUID.

### 5. Rerun after fixing the zip root so the `.bundle` directory itself is present at zip root

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation probe-access --region US --project-guid <project-guid> --model-guid <model-guid> --expected-title "<expected-title>" --mask false --timeout-seconds 600
```

Observed successful output shape:

```text
Auth: acquiring management token
Auth: acquiring delegated user token
Building worker project (Debug.R25)
Automation: resolving appbundle
Automation: resolving activity
Automation: submitting workitem
Automation: workitem <workitem-id>
Classification: Success
Engine: Autodesk.Revit+2025
Region: US
Project: <project-guid>
Model: <model-guid>
Workitem: <workitem-id>
Document: <expected-title>
Report:
PE_AUTOMATION_PROBE START
PE_AUTOMATION_PROBE INPUT {...}
PE_AUTOMATION_PROBE OPEN_SUCCESS {...}
PE_AUTOMATION_PROBE END
```

### 6. Re-check the successful workitem from the status lane

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation workitem-status --workitem-id <workitem-id> --mask false
```

Observed output shape:

```text
Workitem: <workitem-id>
Status: success
ReportUrl: <presigned-report-url>
Classification: Success
Document: <expected-title>
Report:
PE_AUTOMATION_PROBE START
PE_AUTOMATION_PROBE INPUT {...}
PE_AUTOMATION_PROBE OPEN_SUCCESS {...}
PE_AUTOMATION_PROBE END
```

## Specific Fixes Proven in This Session

### Bundle zip shape

The uploaded appbundle zip must contain:

```text
Pe.Dev.RevitAutomation.Worker.bundle/
  PackageContents.xml
  Contents/
    Pe.Dev.RevitAutomation.Worker.addin
    Pe.Dev.RevitAutomation.Worker.dll
    ...dependencies...
```

Zipping only the contents of the `.bundle` directory causes Design Automation loader failure before the worker starts.

### PackageBuilder reuse

The worker bundle generation now reuses `Autodesk.PackageBuilder`, the same library already used by `build/Modules/CreateBundleModule.cs`, for:

- `PackageContents.xml`
- `Pe.Dev.RevitAutomation.Worker.addin`

That reduces risk compared to handwritten XML and aligns the spike with the repo’s proven bundle-generation approach.

## Fast Failure Heuristics

- No `START` marker in the report:
  - suspect appbundle/add-in/dependency load before cloud-open logic
- `OPEN_FAIL_UNAUTHORIZED` marker:
  - suspect delegated user access to the cloud model/project
- `OPEN_FAIL_NOT_FOUND` marker:
  - suspect region/project/model ids
- `OPEN_SUCCESS` marker:
  - the auth-first cloud-open proof succeeded; move on to next-layer automation goals
