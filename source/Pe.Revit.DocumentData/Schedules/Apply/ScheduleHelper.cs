using Autodesk.Revit.DB.Structure;
using Pe.Revit.DocumentData.Families.Loaded;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.Schedules.Authored;
using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Revit.DocumentData.Schedules.Apply.HeaderGroups;
using Pe.Revit.DocumentData.Schedules.Runtime;
using Pe.Shared.RevitData.Schedules;
using Serilog;
using System.Globalization;
using SharedCombinedParameterSpec = Pe.Shared.RevitData.Schedules.CombinedParameterSpec;
using SharedScheduleFieldFormatSpec = Pe.Shared.RevitData.Schedules.ScheduleFieldFormatSpec;
using SharedScheduleFieldSpec = Pe.Shared.RevitData.Schedules.ScheduleFieldSpec;
using SharedScheduleFilterSpec = Pe.Shared.RevitData.Schedules.ScheduleFilterSpec;
using SharedScheduleProfile = Pe.Shared.RevitData.Schedules.ScheduleProfile;
using SharedScheduleSortGroupSpec = Pe.Shared.RevitData.Schedules.ScheduleSortGroupSpec;
using SharedScheduleTitleBorderSpec = Pe.Shared.RevitData.Schedules.ScheduleTitleBorderSpec;
using SharedScheduleTitleStyleSpec = Pe.Shared.RevitData.Schedules.ScheduleTitleStyleSpec;

namespace Pe.Revit.DocumentData.Schedules.Apply;

public static class ScheduleHelper {
    /// <summary>
    ///     Serializes a ViewSchedule into a ScheduleProfile.
    /// </summary>
    public static SharedScheduleProfile SerializeSchedule(ViewSchedule schedule) {
        var def = schedule.Definition;
        var category = Category.GetCategory(schedule.Document, def.CategoryId);

        var profile = new SharedScheduleProfile(
            schedule.Name,
            category == null
                ? BuiltInCategory.INVALID.ToString()
                : RevitLabelCatalog.GetLabelForBuiltInCategory(category.BuiltInCategory)
        ) {
            IsItemized = def.IsItemized,
            FilterBySheet = def.IsFilteredBySheet
        };

        // Serialize fields
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var field = def.GetField(i);
            var fieldSpec = SerializeField(field, schedule);
            profile.Fields.Add(fieldSpec);
        }

        // Serialize sort/group fields
        for (var i = 0; i < def.GetSortGroupFieldCount(); i++) {
            var sortGroupField = def.GetSortGroupField(i);
            var sortGroupSpec = SerializeSortGroup(sortGroupField, def);
            profile.SortGroup.Add(sortGroupSpec);
        }

        // Serialize filters
        for (var i = 0; i < def.GetFilterCount(); i++) {
            var filter = def.GetFilter(i);
            var filterSpec = SerializeFilter(filter, def);
            profile.Filters.Add(filterSpec);
        }

        // Serialize header groups (updates field profiles in place).
        HeaderGroupHandler.SerializeHeaderGroups(schedule, profile.Fields);

        // Serialize title style (borders and alignment)
        profile = profile with {
            TitleStyle = SerializeTitleStyle(schedule) ?? profile.TitleStyle,
            ColumnHeaderVerticalAlignment = AuthoredScheduleColumnHeaderStyleApplication.SerializeColumnHeaderVerticalAlignment(schedule) ?? profile.ColumnHeaderVerticalAlignment
        };

        // Serialize view template
        profile = profile with { ViewTemplateName = ScheduleViewTemplateValueDomain.Serialize(schedule) };

