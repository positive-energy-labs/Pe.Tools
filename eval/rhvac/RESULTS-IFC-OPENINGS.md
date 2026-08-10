# IFC opening-metadata probe — NO typed openings survive this import

Run date: 2026-08-06  
Proof lane: **Installed lane**, `Pe.App` 0.6.23 in agent-owned Revit 2025 sandbox `pe.app-25`  
Model: `MEP_ArchitectA_ProjectA_R25_detached`  
Source: `C:\Users\kaitp\OneDrive\Documents\MEP_ArchitectA_ProjectA_R25.rvt`, 280,567,808 bytes, SHA-256 `94CF7ACA1D75DADC125742402E9600F423522C8FF9BFE62D7C3C1B80C8C0CD77`  
IFC link: `3D Global in progress2026.03.03.ifc`  
Level: `Level 2/Upper Level`; elevation 12.5 ft; geometry probe at 16.5 ft

## Result

The link does contain IFC parameters, but the source/export pipeline collapsed all 55,634
building objects to `IfcBuildingElementProxy`. It did not preserve `IfcDoor`, `IfcWindow`, or
`IfcWall`, nor a usable name, predefined type, family/type, geometry-style, or material pattern.
The `_detached` title rather than the prior run's `_detached_1` is only Revit's collision suffix;
the source path above is the exact path used by the prior probe, opened with
`DetachAndPreserveWorksets`.

| Distinct `Export to IFC As` class | Count | Revit category | Opening value |
|---|---:|---|---|
| `IfcBuildingElementProxy` | 55,634 | Generic Models | No |
| `IfcSite` | 1 | Site | No |
| `IfcDoor` | 0 | — | Yes, absent |
| `IfcWindow` | 0 | — | Yes, absent |
| `IfcWall` | 0 | — | No, absent |

## Metadata carriers

| Carrier | Evidence on imported DirectShapes |
|---|---|
| Category | 55,634 Generic Models plus one Site |
| Element `Name` / `IfcName` | 55,634 values are `Undefined`; the Site name is blank |
| Family/type | Sampled DirectShapes have invalid type id and blank family/type values |
| `Export to IFC As` | Present/non-empty on all 55,635; only the two classes above |
| `IFC Predefined Type` | Present on all 55,635; non-empty on 0 |
| `IfcExportAs` / `Export Type` | Present on 0 |
| `IfcGUID` | Present/non-empty on all 55,635; unique identity, not class identity |
| Shared IFC parameters | `IfcName`, `IfcDecomposesGUID`, and `IfcPropertySetList` exist, but carry only `Undefined`, a common parent id, and `"SU_InstanceSet";"SU_DefinitionSet"` |
| Extensible storage | No linked element owns an extensible-storage schema |

The Upper cut-plane scan covered 5,147 DirectShapes (5,146 Generic Models plus the Site).
Geometry extraction had zero failures. No element had a door/window/opening name in its element
metadata, geometry graphics style, or material; the only non-empty style was `Axis` on six
elements, while materials were anonymous `RGB ...` names.

## Opening artifacts and counts

| Kind | Upper Level count | Position / width / facing |
|---|---:|---|
| Door | 0 | Not derivable: no door identity |
| Window | 0 | Not derivable: no window identity |
| Generic opening | 0 | Not derivable: no opening identity |

JSON: `eval/rhvac/project-a/probe/ifc_openings_upper.json`  
Overlay: `eval/rhvac/project-a/probe/overlay_ifc_openings.png`

![Upper Level IFC opening probe](project-a/probe/overlay_ifc_openings.png)

The JSON is intentionally empty rather than guessing from geometry. The overlay reuses the
existing Upper ink raster and draws all 241 mined Upper wall runs in dashed green; there are no
red/cyan opening marks because the metadata scan identified none.

## Sanity metric

Identified typed doors: **0**, versus approximately **191 wall-run seal components**. The count is
the 8-connected components of cells added when replaying the captured Upper snapshot with
`SealWallRunGaps=true` versus `false`, with every other inferred option held constant. The
differential contains 10,629 cells at 0.25 ft, or 664.31 sf; that agrees with the existing rounded
detector log `wall-run gap seal: 664 sf of doorway gaps became obstruction` (door-head sealing is
a separate 24 sf). The median component is 1.50 sf and the largest is 36.62 sf, so 191 is a sanity
count of heuristic regions, not a claim that all 191 are real doors. The replay log is retained at
`.artifacts/tmp/ifc-openings-replay/log_Level_2_Upper_Level.txt`; the count method and values are
also recorded in `ifc_openings_upper.json`.

## Verdict

1. **NO:** typed door identification is not reliable enough to replace the gap heuristic on this IFC-shell model.
2. Every building object is `IfcBuildingElementProxy`; `IfcDoor`, `IfcWindow`, and `IfcWall` counts are all zero.
3. Names, predefined types, family/types, shared-property hints, graphics styles, and materials provide no reliable fallback pattern.
4. Upper Level therefore yields zero provenance-carrying openings, while the current heuristic produces about 191 connected seal regions / 664.31 sf.
5. Keep `SealWallRunGaps`; revisit typed seals only with an IFC export that preserves semantic classes or a separately validated source mapping.
