# Revit Design Automation

This feature is no longer just an auth-first cloud-open spike. It now has a general-purpose DA shell, a shared operator CLI surface, a diagnostic cloud-open workload, and a first production workload for parameter collection.

## Mental Model

- `pe-dev revit automation ...` is the operator surface.
- `Pe.Dev.Cli` parses arguments and prints human or JSON output.
- `Pe.Dev.RevitAutomation` does everything local and out-of-proc: read credentials, acquire APS tokens, build/package the worker, upsert appbundle/activity, submit workitems, inspect status, download artifacts, and classify failures.
- `Pe.Dev.RevitAutomation.Worker` is the in-engine automation shell: read the common job payload, open the cloud model, dispatch to a typed workload handler, write artifacts, emit shell markers, close the document, exit.
- `Pe.Revit.Global.Services.Aps` is the shared APS/auth seam.
- `Pe.Revit.Global` owns DA-safe document collectors and contracts that both desktop and automation shells can share.

## Current Workloads

### Diagnostic workload

- Command: `pe-dev revit automation probe-access ...`
- Purpose: prove APS auth, worker load, and cloud model open against a known model.
- Output: classification plus marker excerpt.

### Production workload

- Command: `pe-dev revit automation collect-parameters ...`
- Purpose: open a cloud model and emit a structured parameter collection artifact.
- Output: JSON artifact with provenance plus a parsed workitem summary.

### Batch submission

- Command: `pe-dev revit automation collect-parameters-batch --manifest <path>`
- Purpose: submit one parameter-collection workitem per cloud model from a manifest.
- Output: per-model submission and status summary plus downloaded artifacts for successful runs.

### Inspection

- Command: `pe-dev revit automation workitem-status --workitem-id <id>`
- Purpose: inspect an existing workitem without resubmitting it.

## Cross-Package Shape

- `source/Pe.Dev.Cli`
  - `AutomationCliProgram.cs`
  - `AutomationProbeAccessCliOptions.cs`
  - `AutomationParameterCollectionCliOptions.cs`
  - `AutomationParameterCollectionBatchCliOptions.cs`
  - `AutomationWorkItemCliOptions.cs`
- `source/Pe.Dev.RevitAutomation`
  - `RevitAutomationProbeService.cs`
  - `RevitAutomationParameterCollectionService.cs`
  - `RevitAutomationParameterCollectionBatchService.cs`
  - `RevitAutomationWorkerBundleBuilder.cs`
  - `RevitAutomationShellDefinitions.cs`
  - `RevitAutomationWorkItemInspectorService.cs`
  - `AutomationObjectStorageClient.cs`
  - `StoredApsWebAuthTokenProvider.cs`
  - `GlobalSettingsFileReader.cs`
- `source/Pe.Dev.RevitAutomation.Worker`
  - `RevitAutomationShellApp.cs`
- `source/Pe.Revit.Global/Services/Aps`
  - `Aps.cs`
  - `Core/OAuth.cs`
  - `Core/OAuthHandler.cs`
  - `Core/AutomationApiClient.cs`
  - `Models/Automation*`
- `source/Pe.Revit.Global/Revit/Lib/Parameters`
  - `ParameterCollectionArtifactCollector.cs`
- `source/Pe.Shared.HostContracts/RevitData`
  - `ParameterCollectionContracts.cs`

## Shell Split

### Desktop shell

- `Pe.App`
- owns UI startup, ribbon, bridge, scripting host, and other interactive session concerns

### Automation shell

- `Pe.Dev.RevitAutomation.Worker`
- owns the headless `IExternalDBApplication` entrypoint
- subscribes to `DesignAutomationReadyEvent`
- reads the common DA job input
- opens the document
- dispatches a workload
- writes artifacts

The important rule is: these are sibling shells over shared runtime packages. DA does not run `Pe.App` startup.

## Dependency Direction

