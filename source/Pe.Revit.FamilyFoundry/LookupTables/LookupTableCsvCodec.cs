using Pe.Revit.FamilyFoundry.OperationSettings;
using System.Text;

namespace Pe.Revit.FamilyFoundry.LookupTables;

internal static class LookupTableCsvCodec {
    public static string Encode(LookupTableDefinition table) {
        ArgumentNullException.ThrowIfNull(table);

        LookupTableValidator.Validate(table);

        var builder = new StringBuilder();
        var schema = table.Schema;
        var orderedColumns = schema.Columns;

        WriteCsvRow(builder, [string.Empty, .. orderedColumns.Select(EncodeHeader)]);
        foreach (var row in table.Rows) {
            var cells = new List<string>(orderedColumns.Count + 1) { row.RowName };
            cells.AddRange(orderedColumns.Select(column => row.ValuesByColumn[column.Name]));
            WriteCsvRow(builder, cells);
        }

        return builder.ToString();
    }

    public static LookupTableDefinition Decode(
        string tableName,
        string csvContent,
        int inferredLookupKeyCount = 0
    ) {
        ArgumentException.ThrowIfNullOrWhiteSpace(tableName);
        ArgumentNullException.ThrowIfNull(csvContent);

        var rows = ReadCsvRows(csvContent);
        if (rows.Count == 0)
            throw new InvalidOperationException($"Lookup table '{tableName}' CSV content is empty.");

        var headers = rows[0];
        if (headers.Count == 0)
            throw new InvalidOperationException($"Lookup table '{tableName}' CSV header row is empty.");

        var normalizedLookupKeyCount = Math.Clamp(inferredLookupKeyCount, 0, Math.Max(0, headers.Count - 1));
        var columns = headers
            .Skip(1)
            .Select((header, index) => DecodeHeader(
                header,
                index < normalizedLookupKeyCount ? LookupTableColumnRole.LookupKey : LookupTableColumnRole.Value))
            .ToList();

        var dataRows = rows
            .Skip(1)
            .Select((cells, index) => DecodeRow(tableName, index + 1, columns, cells))
            .ToList();

        return new LookupTableDefinition {
            Schema = new LookupTableSchema {
                Name = tableName.Trim(),
                Columns = columns
            },
            Rows = dataRows
        };
    }

    private static LookupTableColumn DecodeHeader(string header, LookupTableColumnRole role) {
        var headerParts = (header ?? string.Empty).Split("##", StringSplitOptions.None);
        var name = headerParts.Length > 0 ? headerParts[0].Trim() : string.Empty;
        var typeToken = headerParts.Length > 1 ? headerParts[1].Trim() : null;
        var unitToken = headerParts.Length > 2
            ? string.Join("##", headerParts.Skip(2)).Trim()
            : null;

        return new LookupTableColumn {
            Name = name,
            LogicalType = InferLogicalType(typeToken, unitToken),
            RevitTypeToken = string.IsNullOrWhiteSpace(typeToken) ? null : typeToken,
            Role = role,
            UnitToken = string.IsNullOrWhiteSpace(unitToken) ? null : unitToken
        };
    }

    private static LookupTableRow DecodeRow(
        string tableName,
        int rowNumber,
        IReadOnlyList<LookupTableColumn> columns,
        IReadOnlyList<string> cells
    ) {
        if (cells.Count > columns.Count + 1) {
            throw new InvalidOperationException(
                $"Lookup table '{tableName}' row {rowNumber} contains more cells than headers.");
        }

        var valuesByColumn = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var columnIndex = 0; columnIndex < columns.Count; columnIndex++) {
            var value = columnIndex + 1 < cells.Count ? cells[columnIndex + 1] : string.Empty;
            valuesByColumn[columns[columnIndex].Name] = value;
        }

