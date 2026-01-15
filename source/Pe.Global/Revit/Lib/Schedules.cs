using Autodesk.Revit.DB.Structure;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Global.PolyFill;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;

namespace Pe.Global.Revit.Lib;

public class ScheduleSpec {
    [Description("The name of the schedule as it will appear in the project browser.")]
    public string Name { get; set; } = string.Empty;

    [Description("The Revit category to schedule (e.g., 'Mechanical Equipment', 'Plumbing Fixtures', 'Doors').")]
    [SchemaExamples(typeof(CategoryNamesProvider))]
    public string CategoryName { get; set; } = string.Empty;

    [Description(
        "Whether the schedule displays each element on a separate row (true) or combines multiple grouped elements onto the same row (false).")]
    public bool IsItemized { get; set; } = true;

    [Description("List of fields (columns) to include in the schedule.")]
    [Includable("fields")]
    public List<ScheduleFieldSpec> Fields { get; set; } = [];

    [Description("List of sort and grouping criteria for organizing schedule rows.")]
    public List<ScheduleSortGroupSpec> SortGroup { get; set; } = [];

    [Description("List of filters to restrict which elements appear in the schedule. Maximum of 8 filters.")]
    public List<ScheduleFilterSpec> Filters { get; set; } = [];
}

public class ScheduleFieldSpec {
    [Description(
        "The parameter name to display in this column (e.g., 'Family and Type', 'Mark', 'PE_M_Fan_FlowRate').")]
    // [SchemaExamples(typeof(SchedulableParameterNamesProvider))]
    public string ParameterName { get; set; } = string.Empty;

    [Description("Custom header text to display instead of the parameter name. Leave empty to use parameter name.")]
    public string ColumnHeaderOverride { get; set; } = string.Empty;

    [Description(
        "Header group name for visually grouping multiple column headers together (e.g., 'Performance', 'Electrical'). Consecutive fields with the same HeaderGroup value will be grouped.")]
    public string HeaderGroup { get; set; } = string.Empty;

    [Description("Whether to hide this column in the schedule while still using it for filtering or sorting.")]
    public bool IsHidden { get; set; }

    [Description("How to calculate aggregate values for this field (Standard, Totals, MinAndMax, Maximum, Minimum).")]
    [JsonConverter(typeof(StringEnumConverter))]
    public ScheduleFieldDisplayType DisplayType { get; set; } = ScheduleFieldDisplayType.Standard;

    [Description("Column width on sheet in feet. Leave empty to use default width.")]
    public double? ColumnWidth { get; set; }

    [Description(
        "For calculated fields only. Indicates this is a formula or percentage field. Note: Formula strings cannot be read/written via Revit API - calculated fields must be created manually in Revit.")]
    [JsonConverter(typeof(StringEnumConverter))]
    public CalculatedFieldType? CalculatedType { get; set; }

    [Description("For Percentage calculated fields only. The name of the field to calculate percentages of.")]
    public string PercentageOfField { get; set; } = string.Empty;
}

/// <summary>
///     Type of calculated field
/// </summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum CalculatedFieldType {
    [Description("A calculated field using a formula expression.")]
    Formula,

    [Description("A calculated field showing percentage of another field.")]
    Percentage
}

public class ScheduleSortGroupSpec {
    [Description("The field name to sort/group by.")]
    // [SchemaExamples(typeof(SchedulableParameterNamesProvider))]
    public string FieldName { get; init; } = string.Empty;

    [Description("Sort direction (Ascending or Descending).")]
    [JsonConverter(typeof(StringEnumConverter))]
    public ScheduleSortOrder SortOrder { get; init; } = ScheduleSortOrder.Ascending;

    [Description("Whether to display a header row when this grouping changes.")]
    public bool ShowHeader { get; init; }

    [Description("Whether to display a footer row with totals when this grouping changes.")]
    public bool ShowFooter { get; init; }

    [Description("Whether to insert a blank line when this grouping changes.")]
    public bool ShowBlankLine { get; init; }
}

public class ScheduleFilterSpec {
    [Description("The field name to filter on.")]
    // [SchemaExamples(typeof(SchedulableParameterNamesProvider))]
    public string FieldName { get; init; } = string.Empty;

