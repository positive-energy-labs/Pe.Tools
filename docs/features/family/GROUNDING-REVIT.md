# Family editing — Revit API grounding

Revit API gotcha lore for family-document editing, live-verified in the old-repo Family
Foundry era and still governing. Every implementation brief touching Revit-side family
ops reads this first — you will write some of this wrong from reflex. Where a gotcha is
already baked into an in-repo wrapper (see paths at bottom), prefer the wrapper; this
list explains why the wrapper is shaped the way it is.

## Relationship model

The parameter×type matrix snapshot now lives in-repo (`FamilySnapshotExtractor` →
`FamilyParameterSnapshot`); this section keeps only the API facts behind it.

Two orthogonal relationship types (both belong in the snapshot):
- **Formula dependencies** (soft, name-based): GetDependencies / GetDependents via
  boundary-char-aware token matching in formula text; DFS cycle detection; chains
  resolve to an "ultimate source".
- **Direct associations** (hard, element-based): dimensions (DIM_LABEL), arrays
  (Label.Id), connectors + nested instances via `fm.GetAssociatedFamilyParameter(elemParam)`.
  Setting: `fm.AssociateElementParameterToFamilyParameter(elemParam, famParam)`, null = clear.
- FF resolves associations ONE level deep only. Multi-level ancestry (into nested family
  docs) has NO precedent — needs EditFamily per nested family (see gotcha 9).

## Numbered gotchas (verified against FF source by explorer)

