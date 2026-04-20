using Autodesk.Revit.DB.Electrical;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Electrical;

public static class ElectricalPanelScheduleQueryCollector {
    public static ElectricalPanelSchedulesQueryData Collect(
        Document doc,
        ElectricalPanelSchedulesQuery? query = null
    ) {
        var issues = new List<RevitDataIssue>();
        var resolution = ResolveQuery(doc, query, issues);
        var entries = resolution.Schedules
            .Select(schedule => TryCollectProjection(doc, schedule, issues))
            .Where(entry => entry != null)
            .Cast<ElectricalPanelScheduleProjection>()
            .ToList();

        return new ElectricalPanelSchedulesQueryData(
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
        ElectricalPanelSchedulesQuery? query,
        List<RevitDataIssue> issues
    ) {
        var effectiveQuery = query ?? new ElectricalPanelSchedulesQuery();
        return effectiveQuery.Kind switch {
            ElectricalPanelSchedulesQueryKind.CurrentActiveView => ResolveCurrentActiveView(issues),
            ElectricalPanelSchedulesQueryKind.PanelReferences => ResolvePanelReferences(doc, effectiveQuery, issues),
            _ => ResolveScheduleReferences(doc, effectiveQuery, issues)
        };
    }

    private static QueryResolution ResolveCurrentActiveView(List<RevitDataIssue> issues) {
        var activeView = RevitUiSession.CurrentUIApplication.GetActiveView();
        if (activeView is PanelScheduleView schedule) {
            return new QueryResolution(
                ElectricalPanelSchedulesQueryKind.CurrentActiveView,
                1,
                [schedule]
            );
        }

        issues.Add(new RevitDataIssue(
            "PanelScheduleCurrentActiveViewUnavailable",
            RevitDataIssueSeverity.Warning,
            "Active view is not a panel schedule view.",
            TypeName: activeView?.GetType().Name
        ));
        return new QueryResolution(
            ElectricalPanelSchedulesQueryKind.CurrentActiveView,
            1,
            []
        );
    }

    private static QueryResolution ResolveScheduleReferences(
        Document doc,
        ElectricalPanelSchedulesQuery query,
        List<RevitDataIssue> issues
    ) {
        var schedules = new List<PanelScheduleView>();
        var seenScheduleIds = new HashSet<long>();
        var scheduleIds = (query.ScheduleIds ?? [])
            .Distinct()
            .ToList();
        var scheduleUniqueIds = (query.ScheduleUniqueIds ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var scheduleId in scheduleIds) {
            var schedule = doc.GetElement(new ElementId(scheduleId)) as PanelScheduleView;
            if (schedule == null) {
                issues.Add(ElectricalCollectorSupport.Warning(
                    "ElectricalPanelScheduleIdNotFound",
                    $"Could not resolve panel schedule id {scheduleId}.",
                    scheduleId.ToString()
                ));
                continue;
            }

            if (seenScheduleIds.Add(schedule.Id.Value()))
                schedules.Add(schedule);
        }

        foreach (var scheduleUniqueId in scheduleUniqueIds) {
            var schedule = doc.GetElement(scheduleUniqueId) as PanelScheduleView;
            if (schedule == null) {
                issues.Add(ElectricalCollectorSupport.Warning(
                    "ElectricalPanelScheduleUniqueIdNotFound",
                    $"Could not resolve panel schedule unique id '{scheduleUniqueId}'.",
                    scheduleUniqueId
                ));
                continue;
            }

            if (seenScheduleIds.Add(schedule.Id.Value()))
                schedules.Add(schedule);
        }

        return new QueryResolution(
            ElectricalPanelSchedulesQueryKind.ScheduleReferences,
            scheduleIds.Count + scheduleUniqueIds.Count,
            schedules
        );
    }

    private static QueryResolution ResolvePanelReferences(
        Document doc,
        ElectricalPanelSchedulesQuery query,
        List<RevitDataIssue> issues
    ) {
        var schedulesByPanelId = new FilteredElementCollector(doc)
            .OfClass(typeof(PanelScheduleView))
            .Cast<PanelScheduleView>()
            .GroupBy(schedule => schedule.GetPanel().Value())
            .ToDictionary(group => group.Key, group => group.ToList());

        var panels = new List<FamilyInstance>();
        var seenPanelIds = new HashSet<long>();
        var panelIds = (query.PanelIds ?? [])
            .Distinct()
            .ToList();
        var panelUniqueIds = (query.PanelUniqueIds ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var panelNames = (query.PanelNames ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var panelId in panelIds) {
            var panel = doc.GetElement(new ElementId(panelId)) as FamilyInstance;
            if (panel == null) {
                issues.Add(ElectricalCollectorSupport.Warning(
                    "ElectricalPanelReferenceIdNotFound",
                    $"Could not resolve panel id {panelId}.",
                    panelId.ToString()
                ));
                continue;
            }

            if (seenPanelIds.Add(panel.Id.Value()))
                panels.Add(panel);
        }

        foreach (var panelUniqueId in panelUniqueIds) {
            var panel = doc.GetElement(panelUniqueId) as FamilyInstance;
            if (panel == null) {
                issues.Add(ElectricalCollectorSupport.Warning(
                    "ElectricalPanelReferenceUniqueIdNotFound",
                    $"Could not resolve panel unique id '{panelUniqueId}'.",
                    panelUniqueId
                ));
                continue;
            }

            if (seenPanelIds.Add(panel.Id.Value()))
                panels.Add(panel);
        }

        if (panelNames.Count != 0) {
            var namedPanels = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilyInstance))
                .Cast<FamilyInstance>()
                .Where(instance => instance.MEPModel is ElectricalEquipment)
                .Where(instance => {
                    var panelName = ElectricalCollectorSupport.GetPanelName(instance);
                    return !string.IsNullOrWhiteSpace(panelName) && panelNames.Contains(panelName);
                })
                .ToList();

            foreach (var panel in namedPanels) {
                if (seenPanelIds.Add(panel.Id.Value()))
                    panels.Add(panel);
            }

            foreach (var panelName in panelNames.Where(panelName =>
                         !namedPanels.Any(panel => string.Equals(
                             ElectricalCollectorSupport.GetPanelName(panel),
                             panelName,
                             StringComparison.OrdinalIgnoreCase
                         )))) {
                issues.Add(ElectricalCollectorSupport.Warning(
                    "ElectricalPanelReferenceNameNotFound",
                    $"Could not resolve panel name '{panelName}'.",
                    panelName
                ));
            }
        }

        var schedules = panels
            .SelectMany(panel => schedulesByPanelId.TryGetValue(panel.Id.Value(), out var panelSchedules)
                ? panelSchedules
                : [])
            .GroupBy(schedule => schedule.Id.Value())
            .Select(group => group.First())
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new QueryResolution(
            ElectricalPanelSchedulesQueryKind.PanelReferences,
            panelIds.Count + panelUniqueIds.Count + panelNames.Count,
            schedules
        );
    }

