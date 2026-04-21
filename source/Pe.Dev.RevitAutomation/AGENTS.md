# Pe.Dev.RevitAutomation

## Scope

Owns dev-side Revit Design Automation orchestration, APS auth/bootstrap helpers, appbundle packaging, workitem submission and status, artifact download, and local iteration services used by `pe-dev revit automation ...`.

## Purpose

`Pe.Dev.RevitAutomation` is the local orchestration package for fragile APS and Revit Design Automation work. Keep APS CRUD, token policy, bundle packaging, workitem submission, status polling, batch status, and report/artifact handling here. Keep `Pe.Dev.Cli` focused on command parsing and stdout/stderr behavior, and keep the worker package thin enough that DA failures are easy to localize.

## Critical Entry Points

- `RevitAutomationProbeService.cs` - diagnostic cloud-open orchestration.
- `RevitAutomationParameterCollectionService.cs` - single-model parameter collection orchestration.
- `RevitAutomationParameterCollectionBatchService.cs` - manifest-driven multi-model submission and status aggregation.
- `RevitAutomationWorkerBundleBuilder.cs` - worker build plus Autodesk appbundle assembly. This decides the `.bundle` root, `PackageContents.xml`, `.addin`, and zip shape.
- `RevitAutomationShellDefinitions.cs` - activity and appbundle definitions for the DA shell.
- `RevitAutomationWorkItemInspectorService.cs` - read-only workitem status/report inspection.
- `AutomationObjectStorageClient.cs` - APS object storage and signed download handling for result artifacts.
- `StoredApsWebAuthTokenProvider.cs` and `GlobalSettingsFileReader.cs` - APS credential loading from `Global/settings.json`.
- `../Pe.Dev.RevitAutomation.Worker/RevitAutomationShellApp.cs` - in-engine DA shell entrypoint.
- `../Pe.Revit.Global/Services/Aps/Core/AutomationApiClient.cs` - thin APS Design Automation REST client shared by this package.

## Validation

Cheap compile loop:

- `dotnet build source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -c Debug.R25 /p:WarningLevel=0`
- `dotnet build source/Pe.Dev.RevitAutomation.Worker/Pe.Dev.RevitAutomation.Worker.csproj -c Release.R25 /p:WarningLevel=0`

Primary operator commands:

- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation probe-access --region <US|EMEA> --project-guid <guid> --model-guid <guid> [--expected-title <title>] --mask false --timeout-seconds 600`
- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation collect-parameters --region <US|EMEA> --project-guid <guid> --model-guid <guid> [--category-name <name>]... [--family-name <name>]... [--placement-scope <AllLoaded|PlacedOnly|UnplacedOnly>] --mask false`
- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation collect-parameters-batch --manifest <path> [--json]`
- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation workitem-status --workitem-id <id> --mask false`

Focused test coverage currently lives in:

- `source/Pe.Revit.Tests/ParameterCollectionArtifactCollectorTests.cs`
- `source/Pe.Revit.Tests/RevitAutomationContractsTests.cs`
- `source/Pe.Revit.Tests/AutomationProbeCliTests.cs`
- `source/Pe.Revit.Tests/AutomationProbeSettingsTests.cs`

When validating live parameter collection, prefer a narrow category such as `Duct Accessories` before broadening to multi-minute family matrices.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **management token** | 2-legged APS token used for Design Automation REST CRUD and alias/version management | Avoid calling this the cloud-open token |
| **user-context token** | 3-legged delegated token passed to the workitem as `adsk3LeggedToken` | Avoid implying the worker does its own OAuth flow |
| **automation shell** | The headless `IExternalDBApplication` entrypoint that DA loads | Prefer this over calling the worker a probe app |
| **job input** | The common DA payload envelope rooted in `AutomationJobInput` | Prefer this over ad hoc probe-only payloads |
| **artifact** | A durable output file produced by a workitem, usually JSON | Prefer this over treating stdout as the primary result contract |
| **status lane** | Read-only workitem inspection and status aggregation | Prefer this over resubmitting work just to inspect it |

## Living Memory

- The DA shell is now a general-purpose worker host. `probe-access` is a diagnostic workload, not the core abstraction.
- `collect-parameters` is the first production workload. Keep new workloads behind the same shell/job contract instead of forking new workers casually.
- The appbundle zip must include the `*.bundle` directory itself at zip root. If the raw report says `Could not find *.bundle in AppBundle`, suspect packaging before anything else.
- The worker must stay headless. Do not let `UIApplication`, WPF, ribbon helpers, or interactive session services leak into collector paths that DA uses.
- APS credentials come from `Global/settings.json` via the shared settings-root resolver. OneDrive-vs-Documents drift is still a real failure mode.
- Full root-cause detail usually lives in the raw `reportUrl`, not just the parsed summary.
- Result artifacts download through the APS signed S3 flow. Do not assume legacy direct object fetch URLs will stay valid.
- Batch status should use the reduced-call APS status path, not naive per-workitem `GET workitems/{id}` polling at scale.
- Activity `settings` must stay current with APS behavior. Do not reintroduce reserved keys such as `dasOpenNetwork`.
