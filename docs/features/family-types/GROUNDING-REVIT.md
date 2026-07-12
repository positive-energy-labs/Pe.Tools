# Family editing — Revit API grounding (from OLD-repo Family Foundry)

> SUPERSEDED AS DESIGN PRECEDENT (user steer 2026-07-12): "FF" means
> `source/Pe.Revit.FamilyFoundry` in THIS repo — the standardized-language surface.
> This doc remains valid ONLY as Revit API gotcha lore. For input models, parameter
> identity, snapshots, desired state: see GROUNDING-LANGUAGE.md (in-repo FF index).

Source: `C:\Users\kaitp\source\repos\PE_Tools` (old repo, read-only precedent). Every
implementation brief touching Revit-side family ops reads this first. You will write
some of this wrong from reflex — verify against the FF source paths listed at bottom.

## The data model to carry forward

`ParamSnapshot` — the serializable parameter×type matrix a Types dialog renders:
`ValuesPerType: Dictionary<TypeName,string>`, `Formula`, `IsInstance`, `DataType`,
`IsBuiltIn`, `SharedGuid`, `StorageType`. (FF: `Core\Aggregators\Snapshots\ParamSnapshot.cs`)

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
24. (FF-internal) LogEntry is terminal — not relevant to new code.
25. Collecting per-type values from a PROJECT doc needs temp FamilyInstance + activating each
    symbol in a rolled-back transaction, and cannot get formulas — snapshot from the FAMILY doc.

## FF UX verdicts (keep / kill)

Keep: ParamSnapshot matrix model; debounced preview + per-item cache; cross-family
"where is this param used" aggregation; inline validation errors; try-global-then-per-type
fallback execution.

Kill: JSON-profile-as-editing-surface; read-only FlowDocument rendering; WPF palette host.
No live per-cell editing or undo precedent exists — built new.

## Key FF source paths (for verification)

- `.cursor\rules\family-foundry-{dev,debug}.mdc`
- `Library\PeExtensions\FamilyDocument\{SetFormula,SetValue,GetValue,UnwrapFormula,ProcessFamily}.cs`
- `Library\PeExtensions\FamilyParameter\Formula\{References,Dependencies,CycleDetection,Analysis,Tokenizer}.cs`
- `Library\PeExtensions\FamilyParameter\GetAssociated.cs`
- `LibraryAddins\AddinFamilyFoundrySuite\Core\Snapshots\ParamSectionCollector.cs`
- `LibraryAddins\AddinFamilyFoundrySuite\Core\Operations\{SetParamValues,SetParamValuesPerType,PurgeParams,BacklinkParamsToBuiltIn}.cs`
