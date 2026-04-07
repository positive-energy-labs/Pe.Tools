using Pe.Revit.FamilyFoundry.OperationSettings;

namespace Pe.Revit.FamilyFoundry.LookupTables;

internal static class LookupTableValidator {
    public static void Validate(SetLookupTablesSettings settings) {
        if (settings == null)
            throw new ArgumentNullException(nameof(settings));

        var duplicateNames = settings.Tables
            .Select(table => table.Schema.Name?.Trim())
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .GroupBy(name => name!, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        if (duplicateNames.Length > 0) {
            throw new InvalidOperationException(
                $"Duplicate lookup-table names: {string.Join(", ", duplicateNames)}.");
        }

        foreach (var table in settings.Tables)
            Validate(table);
    }

    public static void Validate(LookupTableDefinition table) {
        if (table == null)
            throw new ArgumentNullException(nameof(table));

        var schema = table.Schema ?? throw new InvalidOperationException("Lookup table is missing a schema.");
        var tableName = schema.Name?.Trim();
        if (string.IsNullOrWhiteSpace(tableName))
            throw new InvalidOperationException("Lookup table schema is missing required Name.");

        if (schema.Transport != LookupTableTransport.RevitCsv)
            throw new InvalidOperationException($"Lookup table '{tableName}' uses unsupported transport '{schema.Transport}'.");

        if (schema.Columns.Count == 0)
            throw new InvalidOperationException($"Lookup table '{tableName}' must define at least one schema column.");
        if (table.Rows.Count == 0)
            throw new InvalidOperationException($"Lookup table '{tableName}' must define at least one row.");

        var duplicateColumns = schema.Columns
            .Select(column => column.Name?.Trim())
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .GroupBy(name => name!, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        if (duplicateColumns.Length > 0) {
            throw new InvalidOperationException(
                $"Lookup table '{tableName}' contains duplicate column names: {string.Join(", ", duplicateColumns)}.");
        }

        for (var columnIndex = 0; columnIndex < schema.Columns.Count; columnIndex++) {
            var column = schema.Columns[columnIndex];
            var columnName = column.Name?.Trim();
            if (string.IsNullOrWhiteSpace(columnName)) {
                throw new InvalidOperationException(
                    $"Lookup table '{tableName}' column {columnIndex + 1} is missing required Name.");
            }
        }

        var firstValueColumnIndex = schema.Columns.FindIndex(column => column.Role == LookupTableColumnRole.Value);
        if (firstValueColumnIndex < 0) {
            throw new InvalidOperationException(
                $"Lookup table '{tableName}' must define at least one value column.");
        }

        for (var columnIndex = firstValueColumnIndex + 1; columnIndex < schema.Columns.Count; columnIndex++) {
            if (schema.Columns[columnIndex].Role == LookupTableColumnRole.LookupKey) {
                throw new InvalidOperationException(
                    $"Lookup table '{tableName}' must keep lookup-key columns contiguous before value columns.");
            }
        }

        var keyColumns = schema.Columns
            .Where(column => column.Role == LookupTableColumnRole.LookupKey)
            .Select(column => column.Name)
            .ToArray();

        var duplicateKeySets = table.Rows
            .Select((row, index) => new {
                Row = row,
                Index = index,
                Key = string.Join("\u001F", keyColumns.Select(columnName => GetRequiredCell(tableName, row, columnName).Trim()))
            })
            .GroupBy(x => x.Key, StringComparer.Ordinal)
            .Where(group => keyColumns.Length > 0 && group.Count() > 1)
            .Select(group => string.Join(", ", group.Select(item => item.Row.RowName)))
            .ToArray();
        if (duplicateKeySets.Length > 0) {
            throw new InvalidOperationException(
                $"Lookup table '{tableName}' contains duplicate lookup-key rows: {string.Join(" | ", duplicateKeySets)}.");
        }

        for (var rowIndex = 0; rowIndex < table.Rows.Count; rowIndex++) {
            var row = table.Rows[rowIndex];
            if (string.IsNullOrWhiteSpace(row.RowName)) {
                throw new InvalidOperationException(
                    $"Lookup table '{tableName}' row {rowIndex + 1} is missing required RowName.");
            }

            foreach (var column in schema.Columns) {
                _ = GetRequiredCell(tableName, row, column.Name);
            }

            var extraColumns = row.ValuesByColumn.Keys
                .Where(columnName => !schema.Columns.Any(column => string.Equals(column.Name, columnName, StringComparison.Ordinal)))
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray();
            if (extraColumns.Length > 0) {
                throw new InvalidOperationException(
                    $"Lookup table '{tableName}' row '{row.RowName}' contains unknown columns: {string.Join(", ", extraColumns)}.");
            }
        }
    }

    private static string GetRequiredCell(string tableName, LookupTableRow row, string columnName) {
        if (!row.ValuesByColumn.TryGetValue(columnName, out var value)) {
            throw new InvalidOperationException(
                $"Lookup table '{tableName}' row '{row.RowName}' is missing required column '{columnName}'.");
        }

        return value ?? string.Empty;
    }
}
