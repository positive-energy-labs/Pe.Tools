using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Authored;

internal static class AuthoredScheduleTitleStyleApplication {
    public static (bool Applied, string? Warning) ApplyTo(this ScheduleTitleStyleSpec? spec, ViewSchedule schedule) {
        if (spec == null || !HasAnyTitleStyle(spec))
            return (false, null);

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
        var anyApplied = false;

        if (spec.HorizontalAlignment.HasValue) {
            overrideOptions.HorizontalAlignment = true;
            cellStyle.FontHorizontalAlignment = spec.HorizontalAlignment.Value switch {
                ScheduleTitleHorizontalAlignment.Left => HorizontalAlignmentStyle.Left,
                ScheduleTitleHorizontalAlignment.Center => HorizontalAlignmentStyle.Center,
                ScheduleTitleHorizontalAlignment.Right => HorizontalAlignmentStyle.Right,
                _ => cellStyle.FontHorizontalAlignment
            };
            anyApplied = true;
        }

        var borderStyle = spec.BorderStyle;
        if (borderStyle != null) {
            ApplyBorder(
                schedule.Document,
                borderStyle.TopLineStyleName,
                "Top",
                lineStyleId => {
                    overrideOptions.BorderTopLineStyle = true;
                    cellStyle.BorderTopLineStyle = lineStyleId;
                },
                warnings,
                ref anyApplied);
            ApplyBorder(
                schedule.Document,
                borderStyle.BottomLineStyleName,
                "Bottom",
                lineStyleId => {
                    overrideOptions.BorderBottomLineStyle = true;
                    cellStyle.BorderBottomLineStyle = lineStyleId;
                },
                warnings,
                ref anyApplied);
            ApplyBorder(
                schedule.Document,
                borderStyle.LeftLineStyleName,
                "Left",
                lineStyleId => {
                    overrideOptions.BorderLeftLineStyle = true;
                    cellStyle.BorderLeftLineStyle = lineStyleId;
                },
                warnings,
                ref anyApplied);
            ApplyBorder(
                schedule.Document,
                borderStyle.RightLineStyleName,
                "Right",
                lineStyleId => {
                    overrideOptions.BorderRightLineStyle = true;
                    cellStyle.BorderRightLineStyle = lineStyleId;
                },
                warnings,
                ref anyApplied);
        }

        if (!anyApplied)
            return (false, "No title style settings were specified to apply.");

        cellStyle.SetCellStyleOverrideOptions(overrideOptions);
        headerSection.SetCellStyle(titleRow, titleColumn, cellStyle);

        var warningMessage = warnings.Count > 0 ? string.Join(" ", warnings) : null;
        return (true, warningMessage);
    }

    private static bool HasAnyTitleStyle(ScheduleTitleStyleSpec spec) =>
        spec.HorizontalAlignment.HasValue ||
        spec.BorderStyle is {
            TopLineStyleName: { Length: > 0 }
        } or {
            BottomLineStyleName: { Length: > 0 }
        } or {
            LeftLineStyleName: { Length: > 0 }
        } or {
            RightLineStyleName: { Length: > 0 }
        };

    private static void ApplyBorder(
        Document doc,
        string? lineStyleName,
        string borderName,
        Action<ElementId> apply,
        List<string> warnings,
        ref bool anyApplied) {
        if (string.IsNullOrWhiteSpace(lineStyleName))
            return;

        var lineStyleId = ScheduleLineStyleValueDomain.Resolve(doc, lineStyleName);
        if (lineStyleId != null && lineStyleId != ElementId.InvalidElementId) {
            apply(lineStyleId);
            anyApplied = true;
        } else {
            warnings.Add($"{borderName} line style '{lineStyleName}' not found.");
        }
    }
}
