namespace Pe.Revit.DocumentData.Schedules;

public static class ScheduleFieldExtensions {
    /// <summary>
    ///     Applies the basic column properties every schedule-authoring lane needs: heading,
    ///     visibility, and sheet column width (feet). Null leaves a property untouched; widths
    ///     must be positive to apply.
    /// </summary>
    public static void ApplyColumnBasics(
        this ScheduleField field,
        string? heading = null,
        bool? isHidden = null,
        double? sheetColumnWidth = null
    ) {
        if (!string.IsNullOrEmpty(heading))
            field.ColumnHeading = heading;
        if (isHidden is { } hidden)
            field.IsHidden = hidden;
        if (sheetColumnWidth is > 0)
            field.SheetColumnWidth = sheetColumnWidth.Value;
    }
}
