// Metadata only. A directly unsheeted parent remains a candidate when its dependents are sheeted.
public sealed class MechanicalPlanCensus : PeScriptContainer
{
    public const int MaxPlans = 5000, MaxSheets = 5000, MaxPlacements = 20000, MaxRelatedReferences = 50000;

    public override void Execute()
    {
        if (doc == null) { Result(new { refused = "No active document." }); return; }
        Profiler.Validate();
        var budget = new ProfilerBudget(ct);
        var provenance = Profiler.Provenance(doc);
        var plans = new List<MechanicalPlanRow>();
        var sheets = new List<object>();
        var placements = new List<object>();
        var placed = new Dictionary<long, List<long>>();
        var diagnostics = new List<string>();
        int? totalPlans = null, totalSheets = null;
        var visitedPlans = 0; var templates = 0; var visitedSheets = 0; var relatedReferences = 0;
        var plansComplete = false; var placementsComplete = false;
        var status = "completed";
        try {
            budget.Check();
            using (var c = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan))) totalPlans = c.GetElementCount();
            using (var c = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet))) totalSheets = c.GetElementCount();
            using (var c = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)))
            foreach (ViewPlan view in c) {
                budget.Check();
                if (visitedPlans == MaxPlans) { diagnostics.Add("Plan enumeration cap reached."); break; }
                visitedPlans++;
                if (view.IsTemplate) { templates++; continue; }
                var parameter = view.get_Parameter(BuiltInParameter.VIEW_DISCIPLINE);
                int? value = parameter?.StorageType == StorageType.Integer ? parameter.AsInteger() : (int?)null;
                var known = value.HasValue && Enum.IsDefined(typeof(ViewDiscipline), value.Value);
                var mechanical = known ? value.Value == (int)ViewDiscipline.Mechanical :
                    view.Name.IndexOf("mechan", StringComparison.OrdinalIgnoreCase) >= 0;
                if (!mechanical) continue;
                var primary = view.GetPrimaryViewId();
                var dependentIds = view.GetDependentViewIds();
                var relatedIds = new[] { view.Id, primary }.Concat(dependentIds).Where(id => id.Value > 0).Distinct().ToList();
                // Include siblings of dependent plans when describing the primary/dependent family.
                if (doc.GetElement(primary) is View parent)
                    relatedIds = relatedIds.Concat(parent.GetDependentViewIds()).Distinct().ToList();
                var room = Math.Min(200, Math.Max(0, MaxRelatedReferences - relatedReferences));
                var related = new List<MechanicalPlanRef>();
                foreach (var id in relatedIds.Take(room)) {
                    budget.Check(); var element = doc.GetElement(id);
                    related.Add(new MechanicalPlanRef { Id = id.Value, UniqueId = element?.UniqueId });
                }
                relatedReferences += related.Count;
                var row = new MechanicalPlanRow {
                    Id = view.Id.Value, UniqueId = view.UniqueId, Name = view.Name, Kind = view.ViewType.ToString(),
                    DisciplineValue = value, DisciplineEnum = known ? ((ViewDiscipline)value.Value).ToString() : null,
                    SelectionBasis = known ? "VIEW_DISCIPLINE numeric/enum" : "name fallback: contains mechan; discipline unavailable or unrecognized",
                    PrimaryId = primary.Value, PrimaryUniqueId = doc.GetElement(primary)?.UniqueId,
                    DependentIds = dependentIds.Take(200).Select(id => id.Value).ToArray(),
                    DependentCount = dependentIds.Count, DependentsCapped = dependentIds.Count > 200,
                    RelatedViews = related, RelatedViewCount = relatedIds.Count, RelatedReferencesCapped = related.Count < relatedIds.Count,
                    Level = view.GenLevel == null ? null : new MechanicalPlanRef { Id = view.GenLevel.Id.Value, UniqueId = view.GenLevel.UniqueId, Name = view.GenLevel.Name },
                    LevelElevationFeet = view.GenLevel?.Elevation, TemplateId = view.ViewTemplateId.Value,
                    Template = doc.GetElement(view.ViewTemplateId) is Element template ?
                        new MechanicalPlanRef { Id = template.Id.Value, UniqueId = template.UniqueId, Name = template.Name } : null,
                    Detail = view.DetailLevel.ToString(), Style = view.DisplayStyle.ToString(), Scale = view.Scale
                };
                try { row.CropActive = view.CropBoxActive; row.CropVisible = view.CropBoxVisible; }
                catch (Autodesk.Revit.Exceptions.ApplicationException e) { row.Diagnostics.Add("Crop flags unavailable: " + e.Message); }
                plans.Add(row);
            }
            plansComplete = visitedPlans == totalPlans;
            using (var c = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)))
            foreach (ViewSheet sheet in c) {
                budget.Check();
                if (visitedSheets == MaxSheets) { diagnostics.Add("Sheet enumeration cap reached."); break; }
                sheets.Add(new { id = sheet.Id.Value, uniqueId = sheet.UniqueId, name = sheet.Name, number = sheet.SheetNumber });
                foreach (var id in sheet.GetAllPlacedViews()) {
                    budget.Check();
                    if (placements.Count == MaxPlacements) throw new InvalidOperationException("Placement cap reached; absence of a placement is unknown.");
                    if (!placed.TryGetValue(id.Value, out var list)) { list = new List<long>(); placed.Add(id.Value, list); }
                    list.Add(sheet.Id.Value);
                    placements.Add(new { viewId = id.Value, sheetId = sheet.Id.Value });
                }
                visitedSheets++;
            }
            placementsComplete = visitedSheets == totalSheets;
            if (!plansComplete || !placementsComplete) status = "partial";
        } catch (TimeoutException e) { status = "budget-exhausted"; diagnostics.Add(e.Message); }
        catch (System.OperationCanceledException e) { status = "cancelled"; diagnostics.Add(e.Message); }
        catch (InvalidOperationException e) { status = "partial"; diagnostics.Add(e.Message); }
        catch (Autodesk.Revit.Exceptions.ApplicationException e) { status = "partial"; diagnostics.Add(e.GetType().Name + ": " + e.Message); }
        if (plans.Any(p => p.RelatedReferencesCapped || p.DependentsCapped)) {
            if (status == "completed") status = "partial";
            diagnostics.Add("Related/dependent references capped; no-related-placement is unknown for affected plans without an observed placement.");
        }
        foreach (var plan in plans) {
            plan.DirectSheetIds = placed.TryGetValue(plan.Id, out var direct) ? direct.ToArray() : new long[0];
            plan.DirectUnsheeted = plan.DirectSheetIds.Length > 0 ? false : placementsComplete ? true : (bool?)null;
            plan.RelatedPlacedViewIds = plan.RelatedViews.Where(v => placed.ContainsKey(v.Id)).Select(v => v.Id).ToArray();
            plan.NoRelatedPlacements = plan.RelatedPlacedViewIds.Length > 0 ? false :
                placementsComplete && !plan.RelatedReferencesCapped ? true : (bool?)null;
        }
        var planParts = WriteParts("mechanical-plans", plans.Cast<object>().ToList(), 100);
        var sheetParts = WriteParts("mechanical-sheets", sheets, 1000);
        var placementParts = WriteParts("mechanical-placements", placements, 1000);
        var artifact = Artifacts.WriteJson("mechanical-plan-census.json", new {
            schemaVersion = 1, status, provenance, diagnostics, budgetSeconds = ProfilerSettings.BudgetSeconds,
            limits = new { MaxPlans, MaxSheets, MaxPlacements, MaxRelatedReferences, relatedPerPlan = 200 },
            totalViewPlans = totalPlans, visitedViewPlans = visitedPlans, observedTemplates = templates,
            observedNonTemplates = visitedPlans - templates, plansComplete,
            observedMechanicalPlans = plans.Count, directlyUnsheeted = plans.Count(p => p.DirectUnsheeted == true),
            withoutRelatedPlacements = plans.Count(p => p.NoRelatedPlacements == true),
            totalSheets, visitedSheets, observedPlacementReferences = placements.Count, placementsComplete,
            relatedReferencesCapped = plans.Any(p => p.RelatedReferencesCapped), planParts, sheetParts, placementParts,
            scope = "Non-template mechanical ViewPlan metadata. Direct sheet placement and primary/dependent-family placements are separate. Missing placements are unknown if the sheet/relationship scan is incomplete. No geometry, spatial whole-level coverage, activation, rendering, navigation benefit or mutation is claimed."
        });
        Result(new { status, artifact = artifact.FullPath, mechanicalPlans = plans.Count,
            directlyUnsheeted = plans.Count(p => p.DirectUnsheeted == true), plansComplete, placementsComplete, diagnostics });
    }

    private List<string> WriteParts(string prefix, List<object> rows, int size)
    {
        var parts = new List<string>();
        for (var offset = 0; offset < rows.Count; offset += size)
            parts.Add(Artifacts.WriteJson(prefix + "-" + offset + ".json", rows.Skip(offset).Take(size).ToArray()).RelativePath);
        return parts;
    }
}

public sealed class MechanicalPlanRef { public long Id; public string UniqueId; public string Name; }
public sealed class MechanicalPlanRow
{
    public long Id; public string UniqueId; public string Name; public string Kind;
    public int? DisciplineValue; public string DisciplineEnum; public string SelectionBasis;
    public long PrimaryId; public string PrimaryUniqueId; public long[] DependentIds; public int DependentCount; public bool DependentsCapped;
    public List<MechanicalPlanRef> RelatedViews; public int RelatedViewCount; public bool RelatedReferencesCapped;
    public MechanicalPlanRef Level; public MechanicalPlanRef Template;
    public double? LevelElevationFeet; public long TemplateId;
    public string Detail; public string Style; public int Scale; public bool? CropActive; public bool? CropVisible;
    public long[] DirectSheetIds; public bool? DirectUnsheeted; public long[] RelatedPlacedViewIds; public bool? NoRelatedPlacements;
    public List<string> Diagnostics = new List<string>();
}
