using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData.Schedules;

/// <summary>
///     Contracts for synthetic data tables: key schedules on a dummy category whose rows are
///     abstract key elements populated from a fixed shared-parameter column pool. Rows carry a
///     stable key (the Revit key name) and real element handles, so cells stay addressable by
///     parameter-links and external UIs while remaining freely editable in Revit's schedule editor.
/// </summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum DataTableColumnKind {
    Text,
    Number
}

public record DataTableColumnSpec(string Heading) {
    public DataTableColumnKind Kind { get; init; } = DataTableColumnKind.Text;

    /// <summary>Sheet column width in feet. Null keeps the Revit default.</summary>
    public double? ColumnWidth { get; init; }
}

public record DataTableRowSpec(string Key) {
    /// <summary>
    ///     Cell values aligned to the table's column order. Numbers are invariant-culture strings.
    ///     Null clears the cell; a shorter list leaves trailing cells untouched.
    /// </summary>
    public List<string?> Values { get; init; } = [];
}

public record DataTableSpec(string Name) {
    public List<DataTableColumnSpec> Columns { get; init; } = [];
    public List<DataTableRowSpec> Rows { get; init; } = [];

    /// <summary>Show the key column in the rendered table. Hidden by default.</summary>
    public bool ShowKeyColumn { get; init; }

    /// <summary>Delete existing rows whose key is absent from <see cref="Rows" />.</summary>
    public bool PruneMissingRows { get; init; }
}

public record ScheduleSheetPlacementSpec(string Sheet) {
    /// <summary>Placement origin on the sheet in feet. Defaults to (1, 1).</summary>
    public double? OriginX { get; init; }
    public double? OriginY { get; init; }
}

public record ScheduleApplyRequest {
    /// <summary>Synthetic data-table lane. Exactly one of Table or Profile must be set.</summary>
    public DataTableSpec? Table { get; init; }

    /// <summary>Plain authored-schedule lane (create-only, from a schedule profile).</summary>
    public ScheduleProfile? Profile { get; init; }

    /// <summary>Optionally place the resulting schedule on a sheet.</summary>
    public ScheduleSheetPlacementSpec? Placement { get; init; }

    /// <summary>Run every step in a transaction that is rolled back. Returned handles are discarded ids.</summary>
    public bool DryRun { get; init; }
}

public record DataTableColumnHandle(
    string Heading,
    DataTableColumnKind Kind,
    string ParameterName,
    string SharedParameterGuid
);

public record DataTableRowHandle(string Key, long ElementId, string UniqueId) {
    public List<string?> Values { get; init; } = [];
}

public record DataTablePlacementHandle(long SheetId, string SheetNumber, string SheetName);

public record DataTableHandle(string Name, long ScheduleId, string ScheduleUniqueId) {
    public List<DataTableColumnHandle> Columns { get; init; } = [];
    public List<DataTableRowHandle> Rows { get; init; } = [];
    public List<DataTablePlacementHandle> Placements { get; init; } = [];
}

public record ScheduleApplyProfileSummary(string ScheduleName, long ScheduleId, string ScheduleUniqueId) {
    public List<string> AppliedFields { get; init; } = [];
    public List<string> SkippedFields { get; init; } = [];
}

public record ScheduleApplyData {
    public bool DryRun { get; init; }
    public DataTableHandle? Table { get; init; }
    public ScheduleApplyProfileSummary? Profile { get; init; }
    public DataTablePlacementHandle? Placement { get; init; }
    public List<string> Warnings { get; init; } = [];
}

public record DataTableDetailRequest {
    /// <summary>Exact table (schedule) names to read. Empty reads every data table in the document.</summary>
    public List<string> Names { get; init; } = [];
}

public record DataTableDetailData {
    public List<DataTableHandle> Tables { get; init; } = [];
    public List<RevitDataIssue> Issues { get; init; } = [];
}
