# Root workspace browser proof — 2026-09-16

## Scope and custody

- Classification: **browser evidence** (not source-only analysis).
- Browser: existing `pe.tools-unify-runtime-01` CDP `9222`; proof used only owned target `6DD36FB304CFB2E1F938130A2E771608`.
- Receipt: port `5176` resolves to `C:\Users\kaitp\source\repos\Pe.Tools\source\pe-tools` (`dev` lane). No server or Revit session was launched.
- Existing spike target `EA084DCCBDF2D57642CF9AACF247CB8D` at `5175` remained present and untouched.
- Method: native WebSocket CDP, DOM rectangles/roles, console and network events, and PNG captures. Normal was `1280x900`; narrow was `720x900` on the owned tab only. This is geometry evidence, not a performance measurement.

## Result

| Claim | Result | Evidence |
| --- | --- | --- |
| 24px rails | **PROVEN** | Every inspected route rail/pane-title rail measured `h=24`: e.g. Takeoffs global, Zones, Plan, and Rooms rails; Family Anatomy, Doc, and Parameters rails; Settings files rail. |
| Shared content gutter | **PROVEN** | Workspace panes begin at x=8 and end 8px from the right edge on Takeoffs, Families, Family, Runs, and Settings. Schedule has x=8 with its right scroll-bar reservation. |
| Pane overlap | **PROVEN** | Pairwise pane-rectangle intersections were zero on all six routes at both widths. |
| One table title rail | **PROVEN** for mounted table workspaces | Takeoffs has one `ROOMS IN SCOPE` 24px rail directly before its grid/filter row; Families has one `FAMILIES IN SCOPE` rail before its grid; Family has one `PARAMETERS` rail before its grid. These table panes have no duplicate `pane-header`. |
| Fixed and resizable split behavior | **PROVEN** | On Takeoffs, Zones remains a fixed 288px pane with no separator at its right edge. The horizontal `Resize pane` separator accepted a trusted ArrowDown: `aria-valuenow` `354 -> 370`, and moved `y=461.4 -> 477.4`. |
| Full-height parent containment | **FALSIFIED** | A `Surface` fills 900px even when it begins below route chrome: Takeoffs/Families/Family `y=99.4,h=900`; Runs `y=130.8,h=863.2`; Schedule `y=12,h=900`. Each extends below the 900px viewport. At narrow widths, Takeoffs/Families/Family begin at `y=147.8,h=900`, and Runs at `y=160.8,h=863.2`. Settings alone is `y=0,h=900`. |
| Console/network health | **PROVEN** for this capture | All 12 captures recorded zero `Runtime.exceptionThrown`, `Network.loadingFailed`, and console `error` events. |

## Root-cause finding for containment

The new parent-sized `Surface` behavior is visible, but the parent chain is not uniformly the reserved viewport region. Route chrome consumes vertical flow before several surfaces, while the surface remains viewport-height. The result is additive height, not the remaining height.

Composition is inconsistent at the source boundary: `routes/settings.tsx:132-135` nests `RouteShell` inside `Surface`, while `routes/runs.tsx:17-19` wraps `RunsPage` in `RouteShell`; Takeoffs, Families, and Family exhibit the latter rendered ordering (route chrome before the surface). Root should make the Outlet/route-shell/workspace ownership a single bounded flex/min-height chain rather than restore any consumer-level viewport positioning.

## Route captures

| Route | Exact URL | Normal screenshot | Narrow screenshot |
| --- | --- | --- | --- |
| Takeoffs | `http://127.0.0.1:5176/takeoffs?demo=sync` | `.artifacts/runs/root-browser-20260916/takeoffs-normal.png` | `.artifacts/runs/root-browser-20260916/takeoffs-narrow.png` |
| Families | `http://127.0.0.1:5176/families?demo=apply` | `.artifacts/runs/root-browser-20260916/families-normal.png` | `.artifacts/runs/root-browser-20260916/families-narrow.png` |
| Family | `http://127.0.0.1:5176/family?demo=capture` | `.artifacts/runs/root-browser-20260916/family-normal.png` | `.artifacts/runs/root-browser-20260916/family-narrow.png` |
| Runs | `http://127.0.0.1:5176/runs` | `.artifacts/runs/root-browser-20260916/runs-normal.png` | `.artifacts/runs/root-browser-20260916/runs-narrow.png` |
| Settings | `http://127.0.0.1:5176/settings?demo=save` | `.artifacts/runs/root-browser-20260916/settings-normal.png` | `.artifacts/runs/root-browser-20260916/settings-narrow.png` |
| Schedule | `http://127.0.0.1:5176/schedule-grid` | `.artifacts/runs/root-browser-20260916/schedule-normal.png` | `.artifacts/runs/root-browser-20260916/schedule-narrow.png` |

Each PNG has a same-named JSON companion containing the DOM rectangle and console-event capture. No source files were changed.
