using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using System.Globalization;

namespace Pe.Revit.DocumentData.Schedules.Collect;

public static class ScheduleQueryCollector {
    public static ScheduleQueryData Collect(
        Document doc,
        ScheduleQuery? query = null,
        View? activeView = null
    ) {
        var issues = new List<RevitDataIssue>();
        var resolution = ResolveQuery(doc, query, activeView, issues);
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
        View? activeView,
        List<RevitDataIssue> issues
    ) {
        var effectiveQuery = query ?? new ScheduleQuery();
        return effectiveQuery.Kind switch {
            ScheduleQueryKind.CurrentActiveView => ResolveCurrentActiveView(activeView, issues),
            ScheduleQueryKind.ScheduleNames => ResolveScheduleNames(doc, effectiveQuery, issues),
            _ => ResolveScheduleReferences(doc, effectiveQuery, issues)
        };
    }

    private static QueryResolution ResolveCurrentActiveView(
        View? activeView,
        List<RevitDataIssue> issues
    ) {
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
            var schedule = doc.GetElement(scheduleId.ToElementId()) as ViewSchedule;
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
            var subjectElements = ScheduleRenderedSubjectCollector.CollectVisibleSubjects(doc, schedule);
            var subjects = ScheduleRenderedSubjectCollector.CollectSubjects(subjectElements);
            var bodySection =
                ScheduleCollectorSupport.SafeGet(() => schedule.GetTableData().GetSectionData(SectionType.Body));
            var contexts = bodySection == null
                ? []
                : CollectColumnContexts(doc, schedule, bodySection);
            var contextByColumnNumber = contexts.ToDictionary(context => context.Column.ColumnNumber);
            var comparableContexts = contexts
                .Where(context => context.IsComparable)
                .ToList();
            var subjectContexts = bodySection == null
                ? []
                : CollectSubjectContexts(doc, comparableContexts, subjectElements, subjects);
            var collectedRows = bodySection == null
                ? []
                : CollectRows(schedule, bodySection, contexts, contextByColumnNumber, subjectContexts);
            var rows = collectedRows.Select(item => item.Row).ToList();
            var bindingSummary = SummarizeBinding(collectedRows);

            if (subjects.Count != 0) {
                if (bindingSummary.UnboundRowCount != 0) {
                    issues.Add(ScheduleCollectorSupport.Warning(
                        "ScheduleRowSubjectBindingIncomplete",
                        $"{bindingSummary.UnboundRowCount} bindable data row(s) could not be bound to visible schedule subjects.",
                        schedule.Name
                    ));
                }
            }

            return new ScheduleRenderedScheduleEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                ScheduleCollectorSupport.GetCategoryName(doc, schedule),
                schedule.IsTemplate,
                sheetPlacements.Count != 0,
                sheetPlacements,
                rows.Count == 0,
                bindingSummary.BindingStatus,
                bindingSummary.NotApplicableRowCount,
                bindingSummary.NonBindableRowCount,
                bindingSummary.BindableRowCount,
                bindingSummary.BoundRowCount,
                bindingSummary.UnboundRowCount,
                rows.Count,
                subjects.Count,
                subjects,
                contexts.Select(context => context.Column).ToList(),
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

        for (var fieldIndex = 0;
             fieldIndex < schedule.Definition.GetFieldCount() && visibleColumnNumber <= bodySection.LastColumnNumber;
             fieldIndex++) {
            var field = schedule.Definition.GetField(fieldIndex);
            if (field.IsHidden)
                continue;

            var fieldName = field.GetName();
            var headerText = ScheduleCollectorSupport.NullIfWhiteSpace(field.ColumnHeading) ?? fieldName;
            var specTypeId = ScheduleCollectorSupport.GetFieldSpecTypeId(field);
            contexts.Add(new ColumnContext(
                new ScheduleRenderedColumn(
                    visibleColumnNumber,
                    headerText,
                    ScheduleCollectorSupport.BuildFieldKey(doc, field, fieldName),
                    fieldName,
                    fieldIndex
                ),
                field,
                fieldName,
                headerText,
                specTypeId,
                ScheduleCollectorSupport.BuildEffectiveUnits(doc, bodySection, visibleColumnNumber, field, specTypeId),
                ScheduleCollectorSupport.GetMultipleValueTexts(field),
                ScheduleCollectorSupport.IsComparableField(field)
            ));
            visibleColumnNumber++;
        }

        return contexts;
    }

