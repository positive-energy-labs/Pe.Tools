# Revit Design Automation

## North Star

Provide a dev-facing `pe-dev revit automation ...` command family that can package a headless Revit automation shell, run that shell in Autodesk Design Automation, and execute real document workloads against cloud models without inventing a second APS subsystem.

Build the core of DA orchestration such that jobs can be easily spun off from `Pe.App`.  The use-case of these jobs mostly applies to `Pe.Revit.FamilyFoundry` and `Pe.Revit.Global.Revit` where it enable *truly portable* Revit objects. We could for example specify a cloud model: run an FFMigrator queue, run FFManager to generate a family from scratch and load it in, or serialize a schedule and download into the locally open model, diff a family snapshot in one model to another. Features like this would greatly advance the ergonomics/UX dimension of "portability".


## User Goals

- Prove that a known ACC/BIM 360 cloud model can be opened in Design Automation from `region + projectGuid + modelGuid`.
- Run parameter collection against one cloud model and emit a durable JSON artifact.
- Submit the same collection workload across many cloud models as one workitem per model.
- Re-check a submitted workitem later from its id without rerunning the job.

## Developer Goals

- Keep `Pe.App` as the desktop shell and keep the DA shell separate.
- Reuse the existing `Pe.Revit.Global.Services.Aps` auth entrypoint instead of forking a second automation-only auth stack.
- Reuse DA-safe runtime packages and document-owned collectors beneath both shells.
- Keep the automation worker thin enough that engine failures are attributable to package/load/runtime issues rather than hidden app logic.
- Keep CLI parsing and terminal output in `Pe.Dev.Cli`, orchestration in `Pe.Dev.RevitAutomation`, and in-engine behavior in `Pe.Dev.RevitAutomation.Worker`.
- Use `./build` as the shared packaging surface for both desktop and automation artifacts.

## Integration Goals

- Future DA jobs should be able to reuse:
  - `ApsTokenRequest` scope and flow profiles
  - `AutomationApiClient`
  - the worker appbundle packaging lane
  - the shared shell/job input contract
  - the report and artifact download path
- The current parameter-collection workload should prove that existing `Document` collectors can be reused against cloud-hosted models.
- `pe-dev` should be the single operator surface for desktop iteration and automation work, not just a dev helper.

## Non-Goals

- no ACC project browsing or folder traversal
- no save-back or publish workflow
- no attempt to run the current desktop `Pe.App` startup path inside DA
- no UI-dependent collector logic in the DA shell
- no downstream wrangling or analytics pipeline in the DA worker
- no generic scheduler abstraction beyond what the current workloads need
