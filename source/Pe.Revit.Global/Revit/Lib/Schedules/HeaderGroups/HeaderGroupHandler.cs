using Pe.Global.Revit.Lib.Schedules.Fields;

namespace Pe.Global.Revit.Lib.Schedules.HeaderGroups;

/// <summary>
///     Static handler for serializing and applying header groups.
///     Header groups are derived from field HeaderGroup properties rather than having their own spec.
/// </summary>
public static class HeaderGroupHandler {
    /// <summary>
    ///     Serializes header groups from a ViewSchedule by reading merged cells.
    ///     Updates the HeaderGroup property on the corresponding field specs.
    /// </summary>
    public static void SerializeHeaderGroups(ViewSchedule schedule, List<ScheduleFieldSpec> fieldSpecs) {
        var tableData = schedule.GetTableData();
        var bodySection = tableData.GetSectionData(SectionType.Body);

        if (bodySection == null) return;

        var def = schedule.Definition;

        // Build mapping from visible column index to field index (accounting for hidden fields)
        var visibleColToFieldIdx = new Dictionary<int, int>();
        var visibleColIndex = 0;

        for (var fieldIdx = 0; fieldIdx < def.GetFieldCount(); fieldIdx++) {
            var field = def.GetField(fieldIdx);
            if (!field.IsHidden) {
                visibleColToFieldIdx[visibleColIndex] = fieldIdx;
                visibleColIndex++;
            }
        }

        // Header groups are stored as merged cells in the first row of the Body section
        if (bodySection.NumberOfRows == 0) return;

        var firstRow = bodySection.FirstRowNumber;
        var processedColumns = new HashSet<int>();

        for (var col = bodySection.FirstColumnNumber; col <= bodySection.LastColumnNumber; col++) {
            if (processedColumns.Contains(col)) continue;

            var mergedCell = bodySection.GetMergedCell(firstRow, col);

            // If the merged cell spans multiple columns (horizontally), it's a header group
            if (mergedCell.Right > mergedCell.Left) {
                var groupName = bodySection.GetCellText(firstRow, col);

                // Mark all fields in this range with the header group
                for (var tableCol = mergedCell.Left; tableCol <= mergedCell.Right; tableCol++) {
                    var visibleCol = tableCol - bodySection.FirstColumnNumber;
                    if (visibleColToFieldIdx.TryGetValue(visibleCol, out var fieldIdx) && fieldIdx < fieldSpecs.Count)
                        fieldSpecs[fieldIdx].HeaderGroup = groupName;
                    _ = processedColumns.Add(tableCol);
                }
            } else
                _ = processedColumns.Add(col);
        }
    }

    /// <summary>
    ///     Applies header groups to a schedule based on field specs.
    ///     Returns (applied groups, skipped groups, warnings).
    /// </summary>
    public static (List<string> Applied, List<string> Skipped, List<string> Warnings) ApplyHeaderGroups(
        ViewSchedule schedule,
        List<ScheduleFieldSpec> fieldSpecs) {
        var applied = new List<string>();
        var skipped = new List<string>();
        var warnings = new List<string>();

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

        for (var i = 0; i < fieldSpecs.Count; i++) {
            var fieldSpec = fieldSpecs[i];

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
                    applied.Add(groupInfo);
                } catch (Exception ex) {
                    warnings.Add($"Failed to apply header group '{groupName}': {ex.Message}");
                }
            } else
                skipped.Add($"{groupName} (only 1 column)");
        }

        return (applied, skipped, warnings);
    }
}