    private static List<SubjectContext> CollectSubjectContexts(
        Document doc,
        IReadOnlyList<ColumnContext> contexts,
        IReadOnlyList<Element> subjectElements,
        IReadOnlyList<ScheduleRenderedSubject> subjects
    ) {
        var subjectsById = subjects.ToDictionary(subject => subject.SubjectId);
        return subjectElements
            .Select(element => {
                if (!subjectsById.TryGetValue(element.Id.Value(), out var subject))
                    return null;

                var parameterSources = ScheduleCollectorSupport.CollectParameterSourceElements(doc, element);
                var valuesByColumn = new Dictionary<int, SubjectComparableValue>();
                foreach (var context in contexts) {
                    var comparableValue = ScheduleCollectorSupport.ReadFieldComparableValue(
                        doc,
                        element,
                        parameterSources,
                        context.Field,
                        context.FieldName,
                        context.SpecTypeId,
                        context.EffectiveUnits
                    );
                    if (comparableValue.TextValues.Count == 0 && comparableValue.RawDoubleValue == null)
                        continue;

                    valuesByColumn[context.Column.ColumnNumber] =
                        new SubjectComparableValue(comparableValue.TextValues, comparableValue.RawDoubleValue);
                }

                return new SubjectContext(subject, valuesByColumn);
            })
            .Where(context => context != null)
            .Cast<SubjectContext>()
            .ToList();
    }

    private static List<CollectedRow> CollectRows(
        ViewSchedule schedule,
        TableSectionData bodySection,
        IReadOnlyList<ColumnContext> contexts,
        IReadOnlyDictionary<int, ColumnContext> contextByColumnNumber,
        IReadOnlyList<SubjectContext> subjectContexts
    ) {
        var rows = new List<CollectedRow>();
        var skippingLeadingHeaderRows = true;

        for (var rowNumber = bodySection.FirstRowNumber; rowNumber <= bodySection.LastRowNumber; rowNumber++) {
            var values = contexts
                .Select(context =>
                    ScheduleCollectorSupport.SafeGet(() =>
                        schedule.GetCellText(SectionType.Body, rowNumber, context.Column.ColumnNumber)) ?? string.Empty)
                .ToList();
            if (skippingLeadingHeaderRows) {
                var isLeadingHeaderRow =
                    IsHeaderLikeBodyRow(values, contexts)
                    || IsAllTextBodyRow(bodySection, contexts, rowNumber);
                if (isLeadingHeaderRow)
                    continue;

                skippingLeadingHeaderRows = false;
            }

            var rowKind = ClassifyRowKind(bodySection, contexts, rowNumber);
            var binding = BindRow(values, contexts, contextByColumnNumber, subjectContexts, rowKind);
            rows.Add(new CollectedRow(
                new ScheduleRenderedRow(
                    rowNumber,
                    rowKind,
                    values,
                    binding.BindingKind,
                    binding.ResolutionStatus,
                    binding.ResolutionReason,
                    binding.SubjectIds
                ),
                binding.ResolutionStatus
            ));
        }

        return rows;
    }

