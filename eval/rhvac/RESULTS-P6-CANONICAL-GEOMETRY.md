# P6 canonical geometry results

## Outcome

The `/rhvac` route now parses canonical TSV polygons vertex-for-vertex. The web-only raster
simplifier and its tests are deleted. Rooms marked only `unregularized` render as raw evidence
with a solid muted hairline, 6% muted fill, and a `raw shape — straighten in Revit` legend chip.
Decision-flagged, rejected, residue, and `ruled-seam` styling and queue behavior are unchanged.

## Gates

| Gate | Result |
|---|---|
| Web `pnpm exec vp test` | 16 files, 87 tests passed |
| Host `pnpm exec vp test` | 8 files, 46 tests passed |
| Production `simplify` census | No hits under `apps/web/src/rhvac` or `apps/web/src/host` |
| project-a fixture path | Existing fixture/parser coverage passed in the web suite |
| Changed TS files | Targeted format, lint, and type checks passed |
| Scope | Product changes are confined to `source/pe-tools/apps/web`; this mandated results receipt is the only mission file outside it |

## LOC delta

Product code and tests: **31 added, 259 deleted, net -228 lines**.

| File | Added | Deleted |
|---|---:|---:|
| `src/rhvac/plan-pane.tsx` | 15 | 7 |
| `src/rhvac/takeoff.test.ts` | 9 | 66 |
| `src/rhvac/takeoff.ts` | 7 | 186 |

The pre-existing untracked `eval/rhvac/BRIEF-P8-MATERIALIZE-EVERYTHING.md` was not modified or
staged.