        return new LookupTableRow {
            RowName = cells.Count > 0 ? cells[0] : string.Empty,
            ValuesByColumn = valuesByColumn
        };
    }

    private static LookupTableLogicalType InferLogicalType(string? typeToken, string? unitToken) {
        var normalizedTypeToken = typeToken?.Trim().ToLowerInvariant();
        return normalizedTypeToken switch {
            "length" => LookupTableLogicalType.Length,
            "area" => LookupTableLogicalType.Area,
            "volume" => LookupTableLogicalType.Volume,
            "angle" => LookupTableLogicalType.Angle,
            "number" when string.Equals(unitToken, "percentage", StringComparison.OrdinalIgnoreCase) =>
                LookupTableLogicalType.Percent,
            "number" => LookupTableLogicalType.Number,
            "other" => LookupTableLogicalType.Text,
            _ when !string.IsNullOrWhiteSpace(unitToken) => LookupTableLogicalType.Number,
            _ => LookupTableLogicalType.Text
        };
    }

    private static string EncodeHeader(LookupTableColumn column) {
        var typeToken = NormalizeTypeToken(column);
        var unitToken = NormalizeUnitToken(column);
        return string.IsNullOrWhiteSpace(unitToken)
            ? $"{column.Name}##{typeToken}"
            : $"{column.Name}##{typeToken}##{unitToken}";
    }

    private static string NormalizeTypeToken(LookupTableColumn column) {
        if (!string.IsNullOrWhiteSpace(column.RevitTypeToken))
            return column.RevitTypeToken.Trim();

        return column.LogicalType switch {
            LookupTableLogicalType.Text => "other",
            LookupTableLogicalType.Bool => "other",
            LookupTableLogicalType.Int => "other",
            LookupTableLogicalType.Number => "number",
            LookupTableLogicalType.Length => "length",
            LookupTableLogicalType.Area => "area",
            LookupTableLogicalType.Volume => "volume",
            LookupTableLogicalType.Angle => "angle",
            LookupTableLogicalType.Percent => "number",
            _ => throw new InvalidOperationException($"Unsupported lookup-table logical type '{column.LogicalType}'.")
        };
    }

    private static string? NormalizeUnitToken(LookupTableColumn column) {
        if (!string.IsNullOrWhiteSpace(column.UnitToken))
            return column.UnitToken.Trim();

        return column.LogicalType switch {
            LookupTableLogicalType.Number => "general",
            LookupTableLogicalType.Length => "feet",
            LookupTableLogicalType.Area => "square_feet",
            LookupTableLogicalType.Volume => "cubic_feet",
            LookupTableLogicalType.Angle => "degrees",
            LookupTableLogicalType.Percent => "percentage",
            _ => null
        };
    }

    private static List<List<string>> ReadCsvRows(string csvContent) {
        var rows = new List<List<string>>();
        var currentRow = new List<string>();
        var currentCell = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < csvContent.Length; i++) {
            var currentChar = csvContent[i];
            if (inQuotes) {
                if (currentChar == '"') {
                    if (i + 1 < csvContent.Length && csvContent[i + 1] == '"') {
                        currentCell.Append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    currentCell.Append(currentChar);
                }

                continue;
            }

            switch (currentChar) {
            case '"':
                inQuotes = true;
                break;
            case ',':
                currentRow.Add(currentCell.ToString());
                currentCell.Clear();
                break;
            case '\r':
                if (i + 1 < csvContent.Length && csvContent[i + 1] == '\n')
                    i++;
                currentRow.Add(currentCell.ToString());
                currentCell.Clear();
                rows.Add(currentRow);
                currentRow = [];
                break;
            case '\n':
                currentRow.Add(currentCell.ToString());
                currentCell.Clear();
                rows.Add(currentRow);
                currentRow = [];
                break;
            default:
                currentCell.Append(currentChar);
                break;
            }
        }

        if (inQuotes)
            throw new InvalidOperationException("Lookup-table CSV ended with an unterminated quoted field.");

        if (currentCell.Length > 0 || currentRow.Count > 0) {
            currentRow.Add(currentCell.ToString());
            rows.Add(currentRow);
        }

        return rows;
    }

    private static void WriteCsvRow(StringBuilder builder, IReadOnlyList<string> cells) {
        for (var i = 0; i < cells.Count; i++) {
            if (i > 0)
                _ = builder.Append(',');

            _ = builder.Append(Escape(cells[i] ?? string.Empty));
        }

        _ = builder.AppendLine();
    }

    private static string Escape(string value) {
        if (value.IndexOfAny([',', '"', '\r', '\n']) < 0)
            return value;

        return $"\"{value.Replace("\"", "\"\"")}\"";
    }
}