    private static RowBindingResult BindRow(
        IReadOnlyList<string> values,
        IReadOnlyList<ColumnContext> contexts,
        IReadOnlyDictionary<int, ColumnContext> contextByColumnNumber,
        IReadOnlyList<SubjectContext> subjectContexts,
        ScheduleRenderedRowKind rowKind
    ) {
        if (rowKind != ScheduleRenderedRowKind.Data) {
            return new RowBindingResult(
                ScheduleRenderedRowBindingKind.None,
                ScheduleRenderedRowSubjectResolutionStatus.NotApplicable,
                ScheduleRenderedRowSubjectResolutionReason.NonDataRow,
                []
            );
        }

        if (values.Count != contexts.Count) {
            return new RowBindingResult(
                ScheduleRenderedRowBindingKind.None,
                ScheduleRenderedRowSubjectResolutionStatus.NonBindable,
                ScheduleRenderedRowSubjectResolutionReason.NoComparableValues,
                []
            );
        }

        if (subjectContexts.Count == 0) {
            return new RowBindingResult(
                ScheduleRenderedRowBindingKind.None,
                ScheduleRenderedRowSubjectResolutionStatus.NonBindable,
                ScheduleRenderedRowSubjectResolutionReason.NoVisibleSubjects,
                []
            );
        }

        var comparableValues = values
            .Select((value, index) => {
                var normalizedValue = ScheduleCollectorSupport.NormalizeCellText(value);
                return new ComparableRowValue(
                    contexts[index].Column.ColumnNumber,
                    normalizedValue,
                    contexts[index].IsComparable
                    && !contexts[index].MultipleValueTexts.Contains(normalizedValue)
                );
            })
            .Where(value => value.IsComparable && !string.IsNullOrWhiteSpace(value.Value))
            .ToList();
        if (comparableValues.Count == 0) {
            return new RowBindingResult(
                ScheduleRenderedRowBindingKind.None,
                ScheduleRenderedRowSubjectResolutionStatus.NonBindable,
                ScheduleRenderedRowSubjectResolutionReason.NoComparableValues,
                []
            );
        }

        var matchedSubjectIds = subjectContexts
            .Where(subject =>
                comparableValues.All(value =>
                    subject.ValuesByColumn.TryGetValue(value.ColumnNumber, out var subjectValue)
                    && MatchesComparableValue(contextByColumnNumber, value, subjectValue)))
            .Select(subject => subject.Subject.SubjectId)
            .Distinct()
            .ToList();

        return matchedSubjectIds.Count switch {
            0 => new RowBindingResult(
                ScheduleRenderedRowBindingKind.None,
                ScheduleRenderedRowSubjectResolutionStatus.Unbound,
                ScheduleRenderedRowSubjectResolutionReason.HeuristicMismatch,
                []
            ),
            1 => new RowBindingResult(
                ScheduleRenderedRowBindingKind.SingleSubject,
                ScheduleRenderedRowSubjectResolutionStatus.Bound,
                ScheduleRenderedRowSubjectResolutionReason.None,
                matchedSubjectIds
            ),
            _ => new RowBindingResult(
                ScheduleRenderedRowBindingKind.MultipleSubjects,
                ScheduleRenderedRowSubjectResolutionStatus.Bound,
                ScheduleRenderedRowSubjectResolutionReason.None,
                matchedSubjectIds
            )
        };
    }

    private static bool IsHeaderLikeBodyRow(
        IReadOnlyList<string> values,
        IReadOnlyList<ColumnContext> contexts,
        bool requireAtLeastOneValue = true
    ) {
        if (values.Count != contexts.Count)
            return false;

        var matchedCount = 0;
        for (var i = 0; i < contexts.Count; i++) {
            var rowValue = ScheduleCollectorSupport.NormalizeCellText(values[i]);
            var headerValue = ScheduleCollectorSupport.NormalizeCellText(contexts[i].HeaderText);
            if (!string.Equals(rowValue, headerValue, StringComparison.Ordinal))
                return false;
            matchedCount++;
        }

        return !requireAtLeastOneValue || matchedCount != 0;
    }

    private static ScheduleRenderedRowKind ClassifyRowKind(
        TableSectionData bodySection,
        IReadOnlyList<ColumnContext> contexts,
        int rowNumber
    ) => IsAllTextBodyRow(bodySection, contexts, rowNumber)
        ? ScheduleRenderedRowKind.GroupFooter
        : ScheduleRenderedRowKind.Data;

    private static bool IsAllTextBodyRow(
        TableSectionData bodySection,
        IReadOnlyList<ColumnContext> contexts,
        int rowNumber
    ) {
        if (contexts.Count == 0)
            return false;

        foreach (var context in contexts) {
            var cellType =
                ScheduleCollectorSupport.SafeGet(() => bodySection.GetCellType(rowNumber, context.Column.ColumnNumber));
            if (cellType != CellType.Text)
                return false;
        }

        return true;
    }

