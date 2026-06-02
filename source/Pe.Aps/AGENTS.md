# Pe.Aps

## Scope

Owns APS-facing mechanics for Pe.Tools: auth, Data Management, Object Storage, and Design Automation REST/workitem plumbing. Keep local operator UX, manifests, receipts, repo paths, and Revit artifact DTOs out of this package.

## Purpose

`Pe.Aps` is the reusable APS adapter boundary. It hides Autodesk SDK/REST quirks behind small services that can be used by the CLI, host, and Revit automation workflows without duplicating token, OSS, Data Management, or DA behavior.

## Critical Entry Points

- `Aps.cs` - top-level APS factory for auth-backed Object Storage, Data Management, cloud-model catalog, and Design Automation services.
- `Auth/ApsCredentialSource.cs` - loads APS web credentials from global settings.
- `Auth/ApsAuthService.cs` - CLI/host-friendly login/logout/token façade.
- `Core/ApsAuthenticationService.cs` - OAuth, persisted token store, and token acquisition.
- `Core/DataManagementApiClient.cs` - low-level Data Management SDK parsing and source-download support.
- `Core/ObjectStorageApiClient.cs` - OSS bucket, signed upload/download, and object URN helpers.
- `Core/AutomationApiClient.cs` - thin APS Design Automation REST client.
- `DataManagement/ApsCloudModelCatalog.cs` - cloud model browse/discovery boundary over hubs/projects/folders/items/versions.
- `DesignAutomation/DesignAutomationService.cs` - generic DA deployment, workitem, status, batch, report, and artifact finalization boundary.

## Validation

Use a tiny DA manifest before broad APS validation. Data Management and OSS failures can be slow and account-specific, so first prove credentials and catalog browse before submit/download work.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **APS mechanics** | Reusable auth, Data Management, Object Storage, and Design Automation API behavior | Keep here, not in `Pe.Dev.RevitAutomation` |
| **cloud model catalog** | APS hub/project/folder/item/version discovery and resolution | Avoid mixing this with local browse cache or manifest formatting |
| **Design Automation service** | Generic DA appbundle/activity/workitem/status/artifact operations | Avoid referencing Revit artifact DTOs here |
| **artifact finalization** | Generic report fetch, OSS download, and JSON deserialize flow | Keep result interpretation in caller/domain packages |

## Living Memory

- `Pe.Aps` may know APS appbundles, activities, workitems, OSS buckets/objects, signed URLs, hubs, projects, folders, items, and versions.
- `Pe.Aps` must not know `ParameterCollectionArtifact`, `ScheduleCollectionArtifact`, manifest formats, receipt formats, repo roots, CLI logging conventions, or local RRD/session behavior.
- Revit/domain request-result contracts live in shared Revit data/contracts packages, not here.
- Keep SDK-specific model quirks near `Core/*ApiClient.cs`; expose slim records or service results to callers.
- Data Management region normalization maps `EU` to `EMEA`; missing hub region should stay a caller-visible failure unless explicitly overridden.
- Object Storage signed upload/download flow is the durable path. Do not reintroduce direct object fetch assumptions.