        return profile;
    }

    /// <summary>
    ///     Creates a schedule from a ScheduleProfile.
    /// </summary>
    public static ScheduleCreationResult CreateSchedule(Document doc, SharedScheduleProfile profile) {
        var categoryId = ScheduleProfileResolver.ResolveCategoryId(doc, profile);
        var categoryName = ScheduleProfileResolver.GetCategoryDisplayName(profile);

        // Create schedule
        var schedule = ViewSchedule.CreateSchedule(doc, categoryId);
        schedule.Name = GetUniqueScheduleName(doc, profile.Name);

        var result = new ScheduleCreationResult {
            Schedule = schedule,
            ScheduleName = schedule.Name,
            CategoryName = categoryName,
            IsItemized = profile.IsItemized
        };

        // Apply schedule-level settings
        var def = schedule.Definition;
        def.IsItemized = profile.IsItemized;
        def.ClearFields();

        // Apply filter-by-sheet setting
        if (profile.FilterBySheet) {
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
                    $"Category '{categoryName}' does not support filter-by-sheet";
            }
        }

        // Apply fields using tuple aggregation
        foreach (var fieldSpec in profile.Fields.Where(f => f.CalculatedType is null)) {
            var (applied, skipped, warnings) = fieldSpec.ApplyTo(
                schedule,
                def,
                ScheduleFieldNameValueDomain.ResolveSchedulableField,
                ScheduleFieldNameValueDomain.ResolveParameterId);

            if (applied != null) result.AppliedFields.Add(applied);
            if (skipped != null) result.SkippedFields.Add(skipped);
            result.Warnings.AddRange(warnings);
        }

        // Collect calculated field guidance
        foreach (var fieldSpec in profile.Fields.Where(f => f.CalculatedType.HasValue)) {
            var guidance = fieldSpec.GetCalculatedFieldGuidance();
            if (guidance != null) result.SkippedCalculatedFields.Add(guidance);
        }

        // Apply sort/group using tuple aggregation
        def.ClearSortGroupFields();
        foreach (var sortGroupSpec in profile.SortGroup) {
            var (applied, skipped) = sortGroupSpec.ApplyTo(def);
            if (applied != null) result.AppliedSortGroups.Add(applied);
            if (skipped != null) result.SkippedSortGroups.Add(skipped);
        }

        // Apply filters using tuple aggregation
        def.ClearFilters();
        if (profile.Filters.Count > 8) {
            result.Warnings.Add(
                $"Schedule supports maximum 8 filters, found {profile.Filters.Count}. Only first 8 will be applied.");
        }

        foreach (var filterSpec in profile.Filters.Take(8)) {
            var (applied, skipped, warning) = filterSpec.ApplyTo(def);
            if (applied != null) result.AppliedFilters.Add(applied);
            if (skipped != null) result.SkippedFilters.Add(skipped);
            if (warning != null) result.Warnings.Add(warning);
        }

        // Apply header groups
        var (appliedGroups, skippedGroups, headerWarnings) =
            HeaderGroupHandler.ApplyHeaderGroups(schedule, profile.Fields);
        result.AppliedHeaderGroups.AddRange(appliedGroups);
        result.SkippedHeaderGroups.AddRange(skippedGroups);
        result.Warnings.AddRange(headerWarnings);

        // Apply title/header style - must happen before view templates
        var (appliedTitleStyle, titleStyleWarning) = profile.TitleStyle.ApplyTo(schedule);
        if (!appliedTitleStyle && titleStyleWarning != null)
            result.Warnings.Add(titleStyleWarning);

        var (appliedColumnHeaderAlignment, columnHeaderAlignmentWarning) =
            profile.ColumnHeaderVerticalAlignment.ApplyColumnHeaderVerticalAlignmentTo(schedule);
        if (!appliedColumnHeaderAlignment && columnHeaderAlignmentWarning != null)
            result.Warnings.Add(columnHeaderAlignmentWarning);
        else if (columnHeaderAlignmentWarning != null)
            result.Warnings.Add(columnHeaderAlignmentWarning);

        // Apply view template
        var (appliedTemplate, skippedTemplate, templateWarning) =
            ScheduleViewTemplateValueDomain.ApplyTo(schedule, profile.ViewTemplateName);
        result.AppliedViewTemplate = appliedTemplate;
        result.SkippedViewTemplate = skippedTemplate;
        if (templateWarning != null) result.Warnings.Add(templateWarning);

        return result;
    }

    /// <summary>
    ///     Gets all schedule view template names from the document.
    /// </summary>
    public static List<string> GetScheduleViewTemplateNames(Document doc) =>
        ScheduleViewTemplateValueDomain.GetOptions(doc).ToList();

    /// <summary>
    ///     Gets family names that would appear in a schedule with the given filters.
    ///     Uses Revit's native schedule filtering by creating a temporary schedule,
    ///     placing temp instances, and using FilteredElementCollector to identify matches.
    ///     All changes are rolled back - no permanent modifications to the document.
    /// </summary>
    public static List<string> GetFamiliesMatchingFilters(Document doc,
        SharedScheduleProfile profile,
        IEnumerable<Family>? families = null) {
        var matchingFamilies = GetMatchingFamiliesByFilter(doc, profile, families, false);
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
        SharedScheduleProfile profile,
        IEnumerable<Family>? families = null
    ) =>
        GetMatchingFamiliesByFilter(doc, profile, families, true)
            .Select(family => family.Id.Value())
            .Distinct()
            .ToList();

    public static List<long> GetFamilyIdsMatchingFiltersAnyType(
        Document doc,
        SharedScheduleProfile profile,
        IReadOnlyList<TempPlacedSymbolRecord> placements
    ) {
        if (placements.Count == 0)
            return [];

        if (profile.Filters.Count == 0) {
            return placements
                .Select(placement => placement.FamilyId)
                .Distinct()
                .ToList();
        }

        var schedule = CreateMinimalFilterEvaluationSchedule(doc, profile);
        doc.Regenerate();

        var matchingInstanceIds = CollectMatchingPlacedInstanceIds(doc, schedule.Id, placements);
        return MapMatchingInstancesToFamilyIds(placements, matchingInstanceIds);
    }

    private static List<Family> GetMatchingFamiliesByFilter(
        Document doc,
        SharedScheduleProfile profile,
        IEnumerable<Family>? families,
        bool evaluateAllTypes
    ) {
        var categoryId = ScheduleProfileResolver.ResolveCategoryId(doc, profile);

        // Get families to test
        var familiesToTest = families?.ToList() ?? new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(f => f.FamilyCategory?.Id == categoryId)
            .ToList();

        if (familiesToTest.Count == 0)
            return [];

        // If no filters, return all family names
        if (profile.Filters.Count == 0)
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
            var matchingFamilyIds = GetFamilyIdsMatchingFiltersAnyType(doc, profile, placements)
                .ToHashSet();

            return familiesToTest
                .Where(family => matchingFamilyIds.Contains(family.Id.Value()))
                .ToList();
        } finally {
            context.RollBackTransaction();
        }
    }

    internal static ViewSchedule CreateMinimalFilterEvaluationSchedule(Document doc, SharedScheduleProfile sourceSpec) {
        var categoryId = ScheduleProfileResolver.ResolveCategoryId(doc, sourceSpec);

        var schedule = ViewSchedule.CreateSchedule(doc, categoryId);
        schedule.Name = $"_TempFilterEval_{Guid.NewGuid():N}";
        schedule.Definition.IsItemized = true;

        ApplyFilterFieldsAndFilters(schedule, sourceSpec);
        return schedule;
    }

    internal static void ApplyFilterFieldsAndFilters(ViewSchedule schedule, SharedScheduleProfile sourceSpec) {
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

        var schedulableField = ScheduleFieldNameValueDomain.ResolveSchedulableField(
            def,
            doc,
            Pe.Shared.RevitData.ParameterReference.FromName(fieldName));
        if (schedulableField == null)
            return false;

        _ = def.AddField(schedulableField);
        return true;
    }

    private static SharedScheduleFieldSpec SerializeField(ScheduleField field, ViewSchedule schedule) {
        var fieldName = field.GetName();
        var originalParamName = field.HasSchedulableField
            ? field.GetSchedulableField().GetName(schedule.Document)
            : fieldName;

        var spec = new SharedScheduleFieldSpec(fieldName) {
            ColumnHeaderOverride = field.ColumnHeading != originalParamName ? field.ColumnHeading : null,
            IsHidden = field.IsHidden,
            DisplayType = field.DisplayType.ToAuthored(),
            ColumnWidth = field.SheetColumnWidth,
            HorizontalAlignment = field.HorizontalAlignment.ToAuthored(),
            FormatOptions = SerializeFormatOptions(field)
        };

        if (field.IsCalculatedField) {
            var calculatedType = field.FieldType == ScheduleFieldType.Formula
                ? ScheduleAuthoredCalculatedFieldType.Formula
                : ScheduleAuthoredCalculatedFieldType.Percentage;

            var percentageOfField = spec.PercentageOfField;
            if (field.FieldType == ScheduleFieldType.Percentage) {
                var percentageOfId = field.PercentageOf;
                var def = schedule.Definition;
                if (percentageOfId != null && def.IsValidFieldId(percentageOfId)) {
                    var percentageField = def.GetField(percentageOfId);
                    percentageOfField = percentageField.GetName();
                }
            }

            spec = spec with {
                CalculatedType = calculatedType,
                PercentageOfField = percentageOfField
            };
        }

        if (field.IsCombinedParameterField) {
            var combinedParams = field.GetCombinedParameters();
            if (combinedParams is { Count: > 0 }) {
                spec = spec with {
                    CombinedParameters = combinedParams
                        .Select(combinedParam => SerializeCombinedParameter(combinedParam, schedule.Document))
                        .ToList()
                };
            }
        }

        return spec;
    }

    private static SharedScheduleSortGroupSpec SerializeSortGroup(
        ScheduleSortGroupField sortGroupField,
        ScheduleDefinition def) {
        var field = def.GetField(sortGroupField.FieldId);
        return new SharedScheduleSortGroupSpec(field.GetName()) {
            SortOrder = sortGroupField.SortOrder.ToAuthored(),
            ShowHeader = sortGroupField.ShowHeader,
            ShowFooter = sortGroupField.ShowFooter,
            ShowBlankLine = sortGroupField.ShowBlankLine
        };
    }

    private static SharedScheduleFilterSpec SerializeFilter(ScheduleFilter filter, ScheduleDefinition def) {
        var field = def.GetField(filter.FieldId);
        var value = string.Empty;
        if (filter.IsStringValue)
            value = filter.GetStringValue();
        else if (filter.IsIntegerValue)
            value = filter.GetIntegerValue().ToString();
        else if (filter.IsDoubleValue)
            value = filter.GetDoubleValue().ToString(CultureInfo.InvariantCulture);
        else if (filter.IsElementIdValue)
            value = filter.GetElementIdValue().Value().ToString();

        return new SharedScheduleFilterSpec(field.GetName()) {
            FilterType = filter.FilterType.ToAuthored(),
            Value = value
        };
    }

    private static SharedScheduleTitleStyleSpec? SerializeTitleStyle(ViewSchedule schedule) {
        var tableData = schedule.GetTableData();
        var headerSection = tableData.GetSectionData(SectionType.Header);

        if (headerSection == null || headerSection.HideSection ||
            headerSection.NumberOfRows < 1 || headerSection.NumberOfColumns < 1)
            return null;

        var titleRow = headerSection.FirstRowNumber;
        var titleColumn = headerSection.FirstColumnNumber;

        using var cellStyle = headerSection.GetTableCellStyle(titleRow, titleColumn);
        var overrideOptions = cellStyle.GetCellStyleOverrideOptions();

        ScheduleTitleHorizontalAlignment? horizontalAlignment = null;
        if (overrideOptions.HorizontalAlignment) {
            horizontalAlignment = cellStyle.FontHorizontalAlignment switch {
                HorizontalAlignmentStyle.Left => ScheduleTitleHorizontalAlignment.Left,
                HorizontalAlignmentStyle.Center => ScheduleTitleHorizontalAlignment.Center,
                HorizontalAlignmentStyle.Right => ScheduleTitleHorizontalAlignment.Right,
                _ => ScheduleTitleHorizontalAlignment.Center
            };
        }

        string? top = null;
        string? bottom = null;
        string? left = null;
        string? right = null;
        if (overrideOptions.BorderTopLineStyle)
            top = ScheduleLineStyleValueDomain.Serialize(schedule.Document, cellStyle.BorderTopLineStyle);
        if (overrideOptions.BorderBottomLineStyle)
            bottom = ScheduleLineStyleValueDomain.Serialize(schedule.Document, cellStyle.BorderBottomLineStyle);
        if (overrideOptions.BorderLeftLineStyle)
            left = ScheduleLineStyleValueDomain.Serialize(schedule.Document, cellStyle.BorderLeftLineStyle);
        if (overrideOptions.BorderRightLineStyle)
            right = ScheduleLineStyleValueDomain.Serialize(schedule.Document, cellStyle.BorderRightLineStyle);

        var hasBorder = !string.IsNullOrWhiteSpace(top) ||
                        !string.IsNullOrWhiteSpace(bottom) ||
                        !string.IsNullOrWhiteSpace(left) ||
                        !string.IsNullOrWhiteSpace(right);
        if (!horizontalAlignment.HasValue && !hasBorder)
            return null;

        var titleStyle = new SharedScheduleTitleStyleSpec {
            BorderStyle = hasBorder
                ? new SharedScheduleTitleBorderSpec {
                    TopLineStyleName = top,
                    BottomLineStyleName = bottom,
                    LeftLineStyleName = left,
                    RightLineStyleName = right
                }
                : null
        };

        return horizontalAlignment.HasValue
            ? titleStyle with { HorizontalAlignment = horizontalAlignment.Value }
            : titleStyle;
    }

    private static SharedScheduleFieldFormatSpec? SerializeFormatOptions(ScheduleField field) {
        try {
            var formatOptions = field.GetFormatOptions();
            if (formatOptions == null || formatOptions.UseDefault)
                return null;

            string? symbolTypeId = null;
            if (formatOptions.CanHaveSymbol()) {
                var symbolId = formatOptions.GetSymbolTypeId();
                if (symbolId != null && !symbolId.Empty())
                    symbolTypeId = ScheduleFieldFormatValueDomain.SerializeSymbol(symbolId);
            }

            return new SharedScheduleFieldFormatSpec {
                UnitTypeId = ScheduleFieldFormatValueDomain.SerializeUnit(formatOptions.GetUnitTypeId()),
                SymbolTypeId = symbolTypeId,
                Accuracy = formatOptions.Accuracy,
                SuppressTrailingZeros = formatOptions.SuppressTrailingZeros,
                SuppressLeadingZeros = formatOptions.SuppressLeadingZeros,
                UsePlusPrefix = formatOptions.UsePlusPrefix,
                UseDigitGrouping = formatOptions.UseDigitGrouping,
                SuppressSpaces = formatOptions.SuppressSpaces
            };
        } catch {
            return null;
        }
    }

    private static SharedCombinedParameterSpec SerializeCombinedParameter(
        TableCellCombinedParameterData combinedParam,
        Document doc) =>
        new() {
            Parameter = ScheduleFieldNameValueDomain.SerializeParameter(doc, combinedParam.ParamId),
            Prefix = combinedParam.Prefix,
            Suffix = combinedParam.Suffix,
            Separator = combinedParam.Separator
        };

    #region Common Helpers

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


    #endregion
}

