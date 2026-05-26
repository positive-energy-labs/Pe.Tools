using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Authored;

internal static class AuthoredScheduleTitleStyleApplication {
    private const string DefaultBottomLineStyleName = "Thin Lines";

    public static (bool Applied, string? Warning) ApplyTo(this ScheduleTitleStyleSpec? spec, ViewSchedule schedule) {
        var tableData = schedule.GetTableData();
        var headerSection = tableData.GetSectionData(SectionType.Header);

        if (headerSection == null)
            return (false, "Schedule title section not found for style application.");

        if (headerSection.HideSection || headerSection.NumberOfRows < 1 || headerSection.NumberOfColumns < 1)
            return (false, "Schedule title section has no visible cells for style application.");

        var titleRow = headerSection.FirstRowNumber;
        var titleColumn = headerSection.FirstColumnNumber;

        if (!headerSection.AllowOverrideCellStyle(titleRow, titleColumn))
            return (false, "Schedule title cell does not allow style override.");

        using var cellStyle = headerSection.GetTableCellStyle(titleRow, titleColumn);
        var overrideOptions = cellStyle.GetCellStyleOverrideOptions();
        var warnings = new List<string>();

        overrideOptions.HorizontalAlignment = true;
        cellStyle.FontHorizontalAlignment = (spec?.HorizontalAlignment ?? ScheduleTitleHorizontalAlignment.Left) switch {
            ScheduleTitleHorizontalAlignment.Left => HorizontalAlignmentStyle.Left,
            ScheduleTitleHorizontalAlignment.Center => HorizontalAlignmentStyle.Center,
            ScheduleTitleHorizontalAlignment.Right => HorizontalAlignmentStyle.Right,
            _ => HorizontalAlignmentStyle.Left
        };

        if (spec?.BorderStyle != null) {
            ApplyBorder(schedule.Document, spec.BorderStyle.TopLineStyleName, "Top", lineStyleId => {
                overrideOptions.BorderTopLineStyle = true;
                cellStyle.BorderTopLineStyle = lineStyleId;
            }, warnings);
            ApplyBorder(schedule.Document, spec.BorderStyle.BottomLineStyleName, "Bottom", lineStyleId => {
                overrideOptions.BorderBottomLineStyle = true;
                cellStyle.BorderBottomLineStyle = lineStyleId;
            }, warnings);
            ApplyBorder(schedule.Document, spec.BorderStyle.LeftLineStyleName, "Left", lineStyleId => {
                overrideOptions.BorderLeftLineStyle = true;
                cellStyle.BorderLeftLineStyle = lineStyleId;
            }, warnings);
            ApplyBorder(schedule.Document, spec.BorderStyle.RightLineStyleName, "Right", lineStyleId => {
                overrideOptions.BorderRightLineStyle = true;
                cellStyle.BorderRightLineStyle = lineStyleId;
            }, warnings);
        } else {
            ApplyDefaultTitleBorder(schedule.Document, cellStyle, overrideOptions, warnings);
        }

        cellStyle.SetCellStyleOverrideOptions(overrideOptions);
        headerSection.SetCellStyle(titleRow, titleColumn, cellStyle);

        var warningMessage = warnings.Count > 0 ? string.Join(" ", warnings) : null;
        return (true, warningMessage);
    }

    private static void ApplyDefaultTitleBorder(
        Document doc,
        TableCellStyle cellStyle,
        TableCellStyleOverrideOptions overrideOptions,
        List<string> warnings) {
        overrideOptions.BorderTopLineStyle = true;
        overrideOptions.BorderLeftLineStyle = true;
        overrideOptions.BorderRightLineStyle = true;
        cellStyle.BorderTopLineStyle = ElementId.InvalidElementId;
        cellStyle.BorderLeftLineStyle = ElementId.InvalidElementId;
        cellStyle.BorderRightLineStyle = ElementId.InvalidElementId;

        ApplyBorder(doc, DefaultBottomLineStyleName, "Bottom", lineStyleId => {
            overrideOptions.BorderBottomLineStyle = true;
            cellStyle.BorderBottomLineStyle = lineStyleId;
        }, warnings);
    }

    private static void ApplyBorder(
        Document doc,
        string? lineStyleName,
        string borderName,
        Action<ElementId> apply,
        List<string> warnings) {
        if (string.IsNullOrWhiteSpace(lineStyleName)) {
            apply(ElementId.InvalidElementId);
            return;
        }

        var lineStyleId = ScheduleLineStyleValueDomain.Resolve(doc, lineStyleName);
        if (lineStyleId != null && lineStyleId != ElementId.InvalidElementId) {
            apply(lineStyleId);
        } else {
            warnings.Add($"{borderName} line style '{lineStyleName}' not found.");
        }
    }
}
