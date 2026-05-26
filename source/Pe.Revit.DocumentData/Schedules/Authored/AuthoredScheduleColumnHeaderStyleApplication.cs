using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Authored;

internal static class AuthoredScheduleColumnHeaderStyleApplication {
    public static (bool Applied, string? Warning) ApplyColumnHeaderVerticalAlignmentTo(
        this ScheduleColumnHeaderVerticalAlignment alignment,
        ViewSchedule schedule) {
        var tableData = schedule.GetTableData();
        var bodySection = tableData.GetSectionData(SectionType.Body);

        if (bodySection == null)
            return (false, "Schedule body section not found for column header alignment application.");

        if (bodySection.HideSection || bodySection.NumberOfRows < 1 || bodySection.NumberOfColumns < 1)
            return (false, "Schedule body section has no visible column header cells for alignment application.");

        var targetAlignment = alignment.ToRevit();
        var appliedCount = 0;
        var skippedCount = 0;
        
        foreach (var (row, column) in GetColumnHeaderCells(bodySection)) {
            if (!bodySection.AllowOverrideCellStyle(row, column)) {
                skippedCount++;
                continue;
            }

            using var cellStyle = bodySection.GetTableCellStyle(row, column);
            var overrideOptions = cellStyle.GetCellStyleOverrideOptions();
            overrideOptions.VerticalAlignment = true;
            cellStyle.FontVerticalAlignment = targetAlignment;
            cellStyle.SetCellStyleOverrideOptions(overrideOptions);
            bodySection.SetCellStyle(row, column, cellStyle);
            appliedCount++;
        }

        if (appliedCount == 0)
            return (false, "No schedule column header cells allowed vertical alignment override.");

        var warning = skippedCount > 0
            ? $"Skipped vertical alignment override for {skippedCount} column header cell(s)."
            : null;
        return (true, warning);
    }

    public static ScheduleColumnHeaderVerticalAlignment? SerializeColumnHeaderVerticalAlignment(ViewSchedule schedule) {
        var tableData = schedule.GetTableData();
        var bodySection = tableData.GetSectionData(SectionType.Body);

        if (bodySection == null || bodySection.HideSection ||
            bodySection.NumberOfRows < 1 || bodySection.NumberOfColumns < 1)
            return null;

        ScheduleColumnHeaderVerticalAlignment? resolvedAlignment = null;

        foreach (var (row, column) in GetColumnHeaderCells(bodySection)) {
            using var cellStyle = bodySection.GetTableCellStyle(row, column);
            var alignment = cellStyle.FontVerticalAlignment.ToAuthored();
            if (resolvedAlignment == null) {
                resolvedAlignment = alignment;
                continue;
            }

            if (resolvedAlignment != alignment)
                return null;
        }

        return resolvedAlignment;
    }

    private static IEnumerable<(int Row, int Column)> GetColumnHeaderCells(TableSectionData bodySection) {
        var firstRow = bodySection.FirstRowNumber;
        var lastHeaderRow = firstRow;

        for (var column = bodySection.FirstColumnNumber; column <= bodySection.LastColumnNumber; column++) {
            var mergedCell = bodySection.GetMergedCell(firstRow, column);
            if (mergedCell.Bottom > lastHeaderRow)
                lastHeaderRow = mergedCell.Bottom;
            if (mergedCell.Right > mergedCell.Left && firstRow + 1 <= bodySection.LastRowNumber)
                lastHeaderRow = Math.Max(lastHeaderRow, firstRow + 1);
        }

        lastHeaderRow = Math.Min(lastHeaderRow, bodySection.LastRowNumber);
        var emittedCells = new HashSet<(int Row, int Column)>();

        for (var row = firstRow; row <= lastHeaderRow; row++) {
            for (var column = bodySection.FirstColumnNumber; column <= bodySection.LastColumnNumber; column++) {
                var mergedCell = bodySection.GetMergedCell(row, column);
                var key = (mergedCell.Top, mergedCell.Left);
                if (emittedCells.Add(key))
                    yield return key;
            }
        }
    }
}