- Both shells may depend on DA-safe runtime packages such as `Pe.Revit.Global`, `Pe.Revit.Extensions`, shared contracts, and document-owned collectors.
- Shared packages must not depend back on either shell.
- DA-safe collector paths must not depend on `UIApplication`, WPF, ribbon helpers, host bridge logic, or interactive session services.
- If a useful behavior currently hangs off desktop startup or a UI session helper, lift the reusable part downward into a DA-safe package before wiring it into the automation shell.

One real example: formula collection previously reached through a UI-session helper to find open family docs. That had to be refactored to use a document/application-owned headless seam before parameter collection could succeed in DA.

## Auth Split

The Design Automation flow intentionally uses two APS tokens.

### Management token

- flow kind: `ApsAuthFlowKind.TwoLegged`
- request factory: `ApsTokenRequest.ForAutomationManagement()`
- used for appbundle CRUD, activity CRUD, workitem submission, and status/report access

### User-context token

- flow kind: `ApsAuthFlowKind.ThreeLeggedConfidential`
- request factory: `ApsTokenRequest.ForAutomationUserContext()`
- passed into the workitem as `adsk3LeggedToken`
- consumed by Revit/DA while opening the cloud model inside the worker

## Operator Commands

### Build the CLI lane

```powershell
dotnet build source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25 /p:WarningLevel=0
```

### Submit the cloud-open probe

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation probe-access --region US --project-guid <project-guid> --model-guid <model-guid> --expected-title "<expected-title>" --mask false --timeout-seconds 600
```

### Submit bounded parameter collection

Use a narrow category first. Full family matrix collection is multi-minute.

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation collect-parameters --region US --project-guid <project-guid> --model-guid <model-guid> --expected-title "<expected-title>" --category-name "Duct Accessories" --mask false --timeout-seconds 600
```

### Submit batch parameter collection

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation collect-parameters-batch --manifest <path> --json
```

### Inspect an existing workitem

```powershell
dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation workitem-status --workitem-id <workitem-id> --mask false
```

## Artifact Strategy

- The DA shell produces artifacts, not just stdout markers.
- Parameter collection writes one machine-readable JSON artifact per model.
- Artifact names should be deterministic and provenance-rich.
- Download happens through the APS signed object storage flow and lands under local automation artifact storage.
- Marker text still matters, but it is for diagnosis and classification, not the primary data contract.

## Build and Packaging

`./build pack` is now the shared packaging surface for both shells.

- desktop bundle output: `output/Pe.App.bundle.zip`
- automation appbundle output: `output/automation/Pe.Dev.RevitAutomation.Worker.<year>.appbundle.zip`

The automation packaging lane is still distinct from desktop packaging. Shared packaging surface does not mean identical artifact shape.

## Status and Scale

- One workitem per cloud model is the default batch strategy.
- Multi-model orchestration belongs in `Pe.Dev.RevitAutomation`, not in the worker.
- Status inspection should prefer the reduced-call APS status path for batches instead of naive tight-loop `GET workitems/{id}` polling.

## Known Good Proof Point

The current implementation has already proven:

- successful cloud-open probe against a real ACC model
- successful bounded parameter collection against `Duct Accessories`
- emitted artifact shape from the DA shell after removing UI-only dependencies from the collector path

## Architecture Review

### Strong parts

- CLI parse/printing stays in `Pe.Dev.Cli`
- APS orchestration stays in `Pe.Dev.RevitAutomation`
- in-engine behavior stays in `Pe.Dev.RevitAutomation.Worker`
- the worker is still thin even after becoming a general-purpose shell
- shared document collectors are now driving real DA output rather than a probe-only spike

### Shape debt worth watching

- Do not let CLI presentation flags leak too deeply into service-layer models as more workloads appear.
- The current shell supports multiple workloads, but a larger workload catalog may justify a cleaner job-definition registry.
- More DA-safe code likely needs to be peeled away from UI-era packages over time.
