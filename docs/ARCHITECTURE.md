# Pe.Tools Product Architecture

## Status

This is the repo-level orientation for how Pe.Tools product surfaces connect and how they should converge. It is intentionally target-oriented: it records the direction the repo is moving toward without pretending every package already has that final shape.

Use local package docs for implementation rules, `docs/features/` for feature intent, and `BUILD.md` for build, package, runtime, and Revit proof lanes.

## Product thesis

Pe.Tools should make Revit documents expose a compact, typed, inspectable, queryable, and eventually actionable data layer. That layer should be the common language used by Revit operators, Pea, host operations, scripts, UI, automation, tests, and feature packages.

The desired shape is:

- Revit-facing libraries own document meaning.
- Product shells own process/session/lifecycle concerns.
- Public operations, scripts, ribbon commands, CLIs, and future UI pages are adapters over shared libraries.
- Default document exposure stays shallow and bounded; deeper detail, joins, projections, and mutation are explicit.

## Surface map

| Surface                   | Current home                                                                                                                                                           | Current role                                                                                                                                                                                                             | Target posture                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Revit add-in      | `source/Pe.App/Application.cs`, `source/Pe.App/ButtonRegistry.cs`                                                                                                      | Starts inside desktop Revit, registers ribbon commands, logging, task service, document events, module registrations, and host bridge lifecycle.                                                                         | Thin desktop shell over shared Revit-side runtime and feature libraries.                                                                                                                                                            |
| Host runtime              | `source/pe-tools/apps/host/src/index.ts`, `source/pe-tools/apps/host/src/call-route.ts`                                                                                | TS-built `Pe.Host.exe` local HTTP host — `POST /call`, `GET /ops`, `GET /events` (SSE) — plus the private WebSocket Host/Revit bridge, TS-owned local services, lifecycle coordination, settings document IO, and APS auth.  | Public product operation surface over library authority; transport should not become semantic authority.                                                                                                                            |
| Host contracts            | `source/Pe.Shared.HostContracts/Operations/` (BridgeOp registry, ops, schema generator), `source/pe-tools/packages/host-contracts/`                                    | Self-registering C# `BridgeOp` catalog — request/response DTOs, JSON Schemas, examples, field-options bindings, and agent metadata — served live from `GET /ops`; the checked-in typegen lockfile plus hand-authored TS-only op schemas live in `@pe/host-contracts`. | Stable public contract layer for callers; the connected Revit session is the single source of truth for the Revit op surface, projected to a checked-in TS lockfile. Examples, field options, and metadata steer Pea/UI/CLI instead of prompt lore. |
| Private Host/Revit bridge | `source/Pe.Shared.HostContracts/Bridge/`, `source/Pe.Revit.Global/Services/Host/`                                                                                      | WebSocket bridge between host and the single connected Revit session; dispatches bridge operations, scripting, and document queries.                                                                                     | Private implementation detail. Do not expose bridge frames as public product API.                                                                                                                                                   |
| Document data language    | `source/Pe.Shared.RevitData/`                                                                                                                                          | Portable, Revit-assembly-free DTOs for handles, provenance, diagnostics, catalogs, context, schedules, families, sheets, and project index data.                                                                         | Deepest shared contract language for document state.                                                                                                                                                                                |
| Live document collectors  | `source/Pe.Revit.DocumentData/`                                                                                                                                        | Reads Revit API/session/document facts into `Pe.Shared.RevitData` contracts with budgets, handles, provenance, and diagnostics.                                                                                          | Deepest live-document collection authority; reusable from host operations, scripts, tests, and DA-safe shells where possible.                                                                                                       |
| Revit shared runtime      | `source/Pe.Revit.Global/`                                                                                                                                              | Internal shared Revit-side building blocks: document/session helpers, host runtime, bridge agent, document manager, reusable collectors.                                                                                 | Closest shared home for stable document-owned Revit behavior; keep session-owned behavior explicit.                                                                                                                                 |
| Settings and profiles     | `source/Pe.Shared.StorageRuntime/`, `source/Pe.Revit.SettingsRuntime/`, `source/pe-tools/apps/host/src/settings.ts`, feature registrations                             | C# storage roots/module identity/state/output live in StorageRuntime; Revit-authored schemas, field options, validation, and typed reads live in Revit.SettingsRuntime; TS host owns document open/save/validate/compose. | Shared authoring/runtime backbone for settings-driven workflows, LSP-assisted hand-authored profiles, and future UI/schema surfaces.                                                                                                |
| Scripting                 | `source/Pe.Shared.Scripting/`, `source/Pe.Revit.Scripting/`                                                                                                            | Source normalization, policy, compile/load/execute, workspace bootstrap, artifacts, and host-owned Revit transaction boundaries.                                                                                         | Primary Pea exploration and early mutation path; promote stable repeated shapes into feature apply contracts and host operations.                                                                                                   |
| Pea operator workbench    | `source/pe-tools/apps/pea/`                                                                                                                                                                                              | TypeScript/Node Revit/operator CLI and agent TUI. Bare `pea` launches the operator workbench in the source-linked dev lane; `pea --prompt` runs a headless turn.                                                        | Pea should choose among host operations, scripts, artifacts, and diagnostics; it should not encode repo-source, build, or RRD assumptions.                                                                                          |
| Agent workbench UI        | `source/pe-tools/packages/agent-contracts`, `source/pe-tools/packages/runtime/src/route-workspace.ts`, `source/pe-tools/packages/runtime/src/agent-controller-web.ts`, `source/pe-tools/apps/host/`, `source/pe-tools/apps/web/` | The host owns the Pea runtime, durable thread-scoped route workspaces, and HTTP surface. Its source dev entrypoint acquires Vite in the same Node process; the installed host serves the built SPA. | UI shells depend on shared contracts and runtime workbench projection, not Pea internals. Chat route state is thread-owned; standalone pages request workspace scope explicitly. |
| Dev and proof tooling     | SDK `pe-revit`, `source/pe-tools/package.json`, `source/Pe.Dev.Cli/`, `BUILD.md`                                                                                        | SDK `pe-revit` owns source linking, Revit proof lanes, and live-loop mechanics. Standard package scripts own TypeScript development. The interim `pe-dev` surface is automation-only; it does not orchestrate the host or web. `pea --prompt` is the headless black-box Pea probe. | Developer/operator tooling only; not a product semantic layer. |
| Automation shell          | `source/Pe.Dev.RevitAutomation.Worker/`, `source/Pe.Dev.RevitAutomation/`, `source/Pe.Aps/`                                                                            | APS Design Automation worker, appbundle/activity orchestration, browse/cache/manifests, workitem submission, artifact inspection.                                                                                        | Sibling headless shell over DA-safe libraries, not a copy of `Pe.App` startup.                                                                                                                                                      |