    private static BindingSummary SummarizeBinding(
        IReadOnlyList<CollectedRow> rows
    ) {
        var notApplicableRowCount = rows.Count(row =>
            row.ResolutionStatus == ScheduleRenderedRowSubjectResolutionStatus.NotApplicable);
        var nonBindableRowCount = rows.Count(row =>
            row.ResolutionStatus == ScheduleRenderedRowSubjectResolutionStatus.NonBindable);
        var bindableRowCount = rows.Count(row =>
            row.ResolutionStatus is ScheduleRenderedRowSubjectResolutionStatus.Unbound
                or ScheduleRenderedRowSubjectResolutionStatus.Bound);
        var boundRowCount = rows.Count(row =>
            row.ResolutionStatus == ScheduleRenderedRowSubjectResolutionStatus.Bound);
        var unboundRowCount = rows.Count(row =>
            row.ResolutionStatus == ScheduleRenderedRowSubjectResolutionStatus.Unbound);
        var bindingStatus = bindableRowCount == 0 || boundRowCount == 0
            ? ScheduleRenderedBindingStatus.None
            : boundRowCount == bindableRowCount
            ? ScheduleRenderedBindingStatus.Complete
            : ScheduleRenderedBindingStatus.Partial;

        return new BindingSummary(
            bindingStatus,
            notApplicableRowCount,
            nonBindableRowCount,
            bindableRowCount,
            boundRowCount,
            unboundRowCount
        );
    }

    private static bool MatchesComparableValue(
        IReadOnlyDictionary<int, ColumnContext> contextByColumnNumber,
        ComparableRowValue rowValue,
        SubjectComparableValue subjectValue
    ) {
        if (subjectValue.TextValues.Contains(rowValue.Value))
            return true;

        if (!contextByColumnNumber.TryGetValue(rowValue.ColumnNumber, out var context)
            || subjectValue.RawDoubleValue == null)
            return false;

        return TryParseRowDouble(context, rowValue.Value, out var parsedValue)
               && NearlyEquals(parsedValue, subjectValue.RawDoubleValue.Value);
    }

    private static bool TryParseRowDouble(
        ColumnContext context,
        string rowValue,
        out double parsedValue
    ) {
        if (context.SpecTypeId == null || context.SpecTypeId.Empty()) {
            parsedValue = default;
            return false;
        }

        if (context.SpecTypeId == SpecTypeId.Number)
            return double.TryParse(
                rowValue,
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture,
                out parsedValue)
                   || double.TryParse(
                       rowValue,
                       NumberStyles.Float | NumberStyles.AllowThousands,
                       CultureInfo.CurrentCulture,
                       out parsedValue);

        if (!UnitUtils.IsMeasurableSpec(context.SpecTypeId) || context.EffectiveUnits == null) {
            parsedValue = default;
            return false;
        }

        return UnitFormatUtils.TryParse(context.EffectiveUnits, context.SpecTypeId, rowValue, out parsedValue);
    }

    private static bool NearlyEquals(double left, double right) {
        var scale = Math.Max(1d, Math.Max(Math.Abs(left), Math.Abs(right)));
        return Math.Abs(left - right) <= scale * 1e-6;
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

    private sealed record ColumnContext(
        ScheduleRenderedColumn Column,
        ScheduleField Field,
        string FieldName,
        string HeaderText,
        ForgeTypeId? SpecTypeId,
        Units? EffectiveUnits,
        HashSet<string> MultipleValueTexts,
        bool IsComparable
    );

    private sealed record SubjectContext(
        ScheduleRenderedSubject Subject,
        Dictionary<int, SubjectComparableValue> ValuesByColumn
    );

    private sealed record ComparableRowValue(
        int ColumnNumber,
        string Value,
        bool IsComparable
    );

    private sealed record RowBindingResult(
        ScheduleRenderedRowBindingKind BindingKind,
        ScheduleRenderedRowSubjectResolutionStatus ResolutionStatus,
        ScheduleRenderedRowSubjectResolutionReason ResolutionReason,
        List<long> SubjectIds
    );

    private sealed record CollectedRow(
        ScheduleRenderedRow Row,
        ScheduleRenderedRowSubjectResolutionStatus ResolutionStatus
    );

    private sealed record BindingSummary(
        ScheduleRenderedBindingStatus BindingStatus,
        int NotApplicableRowCount,
        int NonBindableRowCount,
        int BindableRowCount,
        int BoundRowCount,
        int UnboundRowCount
    );

    private sealed record SubjectComparableValue(
        HashSet<string> TextValues,
        double? RawDoubleValue
    );
}
