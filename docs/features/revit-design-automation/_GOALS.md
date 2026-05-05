# Revit Design Automation

## North Star

Provide a fast, audit-oriented `pe-dev revit automation ...` workflow for scraping schedules from ACC-hosted Revit models without forcing operators to carry GUIDs, years, or long-running polling sessions.

## User Goals

- Log in once and reuse auth across CLI processes.
- Browse ACC hubs, projects, folders, and models with sticky context instead of repeated id copy-paste.
- Build readable manifests from project names and canonical model paths.
- Submit schedule runs quickly and get a receipt immediately.
- Re-open that receipt later to inspect status and download artifacts.

## Developer Goals

- Keep CLI parse/print in `Pe.Dev.Cli` and orchestration in `Pe.Dev.RevitAutomation`.
- Keep persistent auth and repo-local cache lightweight, best effort, and safe to delete.
- Keep the public DA surface schedule-focused for the current audit instead of optimizing for future generalized workloads.
- Keep the automation worker thin and DA-safe.

## Integration Goals

- Reuse existing APS auth, Design Automation API, and worker packaging seams.
- Resolve human-readable manifest entries to GUIDs and year metadata late, from cache or live APS data.
- Preserve one-workitem-per-model as the execution unit.

## Non-Goals

- no full-screen TUI
- no public parameter-collection operator workflow in this pass
- no long-running submit command that polls APS to completion
- no requirement for users to author GUID-heavy manifests by hand
- no attempt to expose this DA lane to deployed `Pe.App` users yet
