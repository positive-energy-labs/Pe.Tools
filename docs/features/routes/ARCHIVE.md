# Archived web routes

Ruling: kaitpw, 2026-11-03. Recover the pre-deletion tree from tag `archive/routes-20261103` (`250fddfa`).
Paths below are relative to `ts/apps/web/src/`; all C# operations and `dotnet/` remain unchanged.

| Route | Archived folders | C# operations retained |
| --- | --- | --- |
| space | `space/` | `revit.detail.space-{scene,status,rows,tree,slice,probe,sweep}` |
| parameter-links | `parameter-links/` | `revit.detail.parameter-links`, `revit.apply.parameter-links`, `revit.catalog.field-options` |
| data-tables | `data-tables/` | `revit.detail.data-tables`, schedule operations |
| grilles | `grilles/` | None called (local calculation) |
| rhvac-sync | `rhvac-sync/` | All takeoff/RHVAC operations |
| zone-audit | `zone-audit/` | All takeoff/zone operations |
| instances | None at this revision; stale Pea projection only | All family-instance operations |
| schedule-specs | None at this revision; stale Pea projection/address only | All schedule operations |
| pod-admin | `pod-admin/` | None called (TS host Pod administration) |

No corresponding `src/route/<route>/` folders exist at this revision.
Generated Pea projections and route registrations for these routes are removed with the folders.
Shared host actions and referenced address contracts remain. No shared code is moved to permit deletion.

## Not archived: import boundaries

- `takeoff` / `takeoffs`: `rooms/plan.tsx` imports `takeoff/level-plan`, `takeoff/model`, and `takeoff/plan`; the `/takeoffs` route lives in `takeoff/`.
- `session-admin`: `sessions/route.tsx` imports `sessions/graph.ts`, whose key and path are `session-admin`; `sessions` must remain.

Kept: `duct-loss/`, `pages-bind/` (`/bind`), `scene/`, `ts/packages/ducts-domain`, and `dotnet/Pe.Revit.Space`.
