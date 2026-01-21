using System.ComponentModel;
using System.Text.Json.Serialization;

namespace Pe.Global.Revit.Lib.Schedules.TitleStyle;

/// <summary>
///     Specification for schedule title cell styling, including borders and text alignment.
/// </summary>
public class ScheduleTitleStyleSpec {
    [Description("Horizontal alignment of the title text (Left, Center, Right).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public TitleHorizontalAlignment HorizontalAlignment { get; set; } = TitleHorizontalAlignment.Left;

    [Description("Border style configuration for the title cell. Leave null to skip border styling.")]
    public TitleBorderStyleSpec BorderStyle { get; set; } = new();

    /// <summary>
    ///     Serializes title style settings from a ViewSchedule.
    /// </summary>
    public static ScheduleTitleStyleSpec SerializeFrom(ViewSchedule schedule) {
        var tableData = schedule.GetTableData();
        var headerSection = tableData.GetSectionData(SectionType.Header);

        if (headerSection == null || headerSection.HideSection ||
            headerSection.NumberOfRows < 1 || headerSection.NumberOfColumns < 1)
            return new ScheduleTitleStyleSpec();

        var titleRow = headerSection.FirstRowNumber;
        var titleColumn = headerSection.FirstColumnNumber;

        using var cellStyle = headerSection.GetTableCellStyle(titleRow, titleColumn);
        var overrideOptions = cellStyle.GetCellStyleOverrideOptions();

        var spec = new ScheduleTitleStyleSpec();
        var hasAnyOverrides = false;

        // Serialize horizontal alignment if overridden
        if (overrideOptions.HorizontalAlignment) {
            hasAnyOverrides = true;
            spec.HorizontalAlignment = cellStyle.FontHorizontalAlignment switch {
                HorizontalAlignmentStyle.Left => TitleHorizontalAlignment.Left,
                HorizontalAlignmentStyle.Center => TitleHorizontalAlignment.Center,
                HorizontalAlignmentStyle.Right => TitleHorizontalAlignment.Right,
                _ => TitleHorizontalAlignment.Center
            };
        }

        // Serialize border styles if any are overridden
        if (overrideOptions.BorderTopLineStyle || overrideOptions.BorderBottomLineStyle ||
            overrideOptions.BorderLeftLineStyle || overrideOptions.BorderRightLineStyle) {
            var borderSpec = new TitleBorderStyleSpec();
            var hasBorderOverrides = false;

            if (overrideOptions.BorderTopLineStyle) {
                borderSpec.TopLineStyleName = GetLineStyleName(schedule.Document, cellStyle.BorderTopLineStyle);
                hasBorderOverrides = true;
            }

            if (overrideOptions.BorderBottomLineStyle) {
                borderSpec.BottomLineStyleName = GetLineStyleName(schedule.Document, cellStyle.BorderBottomLineStyle);
                hasBorderOverrides = true;
            }

            if (overrideOptions.BorderLeftLineStyle) {
                borderSpec.LeftLineStyleName = GetLineStyleName(schedule.Document, cellStyle.BorderLeftLineStyle);
                hasBorderOverrides = true;
            }

            if (overrideOptions.BorderRightLineStyle) {
                borderSpec.RightLineStyleName = GetLineStyleName(schedule.Document, cellStyle.BorderRightLineStyle);
                hasBorderOverrides = true;
            }

            if (hasBorderOverrides) {
                spec.BorderStyle = borderSpec;
                hasAnyOverrides = true;
            }
        }

        return hasAnyOverrides ? spec : new ScheduleTitleStyleSpec();
    }

    /// <summary>
    ///     Applies title style settings to a schedule. Must be called before view template application.
    /// </summary>
    public (bool Applied, string? Warning) ApplyTo(ViewSchedule schedule) {
        var tableData = schedule.GetTableData();
        var headerSection = tableData.GetSectionData(SectionType.Header);

        if (headerSection == null) return (false, "Schedule title section not found for style application.");

        if (headerSection.HideSection || headerSection.NumberOfRows < 1 || headerSection.NumberOfColumns < 1)
            return (false, "Schedule title section has no visible cells for style application.");

        var titleRow = headerSection.FirstRowNumber;
        var titleColumn = headerSection.FirstColumnNumber;

        if (!headerSection.AllowOverrideCellStyle(titleRow, titleColumn))
            return (false, "Schedule title cell does not allow style override.");

        using var cellStyle = headerSection.GetTableCellStyle(titleRow, titleColumn);
        var overrideOptions = cellStyle.GetCellStyleOverrideOptions();
        var warnings = new List<string>();
        var anyApplied = false;

        // Apply horizontal alignment

        overrideOptions.HorizontalAlignment = true;
        cellStyle.FontHorizontalAlignment = this.HorizontalAlignment switch {
            TitleHorizontalAlignment.Left => HorizontalAlignmentStyle.Left,
            TitleHorizontalAlignment.Center => HorizontalAlignmentStyle.Center,
            TitleHorizontalAlignment.Right => HorizontalAlignmentStyle.Right,
            _ => cellStyle.FontHorizontalAlignment
        };
        anyApplied = true;


        // Apply border styles
        var (borderApplied, borderWarnings) = this.BorderStyle.ApplyTo(
            schedule.Document, cellStyle, overrideOptions);

        if (borderApplied)
            anyApplied = true;

        warnings.AddRange(borderWarnings);


        if (!anyApplied) return (false, "No title style settings were specified to apply.");

        cellStyle.SetCellStyleOverrideOptions(overrideOptions);
        headerSection.SetCellStyle(titleRow, titleColumn, cellStyle);

        var warningMessage = warnings.Count > 0 ? string.Join(" ", warnings) : null;
        return (true, warningMessage);
    }

    private static string? GetLineStyleName(Document doc, ElementId lineStyleId) {
        if (lineStyleId == ElementId.InvalidElementId)
            return null;

        var graphicsStyle = doc.GetElement(lineStyleId) as GraphicsStyle;
        return graphicsStyle?.GraphicsStyleCategory?.Name;
    }
}

/// <summary>
///     Horizontal alignment options for schedule title text.
/// </summary>
public enum TitleHorizontalAlignment {
    Left,
    Center,
    Right
}