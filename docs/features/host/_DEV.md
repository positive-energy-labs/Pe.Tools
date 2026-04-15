# Settings Editor Host Contract

This document describes the browser-facing and tool-facing host contract exposed by this repo.

## Mental Model

- HTTP owns request/response workflows.
- `/api/settings/events` stays invalidation-only for settings/document status.
- Revit-backed data flows through the named-pipe bridge.
- Revit scripting is also public through host HTTP, but scripting is sync-only in v1 and does not use SSE.

## Public Transport

- Host base URL: `http://localhost:5180`
- JSON payload shape: camelCase DTOs
- Settings SSE: `GET /api/settings/events`
- Scripting endpoints:
  - `POST /api/scripting/workspace/bootstrap`
  - `POST /api/scripting/execute`

## Scripting V1

- host scripting requires exactly one connected Revit bridge session
- the scripting endpoints are synchronous request/response only
- responses contain final buffered output plus structured diagnostics
- no scripting event stream exists
- no async start/poll/cancel contract exists
- host currently proxies scripting requests to the internal `Pe.Scripting.Revit` named pipe

## Current HTTP Areas

- settings/status/schema/storage:
  - `GET /api/settings/host-status`
  - `GET /api/settings/schema`
  - `GET /api/settings/workspaces`
  - `GET /api/settings/tree`
  - `POST /api/settings/document/open`
  - `POST /api/settings/document/validate`
  - `POST /api/settings/document/save`
- bridge-backed settings/revit data:
  - `POST /api/settings/field-options`
  - `POST /api/settings/parameter-catalog`
  - `POST /api/revit-data/element-context/query`
  - `GET /api/revit-data/loaded-families/filter/schema`
  - `POST /api/revit-data/loaded-families/filter/field-options`
  - `POST /api/revit-data/schedules/catalog`
  - `POST /api/revit-data/loaded-families/catalog`
  - `POST /api/revit-data/loaded-families/matrix`
  - `POST /api/revit-data/project-parameter-bindings`
  - `POST /api/revit-data/electrical/panels/catalog`
  - `POST /api/revit-data/electrical/circuits/catalog`
  - `POST /api/revit-data/electrical/panel-schedules/query`
  - `POST /api/revit-data/electrical/load-classifications/catalog`
- scripting:
  - `POST /api/scripting/workspace/bootstrap`
  - `POST /api/scripting/execute`

## Element Context Query

- `POST /api/revit-data/element-context/query` is the general multi-target inspection surface.
- The first supported query kinds are `CurrentSelection` and `ElementReferences`.
- It should stay generic at the route level and attach richer discipline context only when that context is stable enough to trust.

## Electrical Panel Schedules

- `POST /api/revit-data/electrical/panel-schedules/query` is the read-only panel schedule instance projection surface.
- It is intentionally instance-focused rather than template-focused.
- The route should preserve `Header`, `Body`, `Summary`, and `Footer` honestly, including blank cells and best-effort source metadata where Revit exposes it.

## Failure Posture

- expected user-actionable scripting failures return `409 Conflict`
- this includes:
  - no connected Revit session
  - more than one connected Revit session
  - scripting pipe unavailable or timed out
  - Revit rejected the scripting request
  - pipe returned success without the expected payload
- unexpected host/runtime faults return `500`
