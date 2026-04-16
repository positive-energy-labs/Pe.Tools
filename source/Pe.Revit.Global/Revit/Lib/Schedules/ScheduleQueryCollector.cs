using Autodesk.Revit.DB;
using Pe.Revit.Global.PolyFill;
using Pe.Revit.Global.Revit.Documents;
using Pe.Revit.Global.Services.Document;
using Pe.Shared.HostContracts.RevitData;
using InternalScheduleFieldSpec = Pe.Revit.Global.Revit.Lib.Schedules.Fields.ScheduleFieldSpec;
using InternalScheduleSpec = Pe.Revit.Global.Revit.Lib.Schedules.ScheduleSpec;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

public static class ScheduleQueryCollector {
    public static ScheduleQueryData Collect(
        Document doc,
        ScheduleQuery? query = null
    ) {
        var issues = new List<RevitDataIssue>();
        var resolution = ResolveQuery(doc, query, issues);
        var entries = resolution.Schedules
            .Select(schedule => TryCollectProjection(doc, schedule, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleProjection>()
            .ToList();

        return new ScheduleQueryData(
            doc.Title,
            resolution.QueryKind,
            resolution.RequestedScheduleCount,
            entries.Count,
            entries,
            issues
        );
    }

    private static QueryResolution ResolveQuery(
        Document doc,
        ScheduleQuery? query,
        List<RevitDataIssue> issues
    ) {
        var effectiveQuery = query ?? new ScheduleQuery();
        return effectiveQuery.Kind switch {
            ScheduleQueryKind.CurrentActiveView => ResolveCurrentActiveView(issues),
            ScheduleQueryKind.ScheduleNames => ResolveScheduleNames(doc, effectiveQuery, issues),
            _ => ResolveScheduleReferences(doc, effectiveQuery, issues)
        };
    }

    private static QueryResolution ResolveCurrentActiveView(List<RevitDataIssue> issues) {
        var activeView = RevitUiSession.CurrentUIApplication.GetActiveView();
        if (activeView is ViewSchedule schedule && !schedule.IsTemplate && !IsRevisionSchedule(schedule)) {
            return new QueryResolution(
                ScheduleQueryKind.CurrentActiveView,
                1,
                [schedule]
            );
        }

        issues.Add(ScheduleCollectorSupport.Warning(
            "ScheduleCurrentActiveViewUnavailable",
            "Active view is not a supported non-template schedule view.",
            activeView?.GetType().Name
        ));
        return new QueryResolution(ScheduleQueryKind.CurrentActiveView, 1, []);
    }

    private static QueryResolution ResolveScheduleReferences(
        Document doc,
        ScheduleQuery query,
        List<RevitDataIssue> issues
    ) {
        var schedules = new List<ViewSchedule>();
        var seenIds = new HashSet<long>();
        var scheduleIds = (query.ScheduleIds ?? [])
            .Distinct()
            .ToList();
        var scheduleUniqueIds = (query.ScheduleUniqueIds ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var scheduleId in scheduleIds) {
            var schedule = doc.GetElement(new ElementId(scheduleId)) as ViewSchedule;
            if (!TryAddResolvedSchedule(schedules, seenIds, schedule, issues,
                    "ScheduleReferenceIdNotFound",
                    $"Could not resolve schedule id {scheduleId}.",
                    scheduleId.ToString())) {
                continue;
            }
        }

        foreach (var scheduleUniqueId in scheduleUniqueIds) {
            var schedule = doc.GetElement(scheduleUniqueId) as ViewSchedule;
            if (!TryAddResolvedSchedule(schedules, seenIds, schedule, issues,
                    "ScheduleReferenceUniqueIdNotFound",
                    $"Could not resolve schedule unique id '{scheduleUniqueId}'.",
                    scheduleUniqueId)) {
                continue;
            }
        }

        return new QueryResolution(
            ScheduleQueryKind.ScheduleReferences,
            scheduleIds.Count + scheduleUniqueIds.Count,
            schedules
        );
    }

    private static QueryResolution ResolveScheduleNames(
        Document doc,
        ScheduleQuery query,
        List<RevitDataIssue> issues
    ) {
        var requestedNames = (query.ScheduleNames ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var candidates = CollectQueryableSchedules(doc);
        var schedules = new List<ViewSchedule>();
        var seenIds = new HashSet<long>();

        foreach (var scheduleName in requestedNames) {
            var matches = candidates
                .Where(schedule => string.Equals(schedule.Name, scheduleName, StringComparison.OrdinalIgnoreCase))
                .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (matches.Count == 0) {
                issues.Add(ScheduleCollectorSupport.Warning(
                    "ScheduleReferenceNameNotFound",
                    $"Could not resolve schedule name '{scheduleName}'.",
                    scheduleName
                ));
                continue;
            }

            foreach (var schedule in matches) {
                if (seenIds.Add(schedule.Id.Value()))
                    schedules.Add(schedule);
            }
        }

        return new QueryResolution(
            ScheduleQueryKind.ScheduleNames,
            requestedNames.Count,
            schedules
        );
    }

    private static ScheduleProjection? TryCollectProjection(
        Document doc,
        ViewSchedule schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            var spec = ScheduleHelper.SerializeSchedule(schedule);
            var sheetPlacements = ScheduleCollectorSupport.CollectSheetPlacements(doc, schedule);
            var template = ScheduleCollectorSupport.GetViewTemplate(schedule);

            return new ScheduleProjection(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                ScheduleCollectorSupport.GetCategoryName(doc, schedule),
                schedule.IsTemplate,
                template?.Id.Value(),
                template?.UniqueId,
                template?.Name,
                sheetPlacements.Count != 0,
                sheetPlacements,
                CollectSections(schedule, spec)
            );
        } catch (Exception ex) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleProjectionFailed",
                ex.Message,
                schedule.Name
            ));
            return null;
        }
    }

    private static List<ScheduleSectionProjection> CollectSections(
        ViewSchedule schedule,
        InternalScheduleSpec spec
    ) => [
        CollectSection(schedule, spec, ScheduleSectionType.Header, SectionType.Header),
        CollectSection(schedule, spec, ScheduleSectionType.Body, SectionType.Body),
        CollectSection(schedule, spec, ScheduleSectionType.Summary, SectionType.Summary),
        CollectSection(schedule, spec, ScheduleSectionType.Footer, SectionType.Footer)
    ];

    private static ScheduleSectionProjection CollectSection(
        ViewSchedule schedule,
        InternalScheduleSpec spec,
        ScheduleSectionType contractSectionType,
        SectionType revitSectionType
    ) {
        var section = ScheduleCollectorSupport.SafeGet(() => schedule.GetTableData().GetSectionData(revitSectionType));
        if (section == null) {
            return new ScheduleSectionProjection(
                contractSectionType,
                false,
                0,
                0,
                0,
                0,
                0,
                0,
                []
            );
        }

        var columnHeaders = revitSectionType == SectionType.Body
            ? CollectBodyColumnHeaders(schedule, section, spec)
            : new Dictionary<int, string?>();
        var fieldsByColumn = revitSectionType == SectionType.Body
            ? CollectVisibleBodyFields(section, spec)
            : new Dictionary<int, InternalScheduleFieldSpec>();
        var rows = new List<ScheduleRowProjection>();

        for (var row = section.FirstRowNumber; row <= section.LastRowNumber; row++) {
            var cells = new List<ScheduleCellProjection>();
            for (var column = section.FirstColumnNumber; column <= section.LastColumnNumber; column++) {
                var displayText = GetDisplayText(schedule, section, revitSectionType, row, column);
                var mergedRegion = TryCollectMergedRegion(section, row, column);
                var isBlank = string.IsNullOrWhiteSpace(displayText);
                var sourceMetadata = DetermineCellSource(displayText, isBlank, fieldsByColumn.TryGetValue(column, out var field) ? field : null);

                cells.Add(new ScheduleCellProjection(
                    column,
                    displayText,
                    columnHeaders.TryGetValue(column, out var columnHeaderText) ? columnHeaderText : null,
                    isBlank,
                    sourceMetadata.SourceKind,
                    sourceMetadata.ParameterText,
                    sourceMetadata.CombinedText,
                    sourceMetadata.CalculatedValueName,
                    sourceMetadata.CalculatedValueText,
                    mergedRegion
                ));
            }

            rows.Add(new ScheduleRowProjection(row, cells));
        }

        return new ScheduleSectionProjection(
            contractSectionType,
            true,
            section.FirstRowNumber,
            section.LastRowNumber,
            section.FirstColumnNumber,
            section.LastColumnNumber,
            section.NumberOfRows,
            section.NumberOfColumns,
            rows
        );
    }

    private static Dictionary<int, string?> CollectBodyColumnHeaders(
        ViewSchedule schedule,
        TableSectionData bodySection,
        InternalScheduleSpec spec
    ) {
        var headers = new Dictionary<int, string?>();
        var visibleFields = spec.Fields
            .Where(field => !field.IsHidden)
            .ToList();
        var bodyColumn = bodySection.FirstColumnNumber;

        foreach (var field in visibleFields.Take(bodySection.NumberOfColumns)) {
            headers[bodyColumn] = ScheduleCollectorSupport.NullIfWhiteSpace(
                string.IsNullOrWhiteSpace(field.ColumnHeaderOverride)
                    ? field.ParameterName
                    : field.ColumnHeaderOverride
            );
            bodyColumn++;
        }

        return headers;
    }

    private static Dictionary<int, InternalScheduleFieldSpec> CollectVisibleBodyFields(
        TableSectionData bodySection,
        InternalScheduleSpec spec
    ) {
        var fieldsByColumn = new Dictionary<int, InternalScheduleFieldSpec>();
        var visibleFields = spec.Fields
            .Where(field => !field.IsHidden)
            .ToList();

        var maxCount = Math.Min(bodySection.NumberOfColumns, visibleFields.Count);
        for (var index = 0; index < maxCount; index++) {
            fieldsByColumn[bodySection.FirstColumnNumber + index] = visibleFields[index];
        }

        return fieldsByColumn;
    }

    private static ScheduleMergedRegion? TryCollectMergedRegion(
        TableSectionData section,
        int row,
        int column
    ) {
        var mergedCell = ScheduleCollectorSupport.SafeGet(() => section.GetMergedCell(row, column));
        if (mergedCell == null)
            return null;

        return new ScheduleMergedRegion(
            mergedCell.Top,
            mergedCell.Left,
            mergedCell.Bottom,
            mergedCell.Right
        );
    }

    private static string GetDisplayText(
        ViewSchedule schedule,
        TableSectionData section,
        SectionType revitSectionType,
        int row,
        int column
    ) {
        if (revitSectionType == SectionType.Body) {
            var bodyText = ScheduleCollectorSupport.SafeGet(() => schedule.GetCellText(SectionType.Body, row, column));
            if (bodyText != null)
                return bodyText;
        }

        return ScheduleCollectorSupport.SafeGet(() => section.GetCellText(row, column)) ?? string.Empty;
    }

    private static CellSourceMetadata DetermineCellSource(
        string displayText,
        bool isBlank,
        InternalScheduleFieldSpec? field
    ) {
        if (field != null) {
            if (field.CombinedParameters is { Count: > 0 }) {
                return new CellSourceMetadata(
                    ScheduleCellSourceKind.Combined,
                    null,
                    isBlank ? null : displayText,
                    null,
                    null
                );
            }

            if (field.CalculatedType.HasValue) {
                return new CellSourceMetadata(
                    ScheduleCellSourceKind.Calculated,
                    null,
                    null,
                    field.ParameterName,
                    isBlank ? null : displayText
                );
            }

            return new CellSourceMetadata(
                isBlank ? ScheduleCellSourceKind.Unknown : ScheduleCellSourceKind.Parameter,
                isBlank ? null : displayText,
                null,
                null,
                null
            );
        }

        if (!isBlank && !string.IsNullOrWhiteSpace(displayText)) {
            return new CellSourceMetadata(
                ScheduleCellSourceKind.TextOnly,
                null,
                null,
                null,
                null
            );
        }

        return new CellSourceMetadata(
            ScheduleCellSourceKind.Unknown,
            null,
            null,
            null,
            null
        );
    }

    private static List<ViewSchedule> CollectQueryableSchedules(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => !schedule.IsTemplate)
            .Where(schedule => !IsRevisionSchedule(schedule))
            .ToList();

    private static bool TryAddResolvedSchedule(
        List<ViewSchedule> schedules,
        HashSet<long> seenIds,
        ViewSchedule? schedule,
        List<RevitDataIssue> issues,
        string notFoundCode,
        string notFoundMessage,
        string elementName
    ) {
        if (schedule == null || schedule.IsTemplate || IsRevisionSchedule(schedule)) {
            issues.Add(ScheduleCollectorSupport.Warning(notFoundCode, notFoundMessage, elementName));
            return false;
        }

        if (seenIds.Add(schedule.Id.Value()))
            schedules.Add(schedule);

        return true;
    }

    private static bool IsRevisionSchedule(ViewSchedule schedule) =>
        schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase);

    private sealed record QueryResolution(
        ScheduleQueryKind QueryKind,
        int RequestedScheduleCount,
        List<ViewSchedule> Schedules
    );

    private sealed record CellSourceMetadata(
        ScheduleCellSourceKind SourceKind,
        string? ParameterText,
        string? CombinedText,
        string? CalculatedValueName,
        string? CalculatedValueText
    );
}