    [Description("The type of comparison to perform (Equal, Contains, GreaterThan, etc.).")]
    [JsonConverter(typeof(StringEnumConverter))]
    public ScheduleFilterType FilterType { get; init; } = ScheduleFilterType.Equal;

    [Description(
        "The filter value as a string. Leave empty for HasParameter, HasValue, and HasNoValue filter types. The value will be automatically coerced to the correct type based on the field's parameter type (string, integer, double, or ElementId).")]
    public string Value { get; set; } = string.Empty;
}

public class ScheduleCreationResult {
    public required ViewSchedule Schedule { get; set; }
    public required string ScheduleName { get; set; }
    public required string CategoryName { get; set; }
    public bool IsItemized { get; set; }

    public List<AppliedFieldInfo> AppliedFields { get; set; } = [];
    public List<string> SkippedFields { get; set; } = [];

    public List<AppliedSortGroupInfo> AppliedSortGroups { get; set; } = [];
    public List<string> SkippedSortGroups { get; set; } = [];

    public List<AppliedFilterInfo> AppliedFilters { get; set; } = [];
    public List<string> SkippedFilters { get; set; } = [];

    public List<string> AppliedHeaderGroups { get; set; } = [];
    public List<string> SkippedHeaderGroups { get; set; } = [];

    public List<CalculatedFieldGuidance> SkippedCalculatedFields { get; set; } = [];
    public List<string> Warnings { get; set; } = [];
}

public class AppliedFieldInfo {
    public required string ParameterName { get; set; }
    public required string ColumnHeaderOverride { get; set; }
    public bool IsHidden { get; set; }
    public double? ColumnWidth { get; set; }
    public ScheduleFieldDisplayType DisplayType { get; set; }
}

public class AppliedSortGroupInfo {
    public required string FieldName { get; set; }
    public ScheduleSortOrder SortOrder { get; set; }
    public bool ShowHeader { get; set; }
    public bool ShowFooter { get; set; }
    public bool ShowBlankLine { get; set; }
}

public class AppliedFilterInfo {
    public required string FieldName { get; set; }
    public ScheduleFilterType FilterType { get; set; }
    public required string Value { get; set; }
    public required string StorageType { get; set; }
}

