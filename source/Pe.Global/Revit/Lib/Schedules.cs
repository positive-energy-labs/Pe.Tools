using Autodesk.Revit.DB.Structure;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Global.PolyFill;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;
using System.Globalization;

namespace Pe.Global.Revit.Lib;


public static class ScheduleHelper {
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
            var fieldName = field.GetName();

            // Get the original parameter name from the SchedulableField to properly detect header overrides.
            // ScheduleField.GetName() returns the field name which may match ColumnHeading even when customized.
            // We need the original parameter name to correctly detect if ColumnHeading was changed from default.
            var originalParamName = field.HasSchedulableField
                ? field.GetSchedulableField().GetName(schedule.Document)
                : fieldName;

            var fieldSpec = new ScheduleFieldSpec {
                ParameterName = fieldName,
                ColumnHeaderOverride = field.ColumnHeading != originalParamName ? field.ColumnHeading : string.Empty,
                IsHidden = field.IsHidden,
                DisplayType = (ScheduleFieldDisplayType)(int)field.DisplayType,
                ColumnWidth = field.SheetColumnWidth,
                HorizontalAlignment = field.HorizontalAlignment
            };

            // Handle calculated fields
            if (field.IsCalculatedField) {
                fieldSpec.CalculatedType = field.FieldType == ScheduleFieldType.Formula
                    ? CalculatedFieldType.Formula
                    : CalculatedFieldType.Percentage;

                // For percentage fields, capture the field it's based on
                if (field.FieldType == ScheduleFieldType.Percentage) {
                    var percentageOfId = field.PercentageOf;
                    if (percentageOfId != null && def.IsValidFieldId(percentageOfId)) {
                        var percentageOfField = def.GetField(percentageOfId);
                        fieldSpec.PercentageOfField = percentageOfField.GetName();
                    }
                }
            }

            // Serialize format options
            fieldSpec.FormatOptions = SerializeFieldFormatOptions(field);