    private static ElectricalPanelScheduleProjection? TryCollectProjection(
        Document doc,
        PanelScheduleView schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            var panel = doc.GetElement(schedule.GetPanel()) as FamilyInstance;
            var template = doc.GetElement(schedule.GetTemplate()) as PanelScheduleTemplate;

            return new ElectricalPanelScheduleProjection(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                panel?.Id.Value(),
                panel?.UniqueId,
                ElectricalCollectorSupport.GetPanelName(panel),
                template?.Id.Value(),
                template?.UniqueId,
                template?.Name,
                ElectricalCollectorSupport.SafeGet(() => template?.GetPanelScheduleType().ToString()),
                CollectSections(schedule)
            );
        } catch (Exception ex) {
            issues.Add(ElectricalCollectorSupport.Warning(
                "ElectricalPanelScheduleProjectionFailed",
                ex.Message,
                schedule.Name
            ));
            return null;
        }
    }

    private static List<ElectricalPanelScheduleSectionProjection> CollectSections(PanelScheduleView schedule) => [
        CollectSection(schedule, ElectricalPanelScheduleSectionType.Header, SectionType.Header),
        CollectSection(schedule, ElectricalPanelScheduleSectionType.Body, SectionType.Body),
        CollectSection(schedule, ElectricalPanelScheduleSectionType.Summary, SectionType.Summary),
        CollectSection(schedule, ElectricalPanelScheduleSectionType.Footer, SectionType.Footer)
    ];

    private static ElectricalPanelScheduleSectionProjection CollectSection(
        PanelScheduleView schedule,
        ElectricalPanelScheduleSectionType contractSectionType,
        SectionType revitSectionType
    ) {
        if (!schedule.IsValidSectionType(revitSectionType)) {
            return new ElectricalPanelScheduleSectionProjection(
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

        var section = schedule.GetSectionData(revitSectionType);
        var columnHeaders = CollectBodyColumnHeaders(schedule);
        var rows = new List<ElectricalPanelScheduleRowProjection>();

        for (var row = section.FirstRowNumber; row <= section.LastRowNumber; row++) {
            var cells = new List<ElectricalPanelScheduleCellProjection>();
            for (var column = section.FirstColumnNumber; column <= section.LastColumnNumber; column++) {
                var displayText = ElectricalCollectorSupport.SafeGet(() =>
                    schedule.GetCellText(revitSectionType, row, column)
                ) ?? string.Empty;
                var parameterText = ElectricalCollectorSupport.NullIfWhiteSpace(
                    ElectricalCollectorSupport.SafeGet(() => schedule.GetParamValue(revitSectionType, row, column))
                );
                var combinedText = ElectricalCollectorSupport.NullIfWhiteSpace(
                    ElectricalCollectorSupport.SafeGet(() =>
                        schedule.GetCombinedParamValue(revitSectionType, row, column))
                );
                var calculatedValueName = ElectricalCollectorSupport.NullIfWhiteSpace(
                    ElectricalCollectorSupport.SafeGet(() =>
                        schedule.GetCalculatedValueName(revitSectionType, row, column))
                );
                var calculatedValueText = ElectricalCollectorSupport.NullIfWhiteSpace(
                    ElectricalCollectorSupport.SafeGet(() =>
                        schedule.GetCalculatedValueText(revitSectionType, row, column))
                );
                var circuit = revitSectionType == SectionType.Body
                    ? ElectricalCollectorSupport.SafeGet(() => schedule.GetCircuitByCell(row, column))
                    : null;
                var mergedRegion = TryCollectMergedRegion(section, row, column);
                var isBlank = string.IsNullOrWhiteSpace(displayText) &&
                              string.IsNullOrWhiteSpace(parameterText) &&
                              string.IsNullOrWhiteSpace(combinedText) &&
                              string.IsNullOrWhiteSpace(calculatedValueName) &&
                              string.IsNullOrWhiteSpace(calculatedValueText);

                var columnHeaderText = revitSectionType == SectionType.Body &&
                                       columnHeaders.TryGetValue(column, out var headerText)
                    ? headerText
                    : null;

                cells.Add(new ElectricalPanelScheduleCellProjection(
                    column,
                    displayText,
                    columnHeaderText,
                    isBlank,
                    circuit?.Id.Value(),
                    circuit?.UniqueId,
                    DetermineCellSourceKind(displayText, parameterText, combinedText, calculatedValueName,
                        calculatedValueText, isBlank),
                    parameterText,
                    combinedText,
                    calculatedValueName,
                    calculatedValueText,
                    mergedRegion
                ));
            }

            rows.Add(new ElectricalPanelScheduleRowProjection(
                row,
                revitSectionType == SectionType.Body && schedule.IsRowInCircuitTable(row),
                cells
            ));
        }

        return new ElectricalPanelScheduleSectionProjection(
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

    private static Dictionary<int, string?> CollectBodyColumnHeaders(PanelScheduleView schedule) {
        if (!schedule.IsValidSectionType(SectionType.Body))
            return [];

        var body = schedule.GetSectionData(SectionType.Body);
        if (body.NumberOfRows <= 0 || body.NumberOfColumns <= 0)
            return [];

        var headerRow = body.FirstRowNumber;
        var headers = new Dictionary<int, string?>();
        for (var column = body.FirstColumnNumber; column <= body.LastColumnNumber; column++) {
            headers[column] = ElectricalCollectorSupport.NullIfWhiteSpace(
                ElectricalCollectorSupport.SafeGet(() => schedule.GetCellText(SectionType.Body, headerRow, column))
            );
        }

        return headers;
    }

    private static ElectricalPanelScheduleMergedRegion? TryCollectMergedRegion(
        TableSectionData section,
        int row,
        int column
    ) {
        var mergedCell = ElectricalCollectorSupport.SafeGet(() => section.GetMergedCell(row, column));
        if (mergedCell == null)
            return null;

        return new ElectricalPanelScheduleMergedRegion(
            mergedCell.Top,
            mergedCell.Left,
            mergedCell.Bottom,
            mergedCell.Right
        );
    }

    private static ElectricalPanelScheduleCellSourceKind DetermineCellSourceKind(
        string displayText,
        string? parameterText,
        string? combinedText,
        string? calculatedValueName,
        string? calculatedValueText,
        bool isBlank
    ) {
        if (!string.IsNullOrWhiteSpace(calculatedValueName) || !string.IsNullOrWhiteSpace(calculatedValueText))
            return ElectricalPanelScheduleCellSourceKind.Calculated;

        if (!string.IsNullOrWhiteSpace(combinedText))
            return ElectricalPanelScheduleCellSourceKind.Combined;

        if (!string.IsNullOrWhiteSpace(parameterText))
            return ElectricalPanelScheduleCellSourceKind.Parameter;

        if (!isBlank && !string.IsNullOrWhiteSpace(displayText))
            return ElectricalPanelScheduleCellSourceKind.TextOnly;

        return ElectricalPanelScheduleCellSourceKind.Unknown;
    }

    private sealed record QueryResolution(
        ElectricalPanelSchedulesQueryKind QueryKind,
        int RequestedScheduleCount,
        List<PanelScheduleView> Schedules
    );
}