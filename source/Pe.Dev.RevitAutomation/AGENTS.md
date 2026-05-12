# Pe.Dev.RevitAutomation

## Scope

Owns local/operator workflows used by `pe-dev automation ...`: manifests, receipts, browse cache, repo-local paths, worker bundle building from local source, and CLI-facing orchestration. APS auth, Data Management, Object Storage, and Design Automation mechanics live in `Pe.Aps`.

## Purpose

`Pe.Dev.RevitAutomation` is the dev adapter around Revit automation workflows. Keep operator UX here and push reusable APS mechanics into `Pe.Aps`. Keep `Pe.Dev.Cli` focused on command parsing and stdout/stderr behavior, and keep the worker package focused on the headless Revit execution entrypoint.

## Critical Entry Points

- `AutomationBrowseService.cs` - sticky browse context, repo cache, and human-readable model navigation.
- `AutomationManifestService.cs` - readable schedule manifest create/update/validate flow.
- `AutomationScheduleRunServices.cs` - schedule submit-now / inspect-later orchestration and receipt handling.
- `RevitAutomationModelDiscoveryService.cs` - thin adapter from operator discovery options to `Pe.Aps.DataManagement.ApsCloudModelCatalog`.
- `AutomationShellDeploymentService.cs` - local worker bundle build plus shell-specific appbundle/activity definitions; delegates DA deployment mechanics to `Pe.Aps.DesignAutomation`.
- `RevitAutomationWorkerBundleBuilder.cs` - local worker build plus Autodesk appbundle assembly. This decides the `.bundle` root, `PackageContents.xml`, `.addin`, and zip shape.
- `RevitAutomationShellDefinitions.cs` - Revit automation shell appbundle/activity identity and parameter definitions.
- `AutomationArtifactFinalizer.cs` - dev/domain adapter that maps generic `Pe.Aps.DesignAutomation` artifact finalization plus raw DA reports into Revit automation result classifications.
- `../Pe.Aps/DesignAutomation/` - generic DA appbundle/activity/workitem/status/artifact mechanics.
- `../Pe.Aps/DataManagement/` - APS cloud model catalog, folder traversal, region normalization, version selection, and source download.
- `../Pe.Aps/Core/ObjectStorageApiClient.cs` - APS object storage and signed download/upload handling for staged inputs and result artifacts.
- `../Pe.Aps/Auth/ApsCredentialSource.cs` - APS credential loading from `Global/settings.json`.
- `../Pe.Dev.RevitAutomation.Worker/RevitAutomationShellApp.cs` - in-engine DA shell entrypoint.

## Validation

Cheap compile loop:

- `dotnet build source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -c Debug.R25 /p:WarningLevel=0`
- `dotnet build source/Pe.Dev.RevitAutomation.Worker/Pe.Dev.RevitAutomation.Worker.csproj -c Release.R25 /p:WarningLevel=0`

Primary operator commands:

- `pe-dev automation auth login`
- `pe-dev automation browse hubs`
- `pe-dev automation browse models --recurse true --out <path>`
- `pe-dev automation manifest validate --path <path>`
- `pe-dev automation submit schedules --manifest <path> [--receipt <path>] [--json]`
- `pe-dev automation inspect receipt --receipt latest [--download-artifacts true] [--json]`
- `pe-dev automation inspect workitem --workitem-id <id> [--include-report <true|false>] [--json]`

Focused test coverage currently lives in:

- `source/Pe.Revit.Tests/ParameterCollectionArtifactCollectorTests.cs`
- `source/Pe.Revit.Tests/RevitAutomationContractsTests.cs`
- `source/Pe.Revit.Tests/AutomationProbeCliTests.cs`
- `source/Pe.Revit.Tests/AutomationProbeSettingsTests.cs`

When validating the current DA lane, prefer a tiny schedule manifest first so submit/inspect flow, bundle readiness, and artifact download can be checked without waiting on a full scrape.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **management token** | 2-legged APS token used for Design Automation REST CRUD and alias/version management | Avoid calling this the cloud-open token |
| **user-context token** | 3-legged delegated token passed to the workitem as `adsk3LeggedToken` | Avoid implying the worker does its own OAuth flow |
| **automation shell** | The headless `IExternalDBApplication` entrypoint that DA loads | Prefer this over calling the worker a probe app |
| **job input** | The common DA payload envelope rooted in `AutomationJobInput` | Prefer this over ad hoc probe-only payloads |
| **artifact** | A durable output file produced by a workitem, usually JSON | Prefer this over treating stdout as the primary result contract |
| **status lane** | Read-only workitem inspection and status aggregation | Prefer this over resubmitting work just to inspect it |
| **operator adapter** | Local UX layer around APS/Revit automation mechanics: manifests, receipts, cache, repo paths, and CLI logging | Avoid putting reusable APS mechanics here |

## Living Memory

- The current public DA surface is intentionally audit-focused: auth, browse, manifest, submit, inspect, cache.
- Human-readable `(hub, project, modelPath)` identity is the operator input. Resolve GUIDs and year metadata late from cache/live APS data instead of forcing users to carry them around.
- Persistent auth and repo-local cache are UX features, not hard state. They must be safe to delete and safe to recover from corruption.
- The appbundle zip must include the `*.bundle` directory itself at zip root. If the raw report says `Could not find *.bundle in AppBundle`, suspect local worker packaging before APS mechanics.
- The worker must stay headless. Do not let `UIApplication`, WPF, ribbon helpers, or interactive session services leak into collector paths that DA uses.
- APS credentials and persisted auth come from `Pe.Aps`. OneDrive-vs-Documents drift in `Global/settings.json` is still a real failure mode.
- Full root-cause detail usually lives in the raw `reportUrl`, not just the parsed summary.
- Revit/domain artifact result shapes stay out of `Pe.Aps`; keep `ParameterCollectionArtifact` and `ScheduleCollectionArtifact` in shared Revit data contracts.
- Result artifacts download through the APS signed S3 flow. Do not assume legacy direct object fetch URLs will stay valid.
- The public schedule submit path should return quickly. Long-lived polling belongs in explicit inspect commands, not the primary submit command.
- Activity `settings` must stay current with APS behavior. Do not reintroduce reserved keys such as `dasOpenNetwork`.
