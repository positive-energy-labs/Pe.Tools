namespace Pe.Revit.DocumentData.Schedules.Runtime;

public class ScheduleCreationResult {
    public required ViewSchedule Schedule { get; init; }
    public string ScheduleName { get; init; } = string.Empty;
    public string CategoryName { get; init; } = string.Empty;
    public bool IsItemized { get; init; }
    public bool FilterBySheetApplied { get; set; }
    public string? FilterBySheetSkipped { get; set; }

    public List<AppliedFieldInfo> AppliedFields { get; init; } = [];
    public List<string> SkippedFields { get; init; } = [];

    public List<AppliedSortGroupInfo> AppliedSortGroups { get; init; } = [];
    public List<string> SkippedSortGroups { get; init; } = [];

    public List<AppliedFilterInfo> AppliedFilters { get; init; } = [];
    public List<string> SkippedFilters { get; init; } = [];

    public List<string> AppliedHeaderGroups { get; init; } = [];
    public List<string> SkippedHeaderGroups { get; init; } = [];

    public List<CalculatedFieldGuidance> SkippedCalculatedFields { get; init; } = [];
    public List<string> Warnings { get; init; } = [];

    public string? AppliedViewTemplate { get; set; }
    public string? SkippedViewTemplate { get; set; }
}

public class AppliedFieldInfo {
    public string ParameterName { get; init; } = string.Empty;
    public string ColumnHeaderOverride { get; init; } = string.Empty;
    public bool IsHidden { get; init; }
    public double? ColumnWidth { get; init; }
    public ScheduleFieldDisplayType DisplayType { get; init; }
    public ScheduleHorizontalAlignment HorizontalAlignment { get; init; }
}

public class AppliedSortGroupInfo {
    public string FieldName { get; init; } = string.Empty;
    public ScheduleSortOrder SortOrder { get; init; }
    public bool ShowHeader { get; init; }
    public bool ShowFooter { get; init; }
    public bool ShowBlankLine { get; init; }
}

public class AppliedFilterInfo {
    public string FieldName { get; init; } = string.Empty;
    public ScheduleFilterType FilterType { get; init; }
    public string Value { get; init; } = string.Empty;
    public string StorageType { get; init; } = string.Empty;
}

public record CalculatedFieldGuidance {
    public string FieldName { get; init; } = string.Empty;
    public string CalculatedType { get; init; } = string.Empty;
    public string? Guidance { get; init; }
    public string? PercentageOfField { get; init; }
}