Current caveats matter. `Pe.App` still directly wires more feature and runtime detail than the target shell would. `HostRuntime` currently lives in `Pe.Revit.Global.Services.Host`, which supports the thin-shell direction but is still internal shared runtime, not a polished public semantic layer. Automation is currently audit/probe/operator-adapter heavy, not a full alternate product shell.

## Authority flow

The durable direction is library authority first, adapter surfaces second:

```text
Operators / Pea / future UI / CLI / tests
  -> ribbon commands, host operations, scripts, settings docs, artifacts
  -> Pe.Shared.* contracts and Pe.Revit.* / feature libraries
  -> Revit Document / UIApplication session / APS / filesystem / product layout
```

For the local host loop:

```text
TS Pe.Host public POST /call operation
  -> TS local service or private Host/Revit bridge
  -> Revit-side collector, script execution, or feature API
  -> shared DTO/artifact response
```

For desktop Revit:

```text
Pe.App startup
  -> Revit task service, ribbon, document/session events
  -> HostRuntime.Initialize(...) and bridge supervision
  -> shared Revit-side runtime and feature modules
```

For automation:

```text
Design Automation workitem
  -> automation shell entrypoint
  -> DA-safe document-owned collectors or workload handlers
  -> durable artifacts
```

Do not route automation through `Pe.App`; desktop and automation are sibling shells over shared DA-safe runtime pieces.

## Document data ladder

Use this ladder when deciding how deep a Revit document surface should be:

| Layer             | Purpose                                                                               | Default posture                                      |
| ----------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Context           | Orient to active document, active view, selection, browser location, visible summary. | Cheap default.                                       |
| Catalog           | Inventory nouns such as families, schedules, sheets, views, parameters, panels.       | Cheap/bounded default.                               |
| Detail            | Inspect one known handle, row, sheet anchor, element, or document object.             | Requires explicit target.                            |
| Relation / matrix | Join facts such as family/type/instance/parameter/schedule/sheet coverage.            | Requires explicit request, filters, and budgets.     |
| Projection        | Shape data for UI pages, CSV, artifacts, profile fragments, or reports.               | Target-shaped and provenance-aware.                  |
| Apply             | Write compatible authored or captured state back into Revit.                          | Explicit mutation, usually after script-first proof. |

