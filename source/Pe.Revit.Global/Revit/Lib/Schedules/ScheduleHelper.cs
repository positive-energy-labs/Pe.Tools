using Autodesk.Revit.DB.Structure;
using Pe.Global.Revit.Lib.Schedules.Fields;
using Pe.Global.Revit.Lib.Schedules.Filters;
using Pe.Global.Revit.Lib.Schedules.HeaderGroups;
using Pe.Global.Revit.Lib.Schedules.SortGroup;
using Pe.Global.Revit.Lib.Schedules.TitleStyle;
using Pe.Global.Revit.Lib.Schedules.ViewTemplate;
using Pe.RevitData.Families;
using Pe.RevitData.Parameters;
using Serilog;

namespace Pe.Global.Revit.Lib.Schedules;

public static class ScheduleHelper {
    /// <summary>
    ///     Serializes a ViewSchedule into a ScheduleSpec.
    /// </summary>
    public static ScheduleSpec SerializeSchedule(ViewSchedule schedule) {
        var def = schedule.Definition;
        var category = Category.GetCategory(schedule.Document, def.CategoryId);

        var spec = new ScheduleSpec {
            Name = schedule.Name,
            CategoryName = category?.BuiltInCategory ?? BuiltInCategory.INVALID,
            IsItemized = def.IsItemized,
            FilterBySheet = def.IsFilteredBySheet,
            Fields = [],
            SortGroup = [],
            Filters = []
        };

        // Serialize fields
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var field = def.GetField(i);
            var fieldSpec = ScheduleFieldSpec.SerializeFrom(field, schedule);
            spec.Fields.Add(fieldSpec);
        }

        // Serialize sort/group fields
        for (var i = 0; i < def.GetSortGroupFieldCount(); i++) {
            var sortGroupField = def.GetSortGroupField(i);
            var sortGroupSpec = ScheduleSortGroupSpec.SerializeFrom(sortGroupField, def);
            spec.SortGroup.Add(sortGroupSpec);
        }

        // Serialize filters
        for (var i = 0; i < def.GetFilterCount(); i++) {
            var filter = def.GetFilter(i);
            var filterSpec = ScheduleFilterSpec.SerializeFrom(filter, def);
            spec.Filters.Add(filterSpec);
        }

        // Serialize header groups (updates field specs in place)
        HeaderGroupHandler.SerializeHeaderGroups(schedule, spec.Fields);

        // Serialize title style (borders and alignment)
        spec.TitleStyle = ScheduleTitleStyleSpec.SerializeFrom(schedule);

        // Serialize view template
        spec.ViewTemplateName = ViewTemplateHandler.SerializeViewTemplate(schedule);

