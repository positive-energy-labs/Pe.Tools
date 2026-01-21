using System.ComponentModel;
using System.Text.Json.Serialization;

namespace Pe.Global.Revit.Lib.Schedules.SortGroup;

public class ScheduleSortGroupSpec {
    [Description("The field name to sort/group by.")]
    public string FieldName { get; init; } = string.Empty;

    [Description("Sort direction (Ascending or Descending).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleSortOrder SortOrder { get; init; } = ScheduleSortOrder.Ascending;

    [Description("Whether to display a header row when this grouping changes.")]
    public bool ShowHeader { get; init; }

    [Description("Whether to display a footer row with totals when this grouping changes.")]
    public bool ShowFooter { get; init; }

    [Description("Whether to insert a blank line when this grouping changes.")]
    public bool ShowBlankLine { get; init; }

    /// <summary>
    ///     Serializes a ScheduleSortGroupField into a ScheduleSortGroupSpec.
    /// </summary>
    public static ScheduleSortGroupSpec SerializeFrom(ScheduleSortGroupField sortGroupField, ScheduleDefinition def) {
        var field = def.GetField(sortGroupField.FieldId);
        return new ScheduleSortGroupSpec {
            FieldName = field.GetName(),
            SortOrder = sortGroupField.SortOrder == ScheduleSortOrder.Ascending
                ? ScheduleSortOrder.Ascending
                : ScheduleSortOrder.Descending,
            ShowHeader = sortGroupField.ShowHeader,
            ShowFooter = sortGroupField.ShowFooter,
            ShowBlankLine = sortGroupField.ShowBlankLine
        };
    }

    /// <summary>
    ///     Applies this sort/group spec to a schedule.
    ///     Returns (applied info, skipped reason) - one will be non-null.
    /// </summary>
    public (AppliedSortGroupInfo? Applied, string? Skipped) ApplyTo(ScheduleDefinition def) {
        // Find the field by name
        ScheduleFieldId? fieldId = null;
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var field = def.GetField(i);
            if (field.GetName() == this.FieldName) {
                fieldId = field.FieldId;
                break;
            }
        }

        if (fieldId == null) return (null, $"Field '{this.FieldName}' not found");

        var sortGroupField = new ScheduleSortGroupField(fieldId, this.SortOrder) {
            ShowHeader = this.ShowHeader, ShowFooter = this.ShowFooter, ShowBlankLine = this.ShowBlankLine
        };

        def.AddSortGroupField(sortGroupField);

        var applied = new AppliedSortGroupInfo {
            FieldName = this.FieldName,
            SortOrder = this.SortOrder,
            ShowHeader = this.ShowHeader,
            ShowFooter = this.ShowFooter,
            ShowBlankLine = this.ShowBlankLine
        };

        return (applied, null);
    }
}