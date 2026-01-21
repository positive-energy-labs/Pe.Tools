using Autodesk.Revit.DB.Structure;
using Pe.Global.Revit.Lib.Schedules.Fields;
using Pe.Global.Revit.Lib.Schedules.Filters;
using Pe.Global.Revit.Lib.Schedules.HeaderGroups;
using Pe.Global.Revit.Lib.Schedules.SortGroup;
using Pe.Global.Revit.Lib.Schedules.TitleStyle;
using Pe.Global.Revit.Lib.Schedules.ViewTemplate;

namespace Pe.Global.Revit.Lib.Schedules;

public static class ScheduleHelper {
    /// <summary>
    ///     Serializes a ViewSchedule into a ScheduleSpec.
    /// </summary>
    public static ScheduleSpec SerializeSchedule(ViewSchedule schedule) {
        var def = schedule.Definition;
        var category = Category.GetCategory(schedule.Document, def.CategoryId);
        var categoryName = category?.Name ?? string.Empty;

        var spec = new ScheduleSpec {
            Name = schedule.Name,
            CategoryName = categoryName,
            IsItemized = def.IsItemized,
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
        // Find category by name
        var categoryId = FindCategoryByName(doc, spec.CategoryName);
        if (categoryId == ElementId.InvalidElementId)
            throw new ArgumentException($"Category '{spec.CategoryName}' not found in document");

        // Create schedule
        var schedule = ViewSchedule.CreateSchedule(doc, categoryId);
        schedule.Name = GetUniqueScheduleName(doc, spec.Name);

        var result = new ScheduleCreationResult {
            Schedule = schedule,
            ScheduleName = schedule.Name,
            CategoryName = spec.CategoryName,
            IsItemized = spec.IsItemized
        };

        // Apply schedule-level settings
        var def = schedule.Definition;
        def.IsItemized = spec.IsItemized;
        def.ClearFields();

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
        // Get category
        var categoryId = FindCategoryByName(doc, spec.CategoryName);
        if (categoryId == ElementId.InvalidElementId)
            throw new ArgumentException($"Category '{spec.CategoryName}' not found in document");

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
            return familiesToTest.Select(f => f.Name).ToList();

        using var tx = new Transaction(doc, "Temp Filter Evaluation");
        _ = tx.Start();

        try {
            // Create temporary schedule with filters
            var tempSpec = new ScheduleSpec {
                Name = $"_TempFilterEval_{Guid.NewGuid():N}",
                CategoryName = spec.CategoryName,
                IsItemized = true,
                Fields = spec.Fields,
                Filters = spec.Filters,
                SortGroup = [] // No sorting needed for filter evaluation
            };

            var scheduleResult = CreateSchedule(doc, tempSpec);
            var schedule = scheduleResult.Schedule;

            // Place one temp instance of each family type
            var placedFamilyNames = new HashSet<string>(StringComparer.Ordinal);

            foreach (var family in familiesToTest) {
                var symbolIds = family.GetFamilySymbolIds();
                if (symbolIds == null || symbolIds.Count == 0)
                    continue;

                foreach (var symbolId in symbolIds) {
                    if (doc.GetElement(symbolId) is not FamilySymbol symbol)
                        continue;

                    if (!symbol.IsActive)
                        symbol.Activate();

                    try {
                        _ = doc.Create.NewFamilyInstance(
                            XYZ.Zero,
                            symbol,
                            StructuralType.NonStructural);

                        _ = placedFamilyNames.Add(family.Name);
                    } catch {
                        // Some families may not be placeable (e.g., face-based without host)
                        // Skip and continue with other families
                    }

                    // Only need one type per family to test if family passes filters
                    break;
                }
            }

            // Use FilteredElementCollector with schedule to get filtered elements
            var filteredInstances = new FilteredElementCollector(doc, schedule.Id)
                .OfClass(typeof(FamilyInstance))
                .Cast<FamilyInstance>()
                .ToList();

            // Extract unique family names from instances that passed filters
            var matchingFamilyNames = filteredInstances
                .Select(i => i.Symbol.Family.Name)
                .Distinct(StringComparer.Ordinal)
                .ToList();

            return matchingFamilyNames;
        } finally {
            // Always rollback - we only wanted to query, not make permanent changes
            if (tx.HasStarted())
                _ = tx.RollBack();
        }
    }

    #region Common Helpers

    internal static ElementId FindCategoryByName(Document doc, string categoryName) {
        var categories = doc.Settings.Categories;
        foreach (Category cat in categories) {
            if (cat.Name.Equals(categoryName, StringComparison.OrdinalIgnoreCase))
                return cat.Id;
        }

        return ElementId.InvalidElementId;
    }

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