            spec.Fields.Add(fieldSpec);
        }

        // Serialize sort/group fields
        for (var i = 0; i < def.GetSortGroupFieldCount(); i++) {
            var sortGroupField = def.GetSortGroupField(i);
            var field = def.GetField(sortGroupField.FieldId);
            var fieldName = field.GetName();

            var sortGroupSpec = new ScheduleSortGroupSpec {
                FieldName = fieldName,
                SortOrder = sortGroupField.SortOrder == ScheduleSortOrder.Ascending
                    ? ScheduleSortOrder.Ascending
                    : ScheduleSortOrder.Descending,
                ShowHeader = sortGroupField.ShowHeader,
                ShowFooter = sortGroupField.ShowFooter,
                ShowBlankLine = sortGroupField.ShowBlankLine
            };

            spec.SortGroup.Add(sortGroupSpec);
        }

        // Serialize filters
        for (var i = 0; i < def.GetFilterCount(); i++) {
            var filter = def.GetFilter(i);
            var field = def.GetField(filter.FieldId);
            var fieldName = field.GetName();

            // Extract value as string based on type
            var value = string.Empty;
            if (filter.IsStringValue)
                value = filter.GetStringValue();
            else if (filter.IsIntegerValue)
                value = filter.GetIntegerValue().ToString();
            else if (filter.IsDoubleValue)
                value = filter.GetDoubleValue().ToString(CultureInfo.InvariantCulture);
            else if (filter.IsElementIdValue) value = filter.GetElementIdValue().Value().ToString();

            var filterSpec =
                new ScheduleFilterSpec { FieldName = fieldName, FilterType = filter.FilterType, Value = value };

            // Leave Value null for HasParameter, HasValue, HasNoValue filters

            spec.Filters.Add(filterSpec);
        }

        // Serialize header groups using TableData
        SerializeHeaderGroups(schedule, spec);

        // Serialize view template
        SerializeViewTemplate(schedule, spec);

        return spec;
    }

    private static void SerializeViewTemplate(ViewSchedule schedule, ScheduleSpec spec) {
        var templateId = schedule.ViewTemplateId;
        if (templateId == ElementId.InvalidElementId) return;

        var template = schedule.Document.GetElement(templateId) as View;
        if (template != null)
            spec.ViewTemplateName = template.Name;
    }

    private static ScheduleFieldFormatSpec? SerializeFieldFormatOptions(ScheduleField field) {
        try {
            var formatOptions = field.GetFormatOptions();
            if (formatOptions == null) return null;

            // If using defaults, just return a simple spec indicating that
            if (formatOptions.UseDefault)
                return new ScheduleFieldFormatSpec { UseDefault = true };

            var spec = new ScheduleFieldFormatSpec {
                UseDefault = false,
                UnitTypeId = formatOptions.GetUnitTypeId()?.TypeId,
                Accuracy = formatOptions.Accuracy,
                SuppressTrailingZeros = formatOptions.SuppressTrailingZeros,
                SuppressLeadingZeros = formatOptions.SuppressLeadingZeros,
                UsePlusPrefix = formatOptions.UsePlusPrefix,
                UseDigitGrouping = formatOptions.UseDigitGrouping,
                SuppressSpaces = formatOptions.SuppressSpaces,
            };

            // Get symbol if available
            if (formatOptions.CanHaveSymbol()) {
                var symbolId = formatOptions.GetSymbolTypeId();
                if (symbolId != null && !symbolId.Empty())
                    spec.SymbolTypeId = symbolId.TypeId;
            }

            return spec;
        } catch {
            // Field may not support format options (e.g., text fields)
            return null;
        }
    }

    private static void SerializeHeaderGroups(ViewSchedule schedule, ScheduleSpec spec) {
        var tableData = schedule.GetTableData();
        var bodySection = tableData.GetSectionData(SectionType.Body);

        if (bodySection == null) return;

        var def = schedule.Definition;

        // Build mapping from visible column index to field index (accounting for hidden fields)
        var visibleColToFieldIdx = new Dictionary<int, int>();
        var visibleColIndex = 0;

        for (var fieldIdx = 0; fieldIdx < def.GetFieldCount(); fieldIdx++) {
            var field = def.GetField(fieldIdx);
            if (!field.IsHidden) {
                visibleColToFieldIdx[visibleColIndex] = fieldIdx;
                visibleColIndex++;
            }
        }

        // Header groups are stored as merged cells in the first row of the Body section
        if (bodySection.NumberOfRows == 0) return;

        var firstRow = bodySection.FirstRowNumber;
        var processedColumns = new HashSet<int>();

        for (var col = bodySection.FirstColumnNumber; col <= bodySection.LastColumnNumber; col++) {
            if (processedColumns.Contains(col)) continue;

            var mergedCell = bodySection.GetMergedCell(firstRow, col);

            // If the merged cell spans multiple columns (horizontally), it's a header group
            if (mergedCell.Right > mergedCell.Left) {
                var groupName = bodySection.GetCellText(firstRow, col);

                // Mark all fields in this range with the header group
                for (var tableCol = mergedCell.Left; tableCol <= mergedCell.Right; tableCol++) {
                    var visibleCol = tableCol - bodySection.FirstColumnNumber;
                    if (visibleColToFieldIdx.TryGetValue(visibleCol, out var fieldIdx) && fieldIdx < spec.Fields.Count)
                        spec.Fields[fieldIdx].HeaderGroup = groupName;
                    _ = processedColumns.Add(tableCol);
                }
            } else {
                _ = processedColumns.Add(col);
            }
        }
    }

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
        schedule.Definition.IsItemized = spec.IsItemized;

        // Apply fields and collect calculated field info
        ApplyFieldsToSchedule(schedule, spec, result);

        // Apply sort/group
        ApplySortGroupToSchedule(schedule, spec, result);

        // Apply filters
        ApplyFiltersToSchedule(schedule, spec, result);

        // Apply header groups
        ApplyHeaderGroups(schedule, spec, result);

        // Apply view template
        ApplyViewTemplate(schedule, spec, result);

        return result;
    }

    private static void ApplyViewTemplate(ViewSchedule schedule, ScheduleSpec spec, ScheduleCreationResult result) {
        if (string.IsNullOrWhiteSpace(spec.ViewTemplateName)) return;

        var templateId = FindScheduleViewTemplateByName(schedule.Document, spec.ViewTemplateName);
        if (templateId == ElementId.InvalidElementId) {
            result.SkippedViewTemplate = $"View template '{spec.ViewTemplateName}' not found";
            result.Warnings.Add($"View template '{spec.ViewTemplateName}' not found in document");
            return;
        }

        if (!schedule.IsValidViewTemplate(templateId)) {
            result.SkippedViewTemplate = $"View template '{spec.ViewTemplateName}' is not valid for schedules";
            result.Warnings.Add($"View template '{spec.ViewTemplateName}' is not compatible with this schedule");
            return;
        }

        try {
            schedule.ViewTemplateId = templateId;
            result.AppliedViewTemplate = spec.ViewTemplateName;
        } catch (Exception ex) {
            result.SkippedViewTemplate = $"Failed to apply: {ex.Message}";
            result.Warnings.Add($"Failed to apply view template '{spec.ViewTemplateName}': {ex.Message}");
        }
    }

    /// <summary>
    ///     Finds a schedule view template by name.
    /// </summary>
    private static ElementId FindScheduleViewTemplateByName(Document doc, string templateName) {
        var templates = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<View>()
            .Where(v => v.IsTemplate && v.Name.Equals(templateName, StringComparison.OrdinalIgnoreCase))
            .ToList();

        return templates.Count > 0 ? templates[0].Id : ElementId.InvalidElementId;
    }

    /// <summary>
    ///     Gets all schedule view template names from the document.
    /// </summary>
    public static List<string> GetScheduleViewTemplateNames(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<View>()
            .Where(v => v.IsTemplate)
            .Select(v => v.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name)
            .ToList();

    private static string GetUniqueScheduleName(Document doc, string baseName) {
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

    private static void ApplyFieldsToSchedule(ViewSchedule schedule, ScheduleSpec spec, ScheduleCreationResult result) {
        var def = schedule.Definition;
        def.ClearFields();

        // Add non-calculated fields only - the Revit API does not support creating calculated fields
        // (Formula/Percentage fields must be recreated manually in Revit)
        foreach (var fieldSpec in spec.Fields.Where(f => f.CalculatedType is null)) {
            var schedulableField = FindSchedulableField(def, schedule.Document, fieldSpec.ParameterName);
            if (schedulableField is null) {
                result.SkippedFields.Add($"Parameter '{fieldSpec.ParameterName}' not found");
                continue;
            }

            var field = def.AddField(schedulableField);
            ApplyFieldProperties(field, fieldSpec, result);

            result.AppliedFields.Add(new AppliedFieldInfo {
                ParameterName = fieldSpec.ParameterName,
                ColumnHeaderOverride = fieldSpec.ColumnHeaderOverride,
                IsHidden = fieldSpec.IsHidden,
                ColumnWidth = fieldSpec.ColumnWidth,
                DisplayType = fieldSpec.DisplayType,
                HorizontalAlignment = fieldSpec.HorizontalAlignment
            });
        }

        // Collect calculated field guidance
        var calculatedFields = spec.Fields.Where(f => f.CalculatedType is not null).ToList();

        foreach (var fieldSpec in calculatedFields) {
            var guidance = new CalculatedFieldGuidance {
                FieldName = fieldSpec.ParameterName,
                CalculatedType = fieldSpec.CalculatedType.ToString() ?? string.Empty
            };

            if (fieldSpec.CalculatedType == CalculatedFieldType.Formula) {
                guidance.Guidance = "Add a calculated field of type 'Formula' in the schedule. " +
                                    "The formula must be entered manually in Revit (API limitation).";
            } else if (fieldSpec.CalculatedType == CalculatedFieldType.Percentage) {
                guidance.Guidance =
                    $"Add a calculated field of type 'Percentage' based on field '{fieldSpec.PercentageOfField ?? "(unknown)"}'.";
                guidance.PercentageOfField = fieldSpec.PercentageOfField;
            }

            result.SkippedCalculatedFields.Add(guidance);
        }
    }

    private static void ApplyFieldProperties(ScheduleField field,
        ScheduleFieldSpec fieldSpec,
        ScheduleCreationResult result) {
        if (!string.IsNullOrEmpty(fieldSpec.ColumnHeaderOverride)) field.ColumnHeading = fieldSpec.ColumnHeaderOverride;

        field.IsHidden = fieldSpec.IsHidden;

        // Apply column width if specified
        if (fieldSpec.ColumnWidth > 0)
            field.SheetColumnWidth = fieldSpec.ColumnWidth ?? 1;

        // Apply horizontal alignment
        field.HorizontalAlignment = fieldSpec.HorizontalAlignment;

        // Apply display type if field supports it (cast to int for comparison since enum member names vary)
        var targetDisplayType = (ScheduleFieldDisplayType)(int)fieldSpec.DisplayType;
        if (fieldSpec.DisplayType != ScheduleFieldDisplayType.Standard) {
            var canApply = fieldSpec.DisplayType switch {
                ScheduleFieldDisplayType.Totals => field.CanTotal(),
                ScheduleFieldDisplayType.Max or ScheduleFieldDisplayType.Min or ScheduleFieldDisplayType.MinMax =>
                    field.CanDisplayMinMax(),
                _ => false
            };

            if (canApply)
                field.DisplayType = targetDisplayType;
            else {
                result.Warnings.Add(
                    $"DisplayType '{fieldSpec.DisplayType}' not supported for field '{fieldSpec.ParameterName}'");
            }
        }

        // Apply format options
        ApplyFieldFormatOptions(field, fieldSpec, result);
    }

    private static void ApplyFieldFormatOptions(
        ScheduleField field,
        ScheduleFieldSpec fieldSpec,
        ScheduleCreationResult result) {
        if (fieldSpec.FormatOptions == null) return;

        var formatSpec = fieldSpec.FormatOptions;

        // If using defaults, just set UseDefault to true
        if (formatSpec.UseDefault) {
            try {
                var formatOptions = new FormatOptions { UseDefault = true };
                field.SetFormatOptions(formatOptions);
            } catch {
                // Field may not support format options
            }

            return;
        }

        try {
            // Create custom format options
            FormatOptions formatOptions;

            if (!string.IsNullOrEmpty(formatSpec.UnitTypeId)) {
                var unitTypeId = new ForgeTypeId(formatSpec.UnitTypeId);
                formatOptions = new FormatOptions(unitTypeId);
            } else {
                formatOptions = new FormatOptions { UseDefault = false };
            }

            // Apply accuracy if specified
            if (formatSpec.Accuracy.HasValue && formatOptions.IsValidAccuracy(formatSpec.Accuracy.Value))
                formatOptions.Accuracy = formatSpec.Accuracy.Value;

            // Apply symbol if specified
            if (!string.IsNullOrEmpty(formatSpec.SymbolTypeId) && formatOptions.CanHaveSymbol()) {
                var symbolTypeId = new ForgeTypeId(formatSpec.SymbolTypeId);
                if (formatOptions.IsValidSymbol(symbolTypeId))
                    formatOptions.SetSymbolTypeId(symbolTypeId);
            }

            // Apply boolean options where supported
            if (formatOptions.CanSuppressTrailingZeros())
                formatOptions.SuppressTrailingZeros = formatSpec.SuppressTrailingZeros;

            if (formatOptions.CanSuppressLeadingZeros())
                formatOptions.SuppressLeadingZeros = formatSpec.SuppressLeadingZeros;

            if (formatOptions.CanUsePlusPrefix())
                formatOptions.UsePlusPrefix = formatSpec.UsePlusPrefix;

            formatOptions.UseDigitGrouping = formatSpec.UseDigitGrouping;

            if (formatOptions.CanSuppressSpaces())
                formatOptions.SuppressSpaces = formatSpec.SuppressSpaces;

            field.SetFormatOptions(formatOptions);
        } catch (Exception ex) {
            result.Warnings.Add($"Failed to apply format options for field '{fieldSpec.ParameterName}': {ex.Message}");
        }
    }

    private static void ApplySortGroupToSchedule(ViewSchedule schedule,
        ScheduleSpec spec,
        ScheduleCreationResult result) {
        var def = schedule.Definition;
        def.ClearSortGroupFields();

        if (spec.SortGroup.Count == 0) return;

        foreach (var sortGroupSpec in spec.SortGroup) {
            // Find the field by name
            ScheduleFieldId? fieldId = null;
            for (var i = 0; i < def.GetFieldCount(); i++) {
                var field = def.GetField(i);
                if (field.GetName() == sortGroupSpec.FieldName) {
                    fieldId = field.FieldId;
                    break;
                }
            }

            if (fieldId == null) {
                result.SkippedSortGroups.Add($"Field '{sortGroupSpec.FieldName}' not found");
                continue;
            }

            var sortGroupField = new ScheduleSortGroupField(fieldId, sortGroupSpec.SortOrder) {
                ShowHeader = sortGroupSpec.ShowHeader,
                ShowFooter = sortGroupSpec.ShowFooter,
                ShowBlankLine = sortGroupSpec.ShowBlankLine
            };

            def.AddSortGroupField(sortGroupField);

            result.AppliedSortGroups.Add(new AppliedSortGroupInfo {
                FieldName = sortGroupSpec.FieldName,
                SortOrder = sortGroupSpec.SortOrder,
                ShowHeader = sortGroupSpec.ShowHeader,
                ShowFooter = sortGroupSpec.ShowFooter,
                ShowBlankLine = sortGroupSpec.ShowBlankLine
            });
        }
    }

    private static void ApplyFiltersToSchedule(
            ViewSchedule schedule,
            ScheduleSpec spec,
            ScheduleCreationResult result
            ) {
        var def = schedule.Definition;
        def.ClearFilters();

        switch (spec.Filters.Count) {
        case 0:
            return;
        // Maximum of 8 filters per schedule
        case > 8:
            result.Warnings.Add(
                $"Schedule supports maximum 8 filters, found {spec.Filters.Count}. Only first 8 will be applied.");
            break;
        }

        var filtersToApply = spec.Filters.Take(8);

        foreach (var filterSpec in filtersToApply) {
            // Find the field by name
            ScheduleField? field = null;
            for (var i = 0; i < def.GetFieldCount(); i++) {
                var f = def.GetField(i);
                if (f.GetName() == filterSpec.FieldName) {
                    field = f;
                    break;
                }
            }

            if (field == null) {
                result.SkippedFilters.Add($"Field '{filterSpec.FieldName}' not found");
                continue;
            }

            try {
                ScheduleFilter filter;
                string storageTypeStr;

                // Filters that don't require a value
                if (string.IsNullOrEmpty(filterSpec.Value)) {
                    filter = new ScheduleFilter(field.FieldId, filterSpec.FilterType);
                    storageTypeStr = "None";
                } else {
                    // Use SpecStorageTypeResolver to determine the correct type and constructor
                    var specTypeId = field.GetSpecTypeId();
                    var storageType = SpecStorageTypeResolver.GetStorageType(specTypeId);

                    if (storageType == StorageType.Integer && int.TryParse(filterSpec.Value, out var intValue)) {
                        filter = new ScheduleFilter(field.FieldId, filterSpec.FilterType, intValue);
                        storageTypeStr = "Integer";
                    } else if (storageType == StorageType.Double &&
                               double.TryParse(filterSpec.Value, out var doubleValue)) {
                        filter = new ScheduleFilter(field.FieldId, filterSpec.FilterType, doubleValue);
                        storageTypeStr = "Double";
                    } else if (storageType == StorageType.ElementId &&
                               int.TryParse(filterSpec.Value, out var elementIdValue)) {
                        var elementId = new ElementId(elementIdValue);
                        filter = new ScheduleFilter(field.FieldId, filterSpec.FilterType, elementId);
                        storageTypeStr = "ElementId";
                    } else {
                        // Default to string for text parameters or StorageType.String/unhandled types
                        filter = new ScheduleFilter(field.FieldId, filterSpec.FilterType, filterSpec.Value);
                        storageTypeStr = "String";
                    }
                }

                def.AddFilter(filter);

                result.AppliedFilters.Add(new AppliedFilterInfo {
                    FieldName = filterSpec.FieldName,
                    FilterType = filterSpec.FilterType,
                    Value = filterSpec.Value,
                    StorageType = storageTypeStr
                });
            } catch (Exception ex) {
                result.Warnings.Add($"Failed to apply filter on field '{filterSpec.FieldName}': {ex.Message}");
            }
        }
    }

    private static ElementId FindCategoryByName(Document doc, string categoryName) {
        var categories = doc.Settings.Categories;
        foreach (Category cat in categories) {
            if (cat.Name.Equals(categoryName, StringComparison.OrdinalIgnoreCase))
                return cat.Id;
        }

        return ElementId.InvalidElementId;
    }

    private static SchedulableField? FindSchedulableField(ScheduleDefinition def, Document doc, string parameterName) {
        var schedulableFields = def.GetSchedulableFields();
        foreach (var sf in schedulableFields) {
            var name = sf.GetName(doc);
            if (name.Equals(parameterName, StringComparison.OrdinalIgnoreCase)) return sf;
        }

        return null;
    }

    private static void ApplyHeaderGroups(ViewSchedule schedule, ScheduleSpec spec, ScheduleCreationResult result) {
        var def = schedule.Definition;

        // Build a mapping from field spec to actual column index
        var fieldIndexMap = new Dictionary<string, int>();
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var field = def.GetField(i);
            fieldIndexMap[field.GetName()] = i;
        }

        // Group consecutive fields by HeaderGroup
        var groupRanges = new List<(string GroupName, int StartIdx, int EndIdx)>();
        string? currentGroup = null;
        int? groupStart = null;

        for (var i = 0; i < spec.Fields.Count; i++) {
            var fieldSpec = spec.Fields[i];

            // Skip calculated fields (they weren't added)
            if (fieldSpec.CalculatedType.HasValue) continue;

            // Skip if field wasn't actually added to schedule
            if (!fieldIndexMap.TryGetValue(fieldSpec.ParameterName, out var columnIdx)) continue;

            var headerGroup = fieldSpec.HeaderGroup;

            if (!string.IsNullOrEmpty(headerGroup)) {
                if (headerGroup == currentGroup) {
                    // Continue current group
                    continue;
                }

                // Start new group or finish previous
                if (currentGroup != null && groupStart.HasValue) {
                    // Find the last column index of the previous group
                    var prevEndIdx = columnIdx - 1;
                    if (prevEndIdx >= groupStart.Value)
                        groupRanges.Add((currentGroup, groupStart.Value, prevEndIdx));
                }

                currentGroup = headerGroup;
                groupStart = columnIdx;
            } else {
                // No header group - finish previous group if any
                if (currentGroup != null && groupStart.HasValue) {
                    var prevEndIdx = columnIdx - 1;
                    if (prevEndIdx >= groupStart.Value)
                        groupRanges.Add((currentGroup, groupStart.Value, prevEndIdx));
                }

                currentGroup = null;
                groupStart = null;
            }
        }

        // Handle final group if it extends to the end
        if (currentGroup != null && groupStart.HasValue) {
            var lastIdx = def.GetFieldCount() - 1;
            if (lastIdx >= groupStart.Value)
                groupRanges.Add((currentGroup, groupStart.Value, lastIdx));
        }

        // Apply header groups
        foreach (var (groupName, startIdx, endIdx) in groupRanges) {
            if (startIdx < endIdx) {
                // Only group if there are at least 2 columns
                try {
                    schedule.GroupHeaders(0, startIdx, 0, endIdx, groupName);
                    var groupInfo = $"{groupName} (columns {startIdx + 1}-{endIdx + 1})";
                    result.AppliedHeaderGroups.Add(groupInfo);
                } catch (Exception ex) {
                    result.Warnings.Add($"Failed to apply header group '{groupName}': {ex.Message}");
                }
            } else
                result.SkippedHeaderGroups.Add($"{groupName} (only 1 column)");
        }
    }

    /// <summary>
    ///     Gets family names that would appear in a schedule with the given filters.
    ///     Uses Revit's native schedule filtering by creating a temporary schedule,
    ///     placing temp instances, and using FilteredElementCollector to identify matches.
    ///     All changes are rolled back - no permanent modifications to the document.
    /// </summary>
    /// <param name="doc">The Revit document</param>
    /// <param name="spec">The schedule specification with filters</param>
    /// <param name="families">Optional list of families to test. If null, uses all families of the category.</param>
    /// <returns>List of family names that pass all schedule filters</returns>
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
}