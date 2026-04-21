using Pe.Revit.Global.Revit.Documents.Schedules;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

public static class ScheduleQueryCollector {
    private const string SyntheticFamiliesKey = "synthetic:families";
    private const string SyntheticFamiliesHeader = "Families";

    public static ScheduleQueryData Collect(
        Document doc,
        ScheduleQuery? query = null
    ) {
        var issues = new List<RevitDataIssue>();
        var resolution = ResolveQuery(doc, query, issues);
        var entries = resolution.Schedules
            .Select(schedule => TryCollectProjection(doc, schedule, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleRenderedScheduleEntry>()
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
            _ = TryAddResolvedSchedule(
                schedules,
                seenIds,
                schedule,
                issues,
                "ScheduleReferenceIdNotFound",
                $"Could not resolve schedule id {scheduleId}.",
                scheduleId.ToString()
            );
        }

        foreach (var scheduleUniqueId in scheduleUniqueIds) {
            var schedule = doc.GetElement(scheduleUniqueId) as ViewSchedule;
            _ = TryAddResolvedSchedule(
                schedules,
                seenIds,
                schedule,
                issues,
                "ScheduleReferenceUniqueIdNotFound",
                $"Could not resolve schedule unique id '{scheduleUniqueId}'.",
                scheduleUniqueId
            );
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

    private static ScheduleRenderedScheduleEntry? TryCollectProjection(
        Document doc,
        ViewSchedule schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            var sheetPlacements = ScheduleCollectorSupport.CollectSheetPlacements(doc, schedule);
            var visibleFamilies = ScheduleVisibleFamilyCollector.CollectVisibleFamilies(doc, schedule);
            var visibleInstances = ScheduleVisibleFamilyCollector.CollectVisibleInstances(doc, schedule);
            var visibleBodyRowCount = ScheduleVisibleFamilyCollector.GetVisibleBodyRowCount(schedule);
            var bodySection = ScheduleCollectorSupport.SafeGet(() => schedule.GetTableData().GetSectionData(SectionType.Body));
            var contexts = bodySection == null
                ? []
                : CollectColumnContexts(doc, schedule, bodySection);
            var rows = bodySection == null
                ? []
                : CollectRows(schedule, bodySection, contexts, visibleInstances, issues);
            var columns = contexts
                .Select(context => context.Column)
                .Append(new ScheduleRenderedColumn(
                    bodySection == null ? 0 : bodySection.LastColumnNumber + 1,
                    SyntheticFamiliesHeader,
                    SyntheticFamiliesKey
                ))
                .ToList();

            return new ScheduleRenderedScheduleEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                ScheduleCollectorSupport.GetCategoryName(doc, schedule),
                schedule.IsTemplate,
                sheetPlacements.Count != 0,
                sheetPlacements,
                visibleBodyRowCount,
                visibleFamilies.Count,
                visibleInstances.Count,
                visibleFamilies,
                visibleInstances,
                columns,
                rows
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

    private static List<ColumnContext> CollectColumnContexts(
        Document doc,
        ViewSchedule schedule,
        TableSectionData bodySection
    ) {
        var contexts = new List<ColumnContext>();
        var visibleColumnNumber = bodySection.FirstColumnNumber;

        for (var i = 0; i < schedule.Definition.GetFieldCount() && visibleColumnNumber <= bodySection.LastColumnNumber; i++) {
            var field = schedule.Definition.GetField(i);
            if (field.IsHidden)
                continue;

            var fieldName = field.GetName();
            var headerText = ScheduleCollectorSupport.NullIfWhiteSpace(field.ColumnHeading) ?? fieldName;
            contexts.Add(new ColumnContext(
                new ScheduleRenderedColumn(
                    visibleColumnNumber,
                    headerText,
                    ScheduleCollectorSupport.BuildFieldKey(doc, field, fieldName)
                ),
                fieldName,
                headerText
            ));
            visibleColumnNumber++;
        }

        return contexts;
    }

    private static List<ScheduleRenderedRow> CollectRows(
        ViewSchedule schedule,
        TableSectionData bodySection,
        IReadOnlyList<ColumnContext> contexts,
        IReadOnlyList<ScheduleVisibleInstanceEntry> visibleInstances,
        List<RevitDataIssue> issues
    ) {
        var rows = new List<ScheduleRenderedRow>();
        var familyColumn = contexts.FirstOrDefault(context => MatchesIdentityColumn(context, "Family"));
        var typeColumn = contexts.FirstOrDefault(context => MatchesIdentityColumn(context, "Type"));
        var canResolveInstances = familyColumn != null || typeColumn != null;

        if (!canResolveInstances && visibleInstances.Count != 0) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleRowInstanceReferencesUnavailable",
                "Row instance references were left empty because the schedule does not expose a visible Family or Type column.",
                schedule.Name
            ));
        }

        for (var rowNumber = bodySection.FirstRowNumber; rowNumber <= bodySection.LastRowNumber; rowNumber++) {
            var values = contexts
                .Select(context => ScheduleCollectorSupport.SafeGet(() => schedule.GetCellText(SectionType.Body, rowNumber, context.Column.ColumnNumber)) ?? string.Empty)
                .ToList();

            var instanceIds = canResolveInstances
                ? ResolveRowInstanceIds(values, contexts, visibleInstances, familyColumn, typeColumn)
                : [];
            if (canResolveInstances && instanceIds.Count == 0 && values.Any(value => !string.IsNullOrWhiteSpace(value))) {
                issues.Add(ScheduleCollectorSupport.Warning(
                    "ScheduleRowInstanceReferencesUnresolved",
                    $"Rendered row {rowNumber} could not be matched to visible schedule instances.",
                    schedule.Name
                ));
            }

            values.Add(BuildSyntheticFamiliesValue(instanceIds, visibleInstances));
            rows.Add(new ScheduleRenderedRow(rowNumber, values, instanceIds));
        }

        return rows;
    }

    private static List<long> ResolveRowInstanceIds(
        IReadOnlyList<string> values,
        IReadOnlyList<ColumnContext> contexts,
        IReadOnlyList<ScheduleVisibleInstanceEntry> visibleInstances,
        ColumnContext? familyColumn,
        ColumnContext? typeColumn
    ) {
        var familyValue = GetColumnValue(values, contexts, familyColumn);
        var typeValue = GetColumnValue(values, contexts, typeColumn);

        return visibleInstances
            .Where(instance =>
                (familyValue == null || string.Equals(instance.FamilyName, familyValue, StringComparison.OrdinalIgnoreCase)) &&
                (typeValue == null || string.Equals(instance.FamilyTypeName, typeValue, StringComparison.OrdinalIgnoreCase)))
            .Select(instance => instance.InstanceId)
            .ToList();
    }

    private static string BuildSyntheticFamiliesValue(
        IReadOnlyList<long> instanceIds,
        IReadOnlyList<ScheduleVisibleInstanceEntry> visibleInstances
    ) => string.Join(
        ", ",
        visibleInstances
            .Where(instance => instanceIds.Contains(instance.InstanceId))
            .Select(instance => instance.FamilyName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
    );

    private static string? GetColumnValue(
        IReadOnlyList<string> values,
        IReadOnlyList<ColumnContext> contexts,
        ColumnContext? context
    ) {
        if (context == null)
            return null;

        var index = -1;
        for (var i = 0; i < contexts.Count; i++) {
            if (ReferenceEquals(contexts[i], context) || contexts[i] == context) {
                index = i;
                break;
            }
        }
        return index < 0 ? null : ScheduleCollectorSupport.NullIfWhiteSpace(values[index]);
    }

    private static bool MatchesIdentityColumn(ColumnContext context, string expected) =>
        string.Equals(context.FieldName, expected, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(context.HeaderText, expected, StringComparison.OrdinalIgnoreCase);

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

    private sealed record ColumnContext(
        ScheduleRenderedColumn Column,
        string FieldName,
        string HeaderText
    );
}
