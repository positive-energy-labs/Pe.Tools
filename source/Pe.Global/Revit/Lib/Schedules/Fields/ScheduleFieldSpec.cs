using System.ComponentModel;
using System.Text.Json.Serialization;

namespace Pe.Global.Revit.Lib.Schedules.Fields;

public class ScheduleFieldSpec {
    [Description(
        "The parameter name to display in this column (e.g., 'Family and Type', 'Mark', 'PE_M_Fan_FlowRate').")]
    public string ParameterName { get; set; } = string.Empty;

    [Description("Custom header text to display instead of the parameter name. Leave empty to use parameter name.")]
    public string ColumnHeaderOverride { get; set; } = string.Empty;

    [Description(
        "Header group name for visually grouping multiple column headers together (e.g., 'Performance', 'Electrical'). Consecutive fields with the same HeaderGroup value will be grouped.")]
    public string HeaderGroup { get; set; } = string.Empty;

    [Description("Whether to hide this column in the schedule while still using it for filtering or sorting.")]
    public bool IsHidden { get; set; }

    [Description("How to calculate aggregate values for this field (Standard, Totals, MinAndMax, Maximum, Minimum).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleFieldDisplayType DisplayType { get; set; } = ScheduleFieldDisplayType.Standard;

    [Description("Column width on sheet in feet. Leave empty to use default width.")]
    public double? ColumnWidth { get; set; } = 0.084;

    [Description("Horizontal alignment of the column data (Left, Center, Right).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleHorizontalAlignment HorizontalAlignment { get; set; } = ScheduleHorizontalAlignment.Center;

    [Description(
        "For calculated fields only. Indicates this is a formula or percentage field. Note: Formula strings cannot be read/written via Revit API - calculated fields must be created manually in Revit.")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public CalculatedFieldType? CalculatedType { get; set; }

    [Description("For Percentage calculated fields only. The name of the field to calculate percentages of.")]
    public string PercentageOfField { get; set; } = string.Empty;

    [Description("Formatting options for numeric fields. Leave null to use project settings.")]
    public ScheduleFieldFormatSpec? FormatOptions { get; set; }

    [Description(
        "For combined parameter fields only. List of parameters to combine into a single column with separators (e.g., combining Family and Type with separators).")]
    public List<CombinedParameterSpec>? CombinedParameters { get; set; }

    /// <summary>
    ///     Serializes a Revit ScheduleField into a ScheduleFieldSpec.
    /// </summary>
    public static ScheduleFieldSpec SerializeFrom(ScheduleField field, ViewSchedule schedule) {
        var fieldName = field.GetName();

        // Get the original parameter name from the SchedulableField to properly detect header overrides.
        var originalParamName = field.HasSchedulableField
            ? field.GetSchedulableField().GetName(schedule.Document)
            : fieldName;

        var spec = new ScheduleFieldSpec {
            ParameterName = fieldName,
            ColumnHeaderOverride = field.ColumnHeading != originalParamName ? field.ColumnHeading : string.Empty,
            IsHidden = field.IsHidden,
            DisplayType = field.DisplayType,
            ColumnWidth = field.SheetColumnWidth,
            HorizontalAlignment = field.HorizontalAlignment,
            FormatOptions = ScheduleFieldFormatSpec.SerializeFrom(field)
        };

        // Handle calculated fields
        if (field.IsCalculatedField) {
            spec.CalculatedType = field.FieldType == ScheduleFieldType.Formula
                ? CalculatedFieldType.Formula
                : CalculatedFieldType.Percentage;

            // For percentage fields, capture the field it's based on
            if (field.FieldType == ScheduleFieldType.Percentage) {
                var percentageOfId = field.PercentageOf;
                var def = schedule.Definition;
                if (percentageOfId != null && def.IsValidFieldId(percentageOfId)) {
                    var percentageOfField = def.GetField(percentageOfId);
                    spec.PercentageOfField = percentageOfField.GetName();
                }
            }
        }

        // Handle combined parameter fields
        if (field.IsCombinedParameterField) {
            var combinedParams = field.GetCombinedParameters();
            if (combinedParams is { Count: > 0 }) {
                spec.CombinedParameters = [];
                foreach (var combinedParam in combinedParams) {
                    var combinedSpec = CombinedParameterSpec.SerializeFrom(combinedParam, schedule.Document);
                    spec.CombinedParameters.Add(combinedSpec);
                }
            }
        }

        return spec;
    }

    /// <summary>
    ///     Applies this field spec to a schedule.
    ///     Returns (applied info, skipped reason) - one will be non-null.
    /// </summary>
    public (AppliedFieldInfo? Applied, string? Skipped, List<string> Warnings) ApplyTo(
        ViewSchedule schedule,
        ScheduleDefinition def,
        Func<ScheduleDefinition, Document, string, SchedulableField?> findSchedulableField,
        Func<ScheduleDefinition, Document, string, ElementId?> findParameterIdByName) {
        var warnings = new List<string>();

        // Skip calculated fields - they cannot be created via API
        if (this.CalculatedType.HasValue) {
            return (null, null, warnings); // Will be handled separately as guidance
        }

        ScheduleField? field = null;

        // Check if this is a combined parameter field
        if (this.CombinedParameters is { Count: > 0 }) {
            var (combinedField, skipped, combinedWarnings) = this.ApplyCombinedField(
                schedule, def, findParameterIdByName);
            field = combinedField;
            warnings.AddRange(combinedWarnings);
            if (skipped != null) {
                return (null, skipped, warnings);
            }
        } else {
            // Regular field
            var schedulableField = findSchedulableField(def, schedule.Document, this.ParameterName);
            if (schedulableField is null) {
                return (null, $"Parameter '{this.ParameterName}' not found", warnings);
            }

            field = def.AddField(schedulableField);
        }

        // Apply field properties if field was created
        if (field != null) {
            var propertyWarnings = this.ApplyProperties(field);
            warnings.AddRange(propertyWarnings);
        }

        var applied = new AppliedFieldInfo {
            ParameterName = this.ParameterName,
            ColumnHeaderOverride = this.ColumnHeaderOverride,
            IsHidden = this.IsHidden,
            ColumnWidth = this.ColumnWidth,
            DisplayType = this.DisplayType,
            HorizontalAlignment = this.HorizontalAlignment
        };

        return (applied, null, warnings);
    }

    private (ScheduleField? Field, string? Skipped, List<string> Warnings) ApplyCombinedField(
        ViewSchedule schedule,
        ScheduleDefinition def,
        Func<ScheduleDefinition, Document, string, ElementId?> findParameterIdByName) {
        var warnings = new List<string>();

        try {
            var combinedParamDataList = new List<TableCellCombinedParameterData>();

            foreach (var combinedSpec in this.CombinedParameters!) {
                var combinedData = TableCellCombinedParameterData.Create();

                // Find the parameter ID
                var paramId = findParameterIdByName(def, schedule.Document, combinedSpec.ParameterName);
                if (paramId == null || paramId == ElementId.InvalidElementId) {
                    warnings.Add(
                        $"Parameter '{combinedSpec.ParameterName}' not found for combined field '{this.ParameterName}'");
                    combinedData.Dispose();
                    continue;
                }

                combinedData.ParamId = paramId;
                combinedData.Prefix = combinedSpec.Prefix ?? string.Empty;
                combinedData.Suffix = combinedSpec.Suffix ?? string.Empty;
                combinedData.Separator = combinedSpec.Separator ?? " / ";

                combinedParamDataList.Add(combinedData);
            }

            // Validate and insert the combined parameter field
            if (combinedParamDataList.Count > 0) {
                if (def.IsValidCombinedParameters(combinedParamDataList)) {
                    var field = def.InsertCombinedParameterField(
                        combinedParamDataList,
                        this.ParameterName,
                        def.GetFieldCount());

                    // Dispose of the combined parameter data objects
                    foreach (var data in combinedParamDataList) {
                        data.Dispose();
                    }

                    return (field, null, warnings);
                }

                // Dispose if invalid
                foreach (var data in combinedParamDataList) {
                    data.Dispose();
                }

                return (null, $"Combined parameter field '{this.ParameterName}' has invalid parameters", warnings);
            }

            return (null, $"Combined parameter field '{this.ParameterName}' has no valid parameters", warnings);
        } catch (Exception ex) {
            warnings.Add($"Failed to create combined parameter field '{this.ParameterName}': {ex.Message}");
            return (null, $"Exception creating combined field '{this.ParameterName}'", warnings);
        }
    }

    private List<string> ApplyProperties(ScheduleField field) {
        var warnings = new List<string>();

        if (!string.IsNullOrEmpty(this.ColumnHeaderOverride))
            field.ColumnHeading = this.ColumnHeaderOverride;

        field.IsHidden = this.IsHidden;

        // Apply column width if specified
        if (this.ColumnWidth > 0)
            field.SheetColumnWidth = this.ColumnWidth ?? 1;

        // Apply horizontal alignment
        field.HorizontalAlignment = this.HorizontalAlignment;

        // Apply display type if field supports it
        if (this.DisplayType != ScheduleFieldDisplayType.Standard) {
            var canApply = this.DisplayType switch {
                ScheduleFieldDisplayType.Totals => field.CanTotal(),
                ScheduleFieldDisplayType.Max or ScheduleFieldDisplayType.Min or ScheduleFieldDisplayType.MinMax =>
                    field.CanDisplayMinMax(),
                _ => false
            };

            if (canApply)
                field.DisplayType = this.DisplayType;
            else {
                warnings.Add($"DisplayType '{this.DisplayType}' not supported for field '{this.ParameterName}'");
            }
        }

        // Apply format options
        if (this.FormatOptions != null) {
            var formatWarning = this.FormatOptions.ApplyTo(field, this.ParameterName);
            if (formatWarning != null)
                warnings.Add(formatWarning);
        }

        return warnings;
    }

    /// <summary>
    ///     Creates guidance for a calculated field that cannot be created via API.
    /// </summary>
    public CalculatedFieldGuidance? GetCalculatedFieldGuidance() {
        if (!this.CalculatedType.HasValue) return null;

        var guidance = new CalculatedFieldGuidance {
            FieldName = this.ParameterName,
            CalculatedType = this.CalculatedType.ToString() ?? string.Empty
        };

        if (this.CalculatedType == CalculatedFieldType.Formula) {
            guidance = guidance with {
                Guidance = "Add a calculated field of type 'Formula' in the schedule. " +
                           "The formula must be entered manually in Revit (API limitation)."
            };
        } else if (this.CalculatedType == CalculatedFieldType.Percentage) {
            guidance = guidance with {
                Guidance =
                    $"Add a calculated field of type 'Percentage' based on field '{this.PercentageOfField ?? "(unknown)"}'.",
                PercentageOfField = this.PercentageOfField
            };
        }

        return guidance;
    }
}