        return spec;
    }

    /// <summary>
    ///     Creates a schedule from a ScheduleSpec.
    /// </summary>
    public static ScheduleCreationResult CreateSchedule(Document doc, ScheduleSpec spec) {
        var categoryId = FindCategoryId(doc, spec.CategoryName);
        if (categoryId == ElementId.InvalidElementId)
            throw new ArgumentException(
                $"Category '{GetCategoryDisplayName(spec.CategoryName)}' not found in document");

        // Create schedule
        var schedule = ViewSchedule.CreateSchedule(doc, categoryId);
        schedule.Name = GetUniqueScheduleName(doc, spec.Name);

        var result = new ScheduleCreationResult {
            Schedule = schedule,
            ScheduleName = schedule.Name,
            CategoryName = GetCategoryDisplayName(spec.CategoryName),
            IsItemized = spec.IsItemized
        };

        // Apply schedule-level settings
        var def = schedule.Definition;
        def.IsItemized = spec.IsItemized;
        def.ClearFields();

        // Apply filter-by-sheet setting
        if (spec.FilterBySheet) {
            if (def.IsValidCategoryForFilterBySheet()) {
                try {
                    def.IsFilteredBySheet = true;
                    result.FilterBySheetApplied = true;
                } catch (InvalidOperationException ex) {
                    result.FilterBySheetSkipped =
                        $"Category supports filter-by-sheet but could not enable: {ex.Message}";
                }
            } else {
                result.FilterBySheetSkipped =
                    $"Category '{GetCategoryDisplayName(spec.CategoryName)}' does not support filter-by-sheet";
            }
        }

        // Apply fields using tuple aggregation
        foreach (var fieldSpec in spec.Fields.Where(f => f.CalculatedType is null)) {
            var (applied, skipped, warnings) = fieldSpec.ApplyTo(
                schedule, def, FindSchedulableField, FindParameterIdByName);

            if (applied != null) result.AppliedFields.Add(applied);
            if (skipped != null) result.SkippedFields.Add(skipped);
            result.Warnings.AddRange(warnings);
        }

        // Collect calculated field guidance
        foreach (var fieldSpec in spec.Fields.Where(f => f.CalculatedType.HasValue)) {
            var guidance = fieldSpec.GetCalculatedFieldGuidance();
            if (guidance != null) result.SkippedCalculatedFields.Add(guidance);
        }

        // Apply sort/group using tuple aggregation
        def.ClearSortGroupFields();
        foreach (var sortGroupSpec in spec.SortGroup) {
            var (applied, skipped) = sortGroupSpec.ApplyTo(def);
            if (applied != null) result.AppliedSortGroups.Add(applied);
            if (skipped != null) result.SkippedSortGroups.Add(skipped);
        }

        // Apply filters using tuple aggregation
        def.ClearFilters();
        if (spec.Filters.Count > 8) {
            result.Warnings.Add(
                $"Schedule supports maximum 8 filters, found {spec.Filters.Count}. Only first 8 will be applied.");
        }

        foreach (var filterSpec in spec.Filters.Take(8)) {
            var (applied, skipped, warning) = filterSpec.ApplyTo(def);
            if (applied != null) result.AppliedFilters.Add(applied);
            if (skipped != null) result.SkippedFilters.Add(skipped);
            if (warning != null) result.Warnings.Add(warning);
        }

        // Apply header groups
        var (appliedGroups, skippedGroups, headerWarnings) =
            HeaderGroupHandler.ApplyHeaderGroups(schedule, spec.Fields);
        result.AppliedHeaderGroups.AddRange(appliedGroups);
        result.SkippedHeaderGroups.AddRange(skippedGroups);
        result.Warnings.AddRange(headerWarnings);

        // Apply title style (borders and alignment) - must happen before view templates
        var (appliedTitleStyle, titleStyleWarning) = spec.TitleStyle.ApplyTo(schedule);
        if (!appliedTitleStyle && titleStyleWarning != null)
            result.Warnings.Add(titleStyleWarning);

        // Apply view template
        var (appliedTemplate, skippedTemplate, templateWarning) =
            ViewTemplateHandler.ApplyViewTemplate(schedule, spec.ViewTemplateName);
        result.AppliedViewTemplate = appliedTemplate;
        result.SkippedViewTemplate = skippedTemplate;
        if (templateWarning != null) result.Warnings.Add(templateWarning);

        return result;
    }

    /// <summary>
    ///     Gets all schedule view template names from the document.
    /// </summary>
    public static List<string> GetScheduleViewTemplateNames(Document doc) =>
        ViewTemplateHandler.GetScheduleViewTemplateNames(doc);

    /// <summary>
    ///     Gets family names that would appear in a schedule with the given filters.
    ///     Uses Revit's native schedule filtering by creating a temporary schedule,
    ///     placing temp instances, and using FilteredElementCollector to identify matches.
    ///     All changes are rolled back - no permanent modifications to the document.
    /// </summary>
    public static List<string> GetFamiliesMatchingFilters(Document doc,
        ScheduleSpec spec,
        IEnumerable<Family>? families = null) {
        var matchingFamilies = GetMatchingFamiliesByFilter(doc, spec, families, evaluateAllTypes: false);
        return matchingFamilies
            .Select(family => family.Name)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    ///     Gets family ids that would appear in a schedule with the given filters.
    ///     A family is considered a match when any placeable type in that family passes the schedule filters
    ///     using default type and instance values.
    /// </summary>
    public static List<long> GetFamilyIdsMatchingFiltersAnyType(
        Document doc,
        ScheduleSpec spec,
        IEnumerable<Family>? families = null
    ) =>
        GetMatchingFamiliesByFilter(doc, spec, families, evaluateAllTypes: true)
            .Select(family => family.Id.Value())
            .Distinct()
            .ToList();

    internal static List<long> GetFamilyIdsMatchingFiltersAnyType(
        Document doc,
        ScheduleSpec spec,
        IReadOnlyList<TempPlacedSymbolRecord> placements
    ) {
        if (placements.Count == 0)
            return [];

        if (spec.Filters.Count == 0)
            return placements
                .Select(placement => placement.FamilyId)
                .Distinct()
                .ToList();

        var schedule = CreateMinimalFilterEvaluationSchedule(doc, spec);
        doc.Regenerate();

        var matchingInstanceIds = CollectMatchingPlacedInstanceIds(doc, schedule.Id, placements);
        return MapMatchingInstancesToFamilyIds(placements, matchingInstanceIds);
    }

    private static List<Family> GetMatchingFamiliesByFilter(
        Document doc,
        ScheduleSpec spec,
        IEnumerable<Family>? families,
        bool evaluateAllTypes
    ) {
        var categoryId = FindCategoryId(doc, spec.CategoryName);
        if (categoryId == ElementId.InvalidElementId)
            throw new ArgumentException(
                $"Category '{GetCategoryDisplayName(spec.CategoryName)}' not found in document");

        // Get families to test
        var familiesToTest = families?.ToList() ?? new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(f => f.FamilyCategory?.Id == categoryId)
            .ToList();

        if (familiesToTest.Count == 0)
            return [];

        // If no filters, return all family names
        if (spec.Filters.Count == 0)
            return familiesToTest;

        using var context = LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(
            doc,
            familiesToTest.Select(family => family.Id.Value()).ToHashSet()
        );
        context.BeginTransaction("Temp Filter Evaluation");

        try {
            LoadedFamiliesTempPlacementEngine.PlaceOneTempInstancePerPlaceableSymbol(context);
            var placements = evaluateAllTypes
                ? context.GetPlacedInstancesForCategory(categoryId).ToList()
                : familiesToTest
                    .Select(family => context.GetPlacedInstancesForFamily(family.Id.Value()).FirstOrDefault())
                    .Where(placement => placement != null)
                    .Cast<TempPlacedSymbolRecord>()
                    .ToList();
            var matchingFamilyIds = GetFamilyIdsMatchingFiltersAnyType(doc, spec, placements)
                .ToHashSet();

            return familiesToTest
                .Where(family => matchingFamilyIds.Contains(family.Id.Value()))
                .ToList();
        } finally {
            context.RollBackTransaction();
        }
    }

    internal static ViewSchedule CreateMinimalFilterEvaluationSchedule(Document doc, ScheduleSpec sourceSpec) {
        var categoryId = FindCategoryId(doc, sourceSpec.CategoryName);
        if (categoryId == ElementId.InvalidElementId)
            throw new ArgumentException(
                $"Category '{GetCategoryDisplayName(sourceSpec.CategoryName)}' not found in document");

        var schedule = ViewSchedule.CreateSchedule(doc, categoryId);
        schedule.Name = $"_TempFilterEval_{Guid.NewGuid():N}";
        schedule.Definition.IsItemized = true;

        ApplyFilterFieldsAndFilters(schedule, sourceSpec);
        return schedule;
    }

    internal static void ApplyFilterFieldsAndFilters(ViewSchedule schedule, ScheduleSpec sourceSpec) {
        var def = schedule.Definition;
        def.ClearFields();
        def.ClearFilters();

        foreach (var fieldName in sourceSpec.Filters
                     .Select(filter => filter.FieldName)
                     .Where(fieldName => !string.IsNullOrWhiteSpace(fieldName))
                     .Distinct(StringComparer.OrdinalIgnoreCase)) {
            if (TryAddFilterField(def, schedule.Document, fieldName))
                continue;

            Log.Warning(
                "Schedule filter evaluation could not add field '{FieldName}' for temp schedule '{ScheduleName}'.",
                fieldName,
                sourceSpec.Name
            );
        }

        foreach (var filterSpec in sourceSpec.Filters.Take(8)) {
            var (_, skipped, warning) = filterSpec.ApplyTo(def);
            if (skipped != null) {
                Log.Warning(
                    "Schedule filter evaluation skipped filter '{FieldName}' on temp schedule '{ScheduleName}': {Reason}",
                    filterSpec.FieldName,
                    sourceSpec.Name,
                    skipped
                );
            }

            if (warning != null) {
                Log.Warning(
                    "Schedule filter evaluation warning for filter '{FieldName}' on temp schedule '{ScheduleName}': {Warning}",
                    filterSpec.FieldName,
                    sourceSpec.Name,
                    warning
                );
            }
        }
    }

    internal static List<ElementId> CollectMatchingPlacedInstanceIds(
        Document doc,
        ElementId scheduleId,
        IEnumerable<TempPlacedSymbolRecord> placements
    ) {
        var placementIds = placements
            .Select(placement => placement.InstanceId.Value())
            .ToHashSet();

        return new FilteredElementCollector(doc, scheduleId)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Where(instance => placementIds.Contains(instance.Id.Value()))
            .Select(instance => instance.Id)
            .ToList();
    }

    internal static List<long> MapMatchingInstancesToFamilyIds(
        IEnumerable<TempPlacedSymbolRecord> placements,
        IEnumerable<ElementId> visibleInstanceIds
    ) {
        var visibleIds = visibleInstanceIds
            .Select(id => id.Value())
            .ToHashSet();

        return placements
            .Where(placement => visibleIds.Contains(placement.InstanceId.Value()))
            .Select(placement => placement.FamilyId)
            .Distinct()
            .ToList();
    }

    private static void PlaceTempInstancesForFilterEvaluation(
        Document doc,
        Family family,
        bool evaluateAllTypes
    ) {
        var symbolIds = family.GetFamilySymbolIds();
        if (symbolIds == null || symbolIds.Count == 0)
            return;

        foreach (var symbolId in symbolIds) {
            if (doc.GetElement(symbolId) is not FamilySymbol symbol)
                continue;

            if (!symbol.IsActive)
                symbol.Activate();

            if (!TryPlaceTempInstance(doc, symbol))
                continue;

            if (!evaluateAllTypes)
                return;
        }
    }

    private static bool TryPlaceTempInstance(
        Document doc,
        FamilySymbol symbol
    ) {
        try {
            _ = doc.Create.NewFamilyInstance(
                XYZ.Zero,
                symbol,
                StructuralType.NonStructural);
            return true;
        } catch {
            // Some families may not be placeable in a generic project context.
            return false;
        }
    }

    private static bool TryAddFilterField(
        ScheduleDefinition def,
        Document doc,
        string fieldName
    ) {
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var existingField = def.GetField(i);
            if (existingField.GetName().Equals(fieldName, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        var schedulableField = FindSchedulableField(def, doc, fieldName);
        if (schedulableField == null)
            return false;

        _ = def.AddField(schedulableField);
        return true;
    }

    #region Common Helpers

    internal static ElementId FindCategoryId(Document doc, BuiltInCategory categoryName) =>
        Category.GetCategory(doc, categoryName)?.Id ?? ElementId.InvalidElementId;

    internal static string GetCategoryDisplayName(BuiltInCategory categoryName) =>
        RevitTypeLabelCatalog.GetLabelForBuiltInCategory(categoryName);

    internal static string GetUniqueScheduleName(Document doc, string baseName) {
        var existingNames = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Select(s => s.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!existingNames.Contains(baseName)) return baseName;

        // Find unique name with suffix
        for (var i = 2; i < 1000; i++) {
            var candidateName = $"{baseName} ({i})";
            if (!existingNames.Contains(candidateName)) return candidateName;
        }

        return $"{baseName} ({DateTime.Now:yyyyMMdd-HHmmss})";
    }

    internal static SchedulableField? FindSchedulableField(ScheduleDefinition def, Document doc, string parameterName) {
        var schedulableFields = def.GetSchedulableFields();
        foreach (var sf in schedulableFields) {
            var name = sf.GetName(doc);
            if (name.Equals(parameterName, StringComparison.OrdinalIgnoreCase)) return sf;
        }

        return null;
    }

    internal static ElementId? FindParameterIdByName(ScheduleDefinition def, Document doc, string parameterName) {
        // Try to find in schedulable fields first
        var schedulableFields = def.GetSchedulableFields();
        foreach (var sf in schedulableFields) {
            var name = sf.GetName(doc);
            if (name.Equals(parameterName, StringComparison.OrdinalIgnoreCase)) return sf.ParameterId;
        }

        // Try to match built-in parameters by label
        foreach (BuiltInParameter bip in Enum.GetValues(typeof(BuiltInParameter))) {
            try {
                var label = LabelUtils.GetLabelFor(bip);
                if (label.Equals(parameterName, StringComparison.OrdinalIgnoreCase)) return new ElementId(bip);
            } catch {
                // Some built-in parameters may not have labels
            }
        }

        return null;
    }

    #endregion
}