1. `fm.CurrentType` get AND set are VERY expensive — set once, never in a per-param loop.
2. Setting `fm.CurrentType` uses an internal sub-transaction — must already be inside a Transaction.
3. **Set-value-for-all-types trick**: set formula, immediately unset → value baked into every
   type without cycling CurrentType. (`SetUnsetFormula`, the #1 perf trick.)
4. Type-param formulas cannot reference instance params (InvalidOperationException).
   Instance-param formulas may reference both. Pre-validate for a clear error.
5. Formulas forbidden entirely for `SpecTypeId.String.Url` and `SpecTypeId.Reference.LoadClassification`.
   Sub-trap: ForgeTypeId statics NPE at type-init — make the forbidden-set a getter, not a static field.
6. Load Classification param cannot be set in a family doc at all (needs project-level ElementId).
7. Unassociatable connector params (throws): Category, System Type, Power Factor State,
   Design Option, Family Name, Type Name. Keep an explicit skip-list.
8. Associate = dissociate first (pass null), then associate; only when datatypes match.
9. `EditFamily` doc has empty PathName, doesn't activate in UI; `.rfa` often can't reopen via
   OpenAndActivateDocument (FileNotFoundException). Workaround: SaveAs temp to give it a PathName.
10. `Document.ParameterBindings` THROWS on family docs — guard `doc.IsFamilyDocument`.
11. Families can have zero types or one unnamed type — `EnsureDefaultType()` before processing.
12. `param.GUID` can throw even when `IsShared` is true — always try/catch.
13. Phantom params have negative IDs / dangling elements — filter `Id.Value >= 0 && GetElement != null`.
14. `fm.ReorderParameters(list)` takes the FULL ordered list.
15. `ReplaceParameter` can return null = silent failure — treat as "try next", not success.
16. After replacing a param, unwrap dangling formula refs on the replaced param.
17. Formula tokenizing: strip string literals FIRST (timestamps parse as param names);
    exclude built-in functions (sin, cos, if, sqrt, round, size_lookup, pi, ln, …);
    boundary chars must exclude `"`.
18. A per-type "value" containing a param reference is really a formula — route to the
    formula path, never the value path.
19. Units: `UnitFormatUtils.TryParse(doc.GetUnits(), dataType, input, out parsed)` then
    `double.Parse` fallback; format back with `UnitFormatUtils.Format`; internal units are
    feet/kg/etc.; guard `UnitUtils.IsMeasurableSpec(dataType)`.
20. Global value set can fail on coercion — pattern: try global, catch, defer to per-type.
21. Param deletion requires no associations; delete recursively (freeing dependents),
    ordered by formula length descending.
22. `ParameterUtils.IsBuiltInParameter(param.Id)` is the reliable built-in test.
23. Built-ins can't be renamed — backlink instead: set built-in's formula = shared param name
    (IsInstance must match).
24. Collecting per-type values from a PROJECT doc needs temp FamilyInstance + activating each
    symbol in a rolled-back transaction, and cannot get formulas — snapshot from the FAMILY doc.
25. **Transaction wall:** `EditFamily` throws while the project document is modifiable (an open
    transaction); `LoadFamily` into a project throws while a transaction is open on it; and
    `LoadFamily` into a family document silently returns false without a transaction open on it.
26. `RenameParameter` auto-rewrites dependent formulas, and per-type values survive the rename
    (live-proven); this is the basis of rename-as-provenance / `wasNamed` in `FamilyModel` migration.
27. **Picked reference-line endpoint work planes are not publicly constructible** (2026-08-17, folded
    from docs/context/family-model-handoff-2026-07-15.md, deleted — git history): every public
    `SketchPlane.Create` route rejects a reference line's endpoint references as non-planar, so
    Revit's public API cannot recreate that relationship. `Resources/Native/2025/puck.rfa` is
    therefore an intentional native compiler resource, not a temporary workaround.

28. **A connector hosted on a nested instance face does not follow the instance** (2026-10-06, HCB build):
    `ConnectorElement.CreateDuctConnector` accepts the face reference from `GetInstanceGeometry`, but the
    connector stays at the point of creation when the nested type or its associated size parameters change.
    Give the host family its own stub extrusion locked to formula-driven planes and host the connector there.
29. **`NewAlignment` and `NewLinearDimension` refuse references from nested instance geometry faces**
    ("not geometrically aligned" even when coplanar). Lock a nested instance only through its named
    references: `FamilyInstance.GetReferences(FamilyInstanceReferenceType)` or `GetReferenceByName`.
30. **A nested family exposes a named reference only when the plane's Is Reference matches its orientation**:
    X-normal planes may be Left/Right/Center (Left/Right), Y-normal Front/Back/Center (Front/Back), Z-normal
    Top/Bottom/Center (Elevation). A mismatched tag is accepted by the API and silently ignored at the host.
31. **`ELEM_REFERENCE_NAME` integers have gaps** (2026-10-06, Revit 2025): 0 Left, 1 Center (Left/Right), 2 Right,
    3 Front, 4 Center (Front/Back), 5 Back, 6 Bottom, 7 Center (Elevation), 8 Top, 12 Not a Reference,
    13 Strong Reference; 9 to 11 read back empty. Read back `AsValueString()` after `Regenerate()`, not before.
32. **The nested type slot cannot be associated**: `ELEM_TYPE_PARAM`, `ELEM_FAMILY_AND_TYPE_PARAM`,
    `ELEM_TYPE_LABEL` and `SYMBOL_ID_PARAM` all refuse `AssociateElementParameterToFamilyParameter`, and a
    Family Type host parameter cannot drive a nested instance's type by API. Make the nested family's size
    parameters instance (`FamilyManager.MakeInstance`, after clearing type formulas that reference them) and
    associate those instead.
33. **A nested instance aligned by one face and sized by a plain value stretches instead of moving** when the
    host plane moves; a size owned by an associated host parameter makes the alignment move the instance.
34. **`Document.ExportImage` works on a headless family document inside a rolled-back script** (2026-10-06,
    Revit 2025): switch `FamilyManager.CurrentType`, hide Dimensions/CLines/Levels, export plan, elevations and
    a 3D view to PNG. Annotations left visible hid geometry in the first export. A per-type census of every
    `GenericForm`, nested instance and connector bbox plus these images caught a stray form a log line called deleted.
    Family editor views draw `Visible = No` elements anyway, so images cannot prove a visibility toggle; the census can.
35. **A rectangular connector's width axis comes from the host face, not the `edge` argument** (2026-10-06, Revit 2025):
    `CreateDuctConnector(..., face, edge)` gave width along -Y on a horizontal face with an X edge and with a Y edge.
    `ElementTransformUtils.RotateElement` about the connector normal turns it, and the turn holds across all 8 HCB types.
36. **A value set before a dimension is labeled does not drive it**: set the parameter again after `FamilyLabel`.
37. **Same-name nested families merge on project load** (2026-10-06, HCB build, user-observed): two nested
    families with one name become one loaded family in the project, and Revit asks overwrite-or-keep on a pure
    name match. Give every nested family a unique name before nesting it twice with different content.
38. **Mechanical connectors cannot nest and cannot be hidden by a toggle** (2026-10-06, HCB build, user-observed):
    a connector inside a nested family is not a connector of the host, and a connector has no visibility
    parameter. A toggled accessory (the OA mixing box) needs the host to own the connector on its own stub,
    and the stub follows the toggle.

## Authored-parameter scoping (derived from documentation — NOT live-proven)

2026-08-17, folded from `docs/context/rvt-api/REVIT_PARAMETER_METADATA_RESOLUTION.md` (deleted — git
history). Everything above this heading is live-verified; this section is **not** — it was derived
from Autodesk docs plus a hand-run project-parameter probe, and it fails the live-proof bar. Treat it
as a working mental model that tells you which experiment to run, never as a fact you may assert.
No proof test exists; if a claim here is re-derived or contested, pin it in `Pe.Revit.Tests/Proofs/`.

Four authored parameter kinds, on two scopes (built-ins are adjacent and are none of these four):

- **Project-scoped**, living in the `.rvt`: **Project Parameter (PP)** and **Project Shared
  Parameter (PSP)**. They do not travel with the family when it is saved out, cannot be associated
  to geometry/dimensions/formulas, and start empty. They are cheap, keep the family editor
  uncluttered, and are the only kinds whose model-group behaviour can be controlled
  (`InternalDefinition.SetAllowVaryBetweenGroups`). Category binding is mandatory for both.
- **Family-scoped**, living in the `.rfa`: **Shared Parameter (SP)** and **Family Parameter (FP)**.
  They save and transfer with the family, support instance and type defaults, and are the only kinds
  that can drive dimensions, arrays, connectors, and formulas. Cost: parameter-count clutter, regen
  cost from parameter-driven constraints, and no easy cross-family coordination of Type/Instance or
  properties group.

Decision tree for which to create:

1. **Is it schedulable?** No → `Family Parameter`.
2. Yes → **is it tag-able** (and will it exist across other families/tags)? No → `Project Parameter`.
3. Yes → **do you need a default value for it, OR must it persist on the family when saved out?**
   No → `Project Shared Parameter`. Yes → `Shared Parameter`.

Two shortcuts that reach the same answer: project-specific-only facts (design conditions, an
architectural name) are project-scoped; anything that must be *associable* (dims, formulas, arrays,
labels, connectors) is family-scoped.

Merge behaviour when a shared parameter exists BOTH as an SP on the family and a PSP in the project
— a situation to avoid rather than design for; the merge is a consistency safeguard, not a feature.
The shared-parameter definition provides `Name` and datatype; the PSP provides category binding and
group behaviour; the family-side SP provides the Type/Instance designation; the PSP overrides the SP
for `propertiesGroup` and tooltip. A PSP's Type/Instance setting is ignored outright when the family
already carries that shared parameter.

One API clarification that IS reliable: once a binding exists, iterating `doc.ParameterBindings`
yields `InternalDefinition` keys, so shared-ness on the project side resolves through
`SharedParameterElement`/GUID — never by expecting the binding key to be an `ExternalDefinition`.
`BindingMap.Insert` returns false when the binding already exists and `ReInsert` returns false when
it does not; one definition cannot be instance-bound and type-bound at once.

## FF UX verdicts (keep / kill)

Keep: ParamSnapshot matrix model; debounced preview + per-item cache; cross-family
"where is this param used" aggregation; inline validation errors; try-global-then-per-type
fallback execution.

Kill: JSON-profile-as-editing-surface; read-only FlowDocument rendering; WPF palette host.
No live per-cell editing or undo precedent exists — built new.

## In-repo wrapper paths (prefer these over raw API calls)

- `dotnet/Pe.Revit/Extensions/FamDocument/` — `SetFormula`, `SetValue` (the set-unset trick), `GetValue`, `AddParameter`, `FindParameter`, `ProcessFamily`
- `dotnet/Pe.Revit.FamilyFoundry/Operations/` — `SetParamValues*`, `PurgeParams`, `BacklinkParamsToBuiltIn`, `CreateFamilyTypes`, …
- `dotnet/Pe.Revit.FamilyFoundry/Snapshots/` — `ParameterSnapshot`, `FamilySnapshot`
- `dotnet/Pe.Revit.DocumentData/Families/Extraction/FamilySnapshotExtractor.cs` — the single canonical snapshot producer
