using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.DataTables;

/// <summary>
///     Doc-in/data-out core for synthetic data tables (caller owns the transaction). A data table
///     is a key schedule on the pool category whose fields are pool shared parameters; each row is
///     a key element whose key name is the stable row key. Upsert semantics: rows match by key,
///     cells are parameter writes on the key elements, missing rows are deleted only when
///     <see cref="DataTableSpec.PruneMissingRows" /> is set.
/// </summary>
public static class DataTableEngine {
    public static ScheduleApplyData Apply(Document document, DataTableSpec spec, List<string> warnings) {
        Validate(spec);
        var poolIds = DataTableColumnPool.EnsureBound(document);

        var schedule = FindDataTableSchedule(document, spec.Name)
                       ?? ViewSchedule.CreateKeySchedule(document, ((long)DataTableColumnPool.Category).ToElementId());
        if (!string.Equals(schedule.Name, spec.Name, StringComparison.Ordinal))
            schedule.Name = spec.Name;

        ReconcileFields(schedule, spec, poolIds, warnings);
        document.Regenerate();
        ReconcileRows(document, schedule, spec, warnings);
        document.Regenerate();

        return new ScheduleApplyData {
            Table = Collect(document, schedule),
            Warnings = warnings
        };
    }

    public static DataTableDetailData CollectAll(Document document, DataTableDetailRequest request) {
        var issues = new List<RevitDataIssue>();
        var schedules = new FilteredElementCollector(document)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => IsDataTableSchedule(document, schedule))
            .ToList();

        if (request.Names.Count > 0) {
            var wanted = request.Names.ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var name in wanted.Where(name =>
                         !schedules.Any(schedule => string.Equals(schedule.Name, name, StringComparison.OrdinalIgnoreCase)))) {
                issues.Add(new RevitDataIssue(
                    "DataTableNotFound",
                    RevitDataIssueSeverity.Warning,
                    $"No data table named '{name}' exists in the document."));
            }