public class CalculatedFieldGuidance {
    public required string FieldName { get; set; }
    public required string CalculatedType { get; set; } // "Formula" or "Percentage"
    public string? Guidance { get; set; }
    public string? PercentageOfField { get; set; } // Only for percentage fields - can be null for non-percentage fields
}

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
                ColumnWidth = field.SheetColumnWidth
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
                value = filter.GetDoubleValue().ToString();
            else if (filter.IsElementIdValue) value = filter.GetElementIdValue().Value().ToString();

            var filterSpec =
                new ScheduleFilterSpec { FieldName = fieldName, FilterType = filter.FilterType, Value = value };

            // Leave Value null for HasParameter, HasValue, HasNoValue filters

            spec.Filters.Add(filterSpec);
        }

        // Serialize header groups using TableData
        SerializeHeaderGroups(schedule, spec);

        return spec;
    }

    private static void SerializeHeaderGroups(ViewSchedule schedule, ScheduleSpec spec) {
        var tableData = schedule.GetTableData();
        var headerSection = tableData.GetSectionData(SectionType.Header);

        if (headerSection == null) return;

        // Check if there are multiple rows (grouped headers would be in row 0)
        if (headerSection.NumberOfRows < 2) return;

        // Build mapping from visible column index to field index (accounting for hidden fields)
        var def = schedule.Definition;
        var visibleColToFieldIdx = new Dictionary<int, int>();
        var visibleColIndex = 0;

        for (var fieldIdx = 0; fieldIdx < def.GetFieldCount(); fieldIdx++) {
            var field = def.GetField(fieldIdx);
            if (!field.IsHidden) {
                visibleColToFieldIdx[visibleColIndex] = fieldIdx;
                visibleColIndex++;
            }
        }

        // Examine the header row (row 0) for merged cells, which indicate header groups
        var groupRow = headerSection.FirstRowNumber;
        var processedColumns = new HashSet<int>();

        for (var col = headerSection.FirstColumnNumber; col <= headerSection.LastColumnNumber; col++) {
            if (processedColumns.Contains(col)) continue;

            // Check if this cell is part of a merged group
            var mergedCell = headerSection.GetMergedCell(groupRow, col);

            // If the merged cell spans multiple columns, it's a header group
            if (mergedCell.Right > mergedCell.Left) {
                var groupName = headerSection.GetCellText(groupRow, col);

                // Mark all fields in this range with the header group
                // Use the mapping to convert visible column indices to field indices
                for (var visibleCol = mergedCell.Left; visibleCol <= mergedCell.Right; visibleCol++) {
                    if (visibleColToFieldIdx.TryGetValue(visibleCol, out var fieldIdx) && fieldIdx < spec.Fields.Count)
                        spec.Fields[fieldIdx].HeaderGroup = groupName;
                    _ = processedColumns.Add(visibleCol);
                }
            } else
                _ = processedColumns.Add(col);
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

        return result;
    }

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
                DisplayType = fieldSpec.DisplayType
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
    }

    private static void ApplySortGroupToSchedule(ViewSchedule schedule,
        ScheduleSpec spec,
        ScheduleCreationResult result) {
        var def = schedule.Definition;
        def.ClearSortGroupFields();

        if (spec.SortGroup == null || spec.SortGroup.Count == 0) return;

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

    private static void
        ApplyFiltersToSchedule(ViewSchedule schedule, ScheduleSpec spec, ScheduleCreationResult result) {
        var def = schedule.Definition;
        def.ClearFilters();

        if (spec.Filters == null || spec.Filters.Count == 0) return;

        // Maximum of 8 filters per schedule
        if (spec.Filters.Count > 8) {
            result.Warnings.Add(
                $"Schedule supports maximum 8 filters, found {spec.Filters.Count}. Only first 8 will be applied.");
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
    ///     Executes an action with a temporary schedule in a rolled-back transaction.
    ///     Creates a minimal temporary schedule for the given category, executes the action,
    ///     then rolls back all changes. No permanent modifications to the document.
    /// </summary>
    /// <param name="doc">The Revit document</param>
    /// <param name="categoryName">The category name for the schedule</param>
    /// <param name="action">Action to execute with the temporary schedule</param>
    /// <typeparam name="T">Return type of the action</typeparam>
    /// <returns>Result from the action</returns>
    public static T WithTemporarySchedule<T>(Document doc, string categoryName, Func<ViewSchedule, T> action) {
        var categoryId = FindCategoryByName(doc, categoryName);
        if (categoryId == ElementId.InvalidElementId)
            throw new ArgumentException($"Category '{categoryName}' not found in document");

        using var tx = new Transaction(doc, "Temp Schedule Query");
        _ = tx.Start();

        try {
            var tempSpec = new ScheduleSpec {
                Name = $"_TempSchedule_{Guid.NewGuid():N}",
                CategoryName = categoryName,
                IsItemized = true,
                Fields = [],
                Filters = [],
                SortGroup = []
            };

            var scheduleResult = CreateSchedule(doc, tempSpec);
            return action(scheduleResult.Schedule);
        } finally {
            if (tx.HasStarted())
                _ = tx.RollBack();
        }
    }

    /// <summary>
    ///     Gets all schedulable parameter names for a given category.
    ///     Creates a temporary schedule to query available fields.
    ///     All changes are rolled back - no permanent modifications to the document.
    /// </summary>
    /// <param name="doc">The Revit document</param>
    /// <param name="categoryName">The category name</param>
    /// <returns>List of schedulable parameter names</returns>
    public static List<string> GetSchedulableParameterNames(Document doc, string categoryName) =>
        WithTemporarySchedule(doc, categoryName, schedule => {
            var def = schedule.Definition;
            var schedulableFields = def.GetSchedulableFields();

            return schedulableFields
                .Select(field => field.GetName(doc))
                .Where(name => !string.IsNullOrEmpty(name))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(name => name)
                .ToList();
        });

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
        if (spec.Filters == null || spec.Filters.Count == 0)
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