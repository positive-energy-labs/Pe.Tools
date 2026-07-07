using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Serilog;
using System.Globalization;

namespace Pe.Revit.DocumentData.Schedules.Collect;

public static class ScheduleQueryCollector {
    private const long SlowScheduleProjectionThresholdMs = 250;

    public static ScheduleQueryData Collect(
        Document doc,
        ScheduleQuery? query = null,
        View? activeView = null
    ) {
        var issues = new List<RevitDataIssue>();
        var effectiveQuery = query ?? new ScheduleQuery();
        var budget = RevitDataOutputBudgets.WithDefaults(effectiveQuery.Budget, maxEntries: 5, maxRowsPerEntry: 25);
        effectiveQuery = effectiveQuery with { Budget = budget };
        var resolution = ResolveQuery(doc, effectiveQuery, activeView, issues);
        AddResolutionDiagnostics(resolution, issues);
        var allEntries = resolution.Schedules
            .Select(schedule => TryCollectProjection(doc, schedule, effectiveQuery, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleRenderedScheduleEntry>()
            .ToList();
        var maxEntries = effectiveQuery.Budget?.MaxEntries;
        var entries = maxEntries is > 0
            ? allEntries.Take(maxEntries.Value).ToList()
            : allEntries;
        var truncated = maxEntries is > 0 && allEntries.Count > entries.Count;
        if (truncated) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleQueryTruncated",
                $"Returned {entries.Count} of {allEntries.Count} matching schedule(s). Increase budget.maxEntries to expand."
            ));
        }