            schedules = schedules
                .Where(schedule => wanted.Contains(schedule.Name))
                .ToList();
        }

        return new DataTableDetailData {
            Tables = schedules.Select(schedule => Collect(document, schedule)).ToList(),
            Issues = issues
        };
    }

    public static DataTableHandle Collect(Document document, ViewSchedule schedule) {
        var columns = new List<DataTableColumnHandle>();
        var valueFields = new List<DataTableColumnPool.PoolColumn>();
        var definition = schedule.Definition;
        for (var i = 0; i < definition.GetFieldCount(); i++) {
            var field = definition.GetField(i);
            var poolColumn = DataTableColumnPool.Resolve(document, field.ParameterId);
            if (poolColumn == null)
                continue;

            valueFields.Add(poolColumn);
            columns.Add(new DataTableColumnHandle(
                field.ColumnHeading,
                poolColumn.Kind,
                poolColumn.Name,
                poolColumn.Guid.ToString()));
        }

        // Collector order matches the schedule's displayed row order for key schedules.
        var rows = new FilteredElementCollector(document, schedule.Id)
            .WhereElementIsNotElementType()
            .Select(keyElement => new DataTableRowHandle(
                RowKey(keyElement),
                keyElement.Id.Value(),
                keyElement.UniqueId) {
                Values = valueFields
                    .Select(poolColumn => ReadCell(keyElement, poolColumn))
                    .ToList()
            })
            .ToList();

        var placements = new FilteredElementCollector(document)
            .OfClass(typeof(ScheduleSheetInstance))
            .Cast<ScheduleSheetInstance>()
            .Where(instance => instance.ScheduleId == schedule.Id)
            .Select(instance => document.GetElement(instance.OwnerViewId))
            .OfType<ViewSheet>()
            .Select(sheet => new DataTablePlacementHandle(sheet.Id.Value(), sheet.SheetNumber, sheet.Name))
            .ToList();

        return new DataTableHandle(schedule.Name, schedule.Id.Value(), schedule.UniqueId) {
            Columns = columns,
            Rows = rows,
            Placements = placements
        };
    }

    public static DataTablePlacementHandle Place(
        Document document,
        ViewSchedule schedule,
        ScheduleSheetPlacementSpec placement
    ) {
        var sheet = Sheets.SheetResolver.ByNumberOrName(document, placement.Sheet)
            ?? throw new InvalidOperationException($"No sheet with number or name '{placement.Sheet}'.");

        var alreadyPlaced = new FilteredElementCollector(document, sheet.Id)
            .OfClass(typeof(ScheduleSheetInstance))
            .Cast<ScheduleSheetInstance>()
            .Any(instance => instance.ScheduleId == schedule.Id);
        if (!alreadyPlaced) {
            var origin = new XYZ(placement.OriginX ?? 1.0, placement.OriginY ?? 1.0, 0);
            _ = ScheduleSheetInstance.Create(document, sheet.Id, schedule.Id, origin);
        }

        return new DataTablePlacementHandle(sheet.Id.Value(), sheet.SheetNumber, sheet.Name);
    }

    public static ViewSchedule? FindDataTableSchedule(Document document, string name) =>
        new FilteredElementCollector(document)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .FirstOrDefault(schedule =>
                string.Equals(schedule.Name, name, StringComparison.OrdinalIgnoreCase) &&
                IsDataTableSchedule(document, schedule));

    private static bool IsDataTableSchedule(Document document, ViewSchedule schedule) {
        if (schedule.IsTemplate || !schedule.Definition.IsKeySchedule)
            return false;
        if (schedule.Definition.CategoryId != ((long)DataTableColumnPool.Category).ToElementId())
            return false;

        var definition = schedule.Definition;
        for (var i = 0; i < definition.GetFieldCount(); i++) {
            if (DataTableColumnPool.IsPoolParameter(document, definition.GetField(i).ParameterId))
                return true;
        }

        return false;
    }

    private static void Validate(DataTableSpec spec) {
        if (string.IsNullOrWhiteSpace(spec.Name))
            throw new ArgumentException("Data table name is required.");
        if (spec.Columns.Count == 0)
            throw new ArgumentException("A data table needs at least one column.");

        foreach (var kind in new[] { DataTableColumnKind.Text, DataTableColumnKind.Number }) {
            var requested = spec.Columns.Count(column => column.Kind == kind);
            var available = DataTableColumnPool.OfKind(kind).Count();
            if (requested > available) {
                throw new ArgumentException(
                    $"Data table requests {requested} {kind} columns; the pool has {available}.");
            }
        }

        var duplicateKeys = spec.Rows
            .GroupBy(row => row.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateKeys.Count > 0)
            throw new ArgumentException($"Duplicate row keys: {string.Join(", ", duplicateKeys)}.");
        if (spec.Rows.Any(row => string.IsNullOrWhiteSpace(row.Key)))
            throw new ArgumentException("Every row needs a non-empty key.");
    }

    /// <summary>
    ///     Makes the schedule's pool fields match the spec's columns exactly, in order: assigns
    ///     pool parameters per kind, applies headings and widths, hides or shows the key column,
    ///     and removes pool fields no longer used.
    /// </summary>
    private static void ReconcileFields(
        ViewSchedule schedule,
        DataTableSpec spec,
        Dictionary<Guid, ElementId> poolIds,
        List<string> warnings
    ) {
        var definition = schedule.Definition;

        // Assign pool params to spec columns in kind order (first Text column -> Text A, ...).
        var assignments = new List<(DataTableColumnSpec Column, DataTableColumnPool.PoolColumn Pool)>();
        foreach (var kind in new[] { DataTableColumnKind.Text, DataTableColumnKind.Number }) {
            var pool = DataTableColumnPool.OfKind(kind).ToList();
            var index = 0;
            foreach (var column in spec.Columns.Where(column => column.Kind == kind))
                assignments.Add((column, pool[index++]));
        }

        var usedIds = assignments
            .Select(assignment => poolIds[assignment.Pool.Guid])
            .ToHashSet();

        // Remove pool fields that are no longer used; leave the key-name field and any
        // user-added non-pool fields alone.
        for (var i = definition.GetFieldCount() - 1; i >= 0; i--) {
            var field = definition.GetField(i);
            if (DataTableColumnPool.IsPoolParameter(schedule.Document, field.ParameterId) &&
                !usedIds.Contains(field.ParameterId))
                definition.RemoveField(field.FieldId);
        }

        // Ensure a field per assignment, then apply heading/width.
        foreach (var (column, pool) in assignments) {
            var parameterId = poolIds[pool.Guid];
            var field = FindField(definition, parameterId);
            if (field == null) {
                var schedulable = definition.GetSchedulableFields()
                    .FirstOrDefault(candidate => candidate.ParameterId == parameterId);
                if (schedulable == null) {
                    warnings.Add($"Pool parameter '{pool.Name}' is not schedulable; column '{column.Heading}' skipped.");
                    continue;
                }

                field = definition.AddField(schedulable);
            }

            field.ApplyColumnBasics(column.Heading, sheetColumnWidth: column.ColumnWidth);
        }

        // ponytail: column display order = pool order within kind (Text block then Number block),
        // not spec order across kinds. Reorder via ScheduleDefinition field moves if it matters.
        FindField(definition, ((long)BuiltInParameter.REF_TABLE_ELEM_NAME).ToElementId())
            ?.ApplyColumnBasics(isHidden: !spec.ShowKeyColumn);
    }

    private static void ReconcileRows(
        Document document,
        ViewSchedule schedule,
        DataTableSpec spec,
        List<string> warnings
    ) {
        var existingByKey = CollectKeyElements(document, schedule)
            .GroupBy(RowKey, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        var specKeys = spec.Rows.Select(row => row.Key).ToHashSet(StringComparer.Ordinal);
        if (spec.PruneMissingRows) {
            foreach (var (key, element) in existingByKey.Where(entry => !specKeys.Contains(entry.Key)).ToList()) {
                _ = document.Delete(element.Id);
                _ = existingByKey.Remove(key);
            }
        }

        foreach (var row in spec.Rows) {
            if (!existingByKey.TryGetValue(row.Key, out var element)) {
                element = InsertKeyRow(document, schedule, row.Key);
                existingByKey[row.Key] = element;
            }

            WriteCells(element, spec, row, warnings);
        }
    }

    private static Element InsertKeyRow(Document document, ViewSchedule schedule, string key) {
        // InsertRow creates the key element; identify it by diffing the schedule's element set.
        // TableSectionData is re-fetched per insert — it goes stale across Regenerate calls.
        var before = CollectKeyElements(document, schedule).Select(element => element.Id).ToHashSet();
        var body = schedule.GetTableData().GetSectionData(SectionType.Body);
        body.InsertRow(body.LastRowNumber + 1);
        document.Regenerate();

        var created = CollectKeyElements(document, schedule)
                          .FirstOrDefault(element => !before.Contains(element.Id))
                      ?? throw new InvalidOperationException(
                          $"InsertRow produced no new key element for row '{key}'.");

        var keyName = created.get_Parameter(BuiltInParameter.REF_TABLE_ELEM_NAME);
        if (keyName is { IsReadOnly: false })
            _ = keyName.Set(key);
        else
            created.Name = key;
        return created;
    }

    private static void WriteCells(Element element, DataTableSpec spec, DataTableRowSpec row, List<string> warnings) {
        for (var i = 0; i < spec.Columns.Count && i < row.Values.Count; i++) {
            var column = spec.Columns[i];
            var value = row.Values[i];
            var parameter = element.LookupParameter(PoolNameFor(spec, i));
            if (parameter == null) {
                warnings.Add($"Row '{row.Key}': column '{column.Heading}' has no parameter.");
                continue;
            }

            // Blank number cells clear to 0 — the pool spec is unitless Number.
            if (column.Kind == DataTableColumnKind.Number && string.IsNullOrWhiteSpace(value))
                value = "0";

            if (!parameter.TrySetFromString(value, out var error))
                warnings.Add($"Row '{row.Key}', column '{column.Heading}': {error}");
        }
    }

    private static string PoolNameFor(DataTableSpec spec, int columnIndex) {
        var column = spec.Columns[columnIndex];
        var ordinalWithinKind = spec.Columns
            .Take(columnIndex)
            .Count(candidate => candidate.Kind == column.Kind);
        return DataTableColumnPool.OfKind(column.Kind).ElementAt(ordinalWithinKind).Name;
    }

    private static List<Element> CollectKeyElements(Document document, ViewSchedule schedule) =>
        new FilteredElementCollector(document, schedule.Id)
            .WhereElementIsNotElementType()
            .ToList();

    private static string RowKey(Element keyElement) =>
        keyElement.get_Parameter(BuiltInParameter.REF_TABLE_ELEM_NAME)?.AsString()
        ?? keyElement.Name;

    private static ScheduleField? FindField(ScheduleDefinition definition, ElementId parameterId) {
        for (var i = 0; i < definition.GetFieldCount(); i++) {
            var field = definition.GetField(i);
            if (field.ParameterId == parameterId)
                return field;
        }

        return null;
    }

    private static string? ReadCell(Element keyElement, DataTableColumnPool.PoolColumn poolColumn) =>
        keyElement.LookupParameter(poolColumn.Name)?.AsInvariantString();
}
