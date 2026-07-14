# Repo Backlog Capture

Temporary capture of stale root TODO notes that should be promoted to package docs, feature goals, or deleted once triaged.

## Schema / settings follow-up

- Revisit general JSON IntelliSense. Through refactors, some providers may no longer be wired into local schema writes; the issue may extend to schema generation generally.
- Revisit commit `3e3fa88543b9b5435ea87d89efa88bafc2aa1031`:
  - shared schedule profile usage appears to break JSON IntelliSense and has nullable/type issues
  - `SchedulePreviePanel` crash around `("Order", sg => sg.SortOrder.ToString())`

## Pea follow-ups

Completed items from the old root TODO are omitted; current open follow-ups:

- Reevaluate a readonly/oracle posture only after real use proves the UX/context cost is worth it.
- Pursue small public/upstreamable MastraCode TUI policy seams before considering any Pea TUI fork.
- Adapt future Positive Energy auth into MastraCode-compatible env/settings/auth-storage paths before replacing model/auth resolution.
- Reenable/use MastraCode hooks under `.pea` before inventing a Pea hook manager.
- Add more Pea processors for Revit/operator safety, JSON profile validation feedback, or host-operation steering only after the OpenAI Responses processor is proven.
- Keep MCP disabled by default until a concrete Pea runtime use case is not covered by public host operations/tools.
- Add liteparse, markitdown, or LlamaParse support if spec-sheet parsing becomes necessary for Family Foundry profile authoring.
- Add parameter service cache / `parameters.txt` path to host status or a focused host operation if agents keep needing it.
- Defer separate browser resolver, browser field-options endpoint, browser-specific UI activation, and browser filters on unrelated operations until usage proves them.
- Evaluate dedicated `revit.catalog.views` and `revit.catalog.sheets` only after project-browser/project-index/schedule provenance patterns settle.
- Promote repeated `host_operation_call` patterns into convenience tools only after usage proves they earn context.
- Give pea a path to SDK session-journal events (investigated 2026-07-13; SDK owns journal meaning, pea stays a thin adapter): add `action=logs` to `pe_sandbox` proxying `pe-revit sandbox logs --id X --tail N --json` (~15-25 lines in sandbox-route.ts + ~20-30 in the tool); pass the `firstFailureEvent` field through `presentSandboxEnvelope` instead of dropping it (~5 lines); fix the two `pe_status` hints that point at `pe_logs` for disconnect/session causes — those live in events.jsonl, which `pe_logs` (product Serilog only, correctly) never reads. Do NOT grow a TS journal reader in Pe.Tools and do NOT merge the two log worlds into one tool — two owners, two formats, one capability one path.

## Desired-state Family Foundry direction

`mastracode: pe-tools-ae8e96592dd3` / ffmigrator needs a better mutation model. Settings are currently organized by operation; the desired direction is closer to declarative desired-state authoring compiled into an explicit migration/reconciliation plan.

Known shortfalls in the current ffmigrator model:

- provenance of properties group is loose
- datatype provenance is loose
- parameter end state depends on variables spread across multiple models

Intent:

- optimize for both maximally declarative and minimally verbose authoring
- provide good defaults throughout
- make metadata provenance clear, including defaults from the parameter service
- likely keep the current imperative model mostly intact as the compiled execution layer

## Broad future directions

- Strong AI entrypoints into Revit.
- Portable Revit entities such as families and schedules that can move across documents/versions with a merge story.
- Stable multitenant `Pe.Host` acting as arbiter between `revit.exe`, local files, a local server/sandbox environment, and frontend/AI.

## Family Foundry loose items

- Flesh out lookup tables.
- Add clearance box generation.
- Codify an AI workflow for creating the files.

## Misc loose items

- Get dual-purpose perf/proof benchmarks working with a good entry point.
- Move PowerShell scripts into a shared folder such as `tools/`, or replace them with C# scripts where appropriate.
- Check up on rdbe.
- Standardize FF language around collect, capture, spec, project, snapshot, etc.
- Make the `pe.ui` palette wider and more Raycast-like; consider preview-panel changes to reduce lag.
- Reconsider palette item-type delineation for master family, family type, family instance, view, schedule, and sheet.
- Pull polyfill/BCL support into a shared package and find a better global application model.