`Context` and `Catalog` are the shallow defaults. Everything deeper should carry handles, filters, budgets, provenance, diagnostics, or an authored spec.

## Hand-authored profile authoring target

Hand-authored settings and feature profiles should remain pleasant to write in normal editors. JSON schemas, schema definitions, field options, examples, root bindings, generated workspace docs, and validation diagnostics should work together so developers get useful LSP autocomplete, hover/context, examples, and fast feedback while authoring profiles by hand.

This is a product architecture concern, not only an implementation detail. It crosses storage runtime, Revit settings runtime, feature profile contracts, schemas, examples, validation, Pea workflows, and future UI page generation. When changing settings/profile shapes, preserve or improve the editor-authoring experience unless there is a deliberate replacement path.

The schema-driven model lets a web editor and the host validate the same authored document against the same JSON Schema: the host validates server-side with NJsonSchema, and the web settings editor validates client-side with Ajv over the `schemaJson` returned by `settings.schema` (`source/pe-tools/apps/web/src/host/settings-ajv.ts`). Keeping one schema as the validation authority for both sides — rather than static types for user-authored documents — is the intended shape for authored settings; static TypeScript/zod types remain the model for the fixed operation surface.

The same field-options machinery now also annotates the fixed operation surface: a bridge-op request DTO can carry `[FieldOptions]` and XML-doc summaries, which the operation catalog exposes as `x-options` and `description` on the request JSON Schema. The `/ops` playground and agents then get the same option datalists and field hints they get for settings — all resolved live from the connected session's value domains, with no per-caller config. See `BUILD.md` for the mechanism.

## Code sharing target

- Neutral shared packages (`Pe.Shared.*`) define portable product contracts, identity, storage, scripting primitives, and host operation shapes.
- Revit-side packages (`Pe.Revit.*`) translate those contracts to and from Revit API behavior.
- `Pe.Revit.DocumentData` should be the main live-document collector layer; `Pe.Shared.RevitData` should be the portable document-data language.
- `Pe.Revit.Global` is the nearest shared home for stable document-owned helpers and session infrastructure, but it should not absorb feature-specific policy prematurely.
- Feature packages such as Family Foundry should expose script-friendly library APIs where that makes Pea, host operations, and tests better.
- Host operations wrap stable, repeated product capabilities. Scripts remain the escape hatch for exploration, one-off joins, and early mutation shapes.
- Future frontend pages should render projections over host operations, schemas, document data, and artifacts; schema metadata should not replace document data contracts.

## Decision rules

1. **Libraries own semantics.** Host operations, Pea, scripts, ribbon commands, CLIs, and UI pages are adapters unless they are explicitly defining a contract.
2. **Public host API means operation contracts.** The self-registering `BridgeOp` catalog (served from `GET /ops`, called over `POST /call`), request/response DTOs, operation metadata, and blessed client methods are public-facing. Bridge frames are private.
3. **Keep document-owned and session-owned behavior separate.** If behavior only needs `Document` / `FamilyDocument`, prefer document-centric helpers and DA-safe collectors. If it needs active/open UI state, keep it near `UIApplication`, `DocumentManager`, or session services.
4. **Do not collapse proof lanes.** Build/runtime/proof claims belong to `BUILD.md`; source compile, package artifacts, AttachedRrd, FreshRevitProcess, and installed behavior are different authorities.
5. **Make mutation script-first.** Let Pea and developers prove awkward Revit mutation through guarded scripts and artifacts before freezing a host operation or generic apply API.
6. **Keep Pea out of repo-source posture.** Pea is the deployed operator workbench. SDK `pe-revit` and repo docs own source, build, RRD, and architecture workflows.
7. **Keep web/TUI/protocol shells thin.** Workbench shells should project shared runtime state and contracts. Do not reimplement transcript, tool calls, approvals, thread lists, model/mode/access, inspector, memory, or world/context lifecycle independently per surface.
8. **Keep hand-authored profiles editor-friendly.** Settings/profile schema changes should preserve useful LSP autocomplete, examples, and validation feedback for developers authoring JSON by hand.
9. **Prefer bounded projections over bespoke audit sprawl.** Add compact joins, page models, budgets, and diagnostics before creating one-off domain endpoints.

## Non-goals

This document is not:

- a build/runbook replacement for `BUILD.md`,
- a NuGet/public support matrix for every package,
- an exhaustive taxonomy of every entrypoint and process,
- a frontend generation design,
- or package-local implementation guidance.

When this document and a package-local `AGENTS.md` disagree about implementation detail, prefer the package-local doc and update this document only if the product boundary changed.