        return new ScheduleQueryData(
            doc.Title,
            resolution.QueryKind,
            resolution.RequestedScheduleCount,
            entries.Count,
            entries,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(allEntries.Count, entries.Count, truncated)
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

    private static void AddResolutionDiagnostics(
        QueryResolution resolution,
        List<RevitDataIssue> issues
    ) {
        if (resolution.RequestedScheduleCount == 0) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleQueryNoScheduleReferencesSupplied",
                resolution.QueryKind switch {
                    ScheduleQueryKind.ScheduleNames => "Schedule query requested names but no non-blank scheduleNames were supplied.",
                    ScheduleQueryKind.ScheduleReferences => "Schedule query requested references but no scheduleIds or scheduleUniqueIds were supplied.",
                    _ => "Schedule query did not include a usable schedule reference."
                }
            ));
        }

        if (resolution.RequestedScheduleCount != 0 && resolution.Schedules.Count == 0) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleQueryResolvedZeroSchedules",
                $"Resolved zero schedule(s) from {resolution.RequestedScheduleCount} requested reference(s). Use revit.catalog.schedules to discover valid schedule handles."
            ));
        }
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
        ScheduleQuery query,
        List<RevitDataIssue> issues
    ) {
        var totalStopwatch = Stopwatch.StartNew();
        long sheetPlacementsMs = 0;
        long visibleSubjectsMs = 0;
        long subjectsMs = 0;
        long bodySectionMs = 0;
        long columnContextsMs = 0;
        long subjectContextsMs = 0;
        long rowsMs = 0;
        long projectRowsMs = 0;
        long bindingsMs = 0;

        try {
            var sheetPlacements = Measure(
                () => ScheduleCollectorSupport.CollectSheetPlacements(doc, schedule),
                out sheetPlacementsMs
            );
            var subjectElements = Measure(
                () => ScheduleRenderedSubjectCollector.CollectVisibleSubjects(doc, schedule),
                out visibleSubjectsMs
            );
            var subjects = Measure(
                () => ScheduleRenderedSubjectCollector.CollectSubjects(subjectElements),
                out subjectsMs
            );
            var bodySection = Measure(
                () => ScheduleCollectorSupport.SafeGet(() => schedule.GetTableData().GetSectionData(SectionType.Body)),
                out bodySectionMs
            );
            var contexts = bodySection == null
                ? []
                : Measure(
                    () => CollectColumnContexts(doc, schedule, bodySection),
                    out columnContextsMs
                );
            var contextByColumnNumber = contexts.ToDictionary(context => context.Column.ColumnNumber);
            var comparableContexts = contexts
                .Where(context => context.IsComparable)
                .ToList();
            // One cache per schedule, shared by subject comparable reads and binding resolution:
            // both phases resolve parameters on the same source elements.
            var resolutionCache = new ScheduleParameterResolutionCache(doc);
            var subjectContexts = bodySection == null
                ? []
                : Measure(
                    () => CollectSubjectContexts(doc, comparableContexts, subjectElements, subjects, resolutionCache),
                    out subjectContextsMs
                );
            var collectedRows = bodySection == null
                ? []
                : Measure(
                    () => CollectRows(schedule, bodySection, contexts, contextByColumnNumber, subjectContexts),
                    out rowsMs
                );
            var rows = collectedRows.Select(item => item.Row).ToList();
            var bindingSummary = SummarizeBinding(collectedRows);
            var projection = query.Projection ?? new ScheduleQueryProjection();
            var projectedRows = Measure(
                () => ProjectRows(schedule.Name, rows, contexts, projection, query.Budget, issues),
                out projectRowsMs
            );
            if (projection.IncludeBindings && contexts.Count != 0) {
                // Post-projection so only surviving rows pay resolution cost.
                projectedRows = Measure(
                    () => ResolveRowBindings(doc, projectedRows, contexts, subjectElements, resolutionCache),
                    out bindingsMs
                );
            }

            var rowIssues = projectedRows.SelectMany(row => row.Issues ?? []).ToList();
            var includeAll = projection.View == RevitDataResultView.Full;
            var includeRows = includeAll || projection.View == RevitDataResultView.Rows || projection.IncludeRows || projection.IncludeOnlyRowsWithIssues;
            var includeColumns = includeAll || projection.IncludeColumns || includeRows;
            var includeSubjects = includeAll || projection.View == RevitDataResultView.Handles || projection.IncludeSubjects;

            if (subjects.Count != 0) {
                if (bindingSummary.UnboundRowCount != 0) {
                    issues.Add(ScheduleCollectorSupport.Warning(
                        "ScheduleRowSubjectBindingIncomplete",
                        $"{bindingSummary.UnboundRowCount} bindable data row(s) could not be bound to visible schedule subjects.",
                        schedule.Name
                    ));
                }
            }

            LogSlowProjection(
                schedule,
                totalStopwatch.ElapsedMilliseconds,
                sheetPlacementsMs,
                visibleSubjectsMs,
                subjectsMs,
                bodySectionMs,
                columnContextsMs,
                subjectContextsMs,
                rowsMs,
                projectRowsMs,
                bindingsMs,
                subjectElements.Count,
                subjects.Count,
                contexts.Count,
                rows.Count,
                projectedRows.Count,
                bindingSummary
            );

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
                includeSubjects ? subjects : [],
                includeColumns ? contexts.Select(context => context.Column).ToList() : [],
                includeRows ? projectedRows : [],
                rowIssues
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

    private static void LogSlowProjection(
        ViewSchedule schedule,
        long totalMs,
        long sheetPlacementsMs,
        long visibleSubjectsMs,
        long subjectsMs,
        long bodySectionMs,
        long columnContextsMs,
        long subjectContextsMs,
        long rowsMs,
        long projectRowsMs,
        long bindingsMs,
        int visibleSubjectElementCount,
        int subjectCount,
        int columnCount,
        int rowCount,
        int projectedRowCount,
        BindingSummary bindingSummary
    ) {
        if (totalMs < SlowScheduleProjectionThresholdMs)
            return;

        Log.Information(
            "ScheduleQuery slow projection: Schedule={ScheduleName}, ScheduleId={ScheduleId}, TotalMs={TotalMs}, SheetPlacementsMs={SheetPlacementsMs}, VisibleSubjectsMs={VisibleSubjectsMs}, SubjectDtosMs={SubjectDtosMs}, BodySectionMs={BodySectionMs}, ColumnContextsMs={ColumnContextsMs}, SubjectContextsMs={SubjectContextsMs}, RowsMs={RowsMs}, ProjectRowsMs={ProjectRowsMs}, BindingsMs={BindingsMs}, VisibleSubjectElements={VisibleSubjectElements}, Subjects={Subjects}, Columns={Columns}, Rows={Rows}, ProjectedRows={ProjectedRows}, BoundRows={BoundRows}, UnboundRows={UnboundRows}",
            schedule.Name,
            schedule.Id.Value(),
            totalMs,
            sheetPlacementsMs,
            visibleSubjectsMs,
            subjectsMs,
            bodySectionMs,
            columnContextsMs,
            subjectContextsMs,
            rowsMs,
            projectRowsMs,
            bindingsMs,
            visibleSubjectElementCount,
            subjectCount,
            columnCount,
            rowCount,
            projectedRowCount,
            bindingSummary.BoundRowCount,
            bindingSummary.UnboundRowCount
        );
    }

    private static T Measure<T>(Func<T> action, out long elapsedMilliseconds) {
        var stopwatch = Stopwatch.StartNew();
        var result = action();
        elapsedMilliseconds = stopwatch.ElapsedMilliseconds;
        return result;
    }


    private static List<ScheduleRenderedRow> ProjectRows(
        string scheduleName,
        IReadOnlyList<ScheduleRenderedRow> rows,
        IReadOnlyList<ColumnContext> contexts,
        ScheduleQueryProjection projection,
        RevitDataOutputBudget? budget,
        List<RevitDataIssue> issues
    ) {
        var auditedRows = projection.RequiredFieldAudit == null
            ? rows
            : rows.Select(row => row with { Issues = CollectRequiredFieldIssues(row, contexts, projection.RequiredFieldAudit) }).ToList();
        if (projection.IncludeOnlyRowsWithIssues)
            auditedRows = auditedRows.Where(row => row.Issues?.Count > 0).ToList();

        if (projection.RequiredFieldAudit != null && auditedRows.Count == 0) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleRequiredFieldAuditNoRows",
                $"Required-field audit produced zero rows for schedule '{scheduleName}'. Check field names or remove includeOnlyRowsWithIssues.",
                scheduleName
            ));
        }

        var maxRows = budget?.MaxRowsPerEntry;
        var returnedRows = maxRows is > -1
            ? auditedRows.Take(maxRows.Value).ToList()
            : auditedRows.ToList();
        if (maxRows is > -1 && auditedRows.Count > returnedRows.Count) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleRowsTruncated",
                $"Returned {returnedRows.Count} of {auditedRows.Count} row(s) for schedule '{scheduleName}'. Increase budget.maxRowsPerEntry to expand.",
                scheduleName
            ));
        }

        if (projection.IncludeCellValues || projection.View == RevitDataResultView.Full)
            return returnedRows;

        return returnedRows.Select(row => row with { Values = [] }).ToList();
    }

    private static List<ScheduleRenderedCellIssue> CollectRequiredFieldIssues(
        ScheduleRenderedRow row,
        IReadOnlyList<ColumnContext> contexts,
        ScheduleRequiredFieldAudit audit
    ) {
        if (row.Kind != ScheduleRenderedRowKind.Data)
            return [];

        var fieldNames = ScheduleCollectorSupport.ToFilterSet(audit.FieldNames);
        var issues = new List<ScheduleRenderedCellIssue>();
        for (var i = 0; i < contexts.Count && i < row.Values.Count; i++) {
            var context = contexts[i];
            if (fieldNames.Count != 0
                && !fieldNames.Contains(context.Column.FieldName)
                && !fieldNames.Contains(context.Column.HeaderText))
                continue;

            var normalized = ScheduleCollectorSupport.NormalizeCellText(row.Values[i]);
            var isBlank = string.IsNullOrWhiteSpace(normalized)
                || (audit.TreatDashAsBlank && normalized is "-" or "--" or "—");
            var isDefault = audit.TreatZeroAsDefault && (normalized == "0" || normalized == "0.0" || normalized == "0.00");
            if (!isBlank && !isDefault)
                continue;

            var code = isBlank ? "RequiredScheduleFieldBlank" : "RequiredScheduleFieldDefault";
            issues.Add(new ScheduleRenderedCellIssue(
                row.RowNumber,
                context.Column.ColumnNumber,
                context.Column.FieldName,
                context.Column.HeaderText,
                code,
                $"{context.Column.HeaderText} is {(isBlank ? "blank" : "default/zero")}."
            ));
        }

        return issues;
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
                ) {
                    Parameter = new ScheduleFieldParameterDescriptor(
                        new ParameterDefinitionDescriptor(
                            ScheduleCollectorSupport.BuildFieldIdentity(doc, field, fieldName),
                            null,
                            ScheduleCollectorSupport.GetFieldSpecTypeKey(field),
                            null,
                            null,
                            null
                        ),
                        ScheduleCollectorSupport.GetFieldTypeName(field)
                    ),
                    IsCalculated = field.IsCalculatedField,
                    IsCombinedParameter = field.IsCombinedParameterField
                },
                field,
                fieldName,
                headerText,
                specTypeId,
                ScheduleCollectorSupport.BuildEffectiveUnits(doc, bodySection, visibleColumnNumber, field, specTypeId),
                ScheduleCollectorSupport.GetMultipleValueTexts(field),
                // HasSchedulableField matters here: subjects can never produce comparable values for
                // synthetic fields like Count, so treating them as comparable makes BindRow demand a
                // match no subject can supply and every row in the schedule goes Unbound.
                ScheduleCollectorSupport.IsComparableField(field) && field.HasSchedulableField
            ));
            visibleColumnNumber++;
        }

        return contexts;
    }

    private static List<ScheduleRenderedRow> ResolveRowBindings(
        Document doc,
        IReadOnlyList<ScheduleRenderedRow> rows,
        IReadOnlyList<ColumnContext> contexts,
        IReadOnlyList<Element> subjectElements,
        ScheduleParameterResolutionCache resolutionCache
    ) {
        var bindingColumns = contexts
            .Select(context => new ScheduleBindingResolver.BindingColumn(
                context.Column.ColumnNumber,
                context.Field,
                context.FieldName
            ))
            .ToList();
        var subjectElementsById = subjectElements.ToDictionary(element => element.Id.Value());
        return rows
            .Select(row => {
                if (row.ResolutionStatus != ScheduleRenderedRowSubjectResolutionStatus.Bound)
                    return row;

                var boundElements = row.SubjectIds
                    .Select(subjectId => subjectElementsById.GetValueOrDefault(subjectId))
                    .Where(element => element != null)
                    .Cast<Element>()
                    .ToList();
                return boundElements.Count == 0
                    ? row
                    : row with {
                        Bindings = ScheduleBindingResolver.ResolveRow(doc, bindingColumns, boundElements, resolutionCache)
                    };
            })
            .ToList();
    }

    private static List<SubjectContext> CollectSubjectContexts(
        Document doc,
        IReadOnlyList<ColumnContext> contexts,
        IReadOnlyList<Element> subjectElements,
        IReadOnlyList<ScheduleRenderedSubject> subjects,
        ScheduleParameterResolutionCache resolutionCache
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
                        context.EffectiveUnits,
                        resolutionCache
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

        // A column only participates in binding if at least one subject actually produced a value
        // for it. Synthetic columns (Count reports a schedulable field with an invalid parameter id)
        // render cell text no subject read can ever match — requiring them unbinds every row.
        var subjectValueColumns = subjectContexts
            .SelectMany(subject => subject.ValuesByColumn.Keys)
            .ToHashSet();
        var comparableValues = values
            .Select((value, index) => {
                var normalizedValue = ScheduleCollectorSupport.NormalizeCellText(value);
                return new ComparableRowValue(
                    contexts[index].Column.ColumnNumber,
                    normalizedValue,
                    contexts[index].IsComparable
                    && subjectValueColumns.Contains(contexts[index].Column.ColumnNumber)
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
