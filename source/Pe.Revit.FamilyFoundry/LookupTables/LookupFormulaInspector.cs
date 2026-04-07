using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using System.Text;

namespace Pe.Revit.FamilyFoundry.LookupTables;

internal static class LookupFormulaInspector {
    public static Dictionary<string, int> CollectLookupKeyCounts(IEnumerable<ParameterSnapshot>? parameterSnapshots) {
        var keyCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (parameterSnapshots == null)
            return keyCounts;

        var parameterSnapshotList = parameterSnapshots.ToList();
        var uniformParameterValues = parameterSnapshotList
            .Where(snapshot => !string.IsNullOrWhiteSpace(snapshot.Name))
            .Select(snapshot => new {
                ParameterName = snapshot.Name.Trim(),
                Value = snapshot.Formula == null ? snapshot.TryGetUniformValueOrFormula() : null
            })
            .Where(item => !string.IsNullOrWhiteSpace(item.Value))
            .ToDictionary(item => item.ParameterName, item => item.Value!, StringComparer.OrdinalIgnoreCase);

        foreach (var parameterSnapshot in parameterSnapshotList) {
            if (!TryParseSizeLookup(parameterSnapshot.Formula, uniformParameterValues, out var lookupReference))
                continue;

            if (!keyCounts.TryGetValue(lookupReference.TableName, out var existingCount)
                || lookupReference.LookupKeyCount > existingCount) {
                keyCounts[lookupReference.TableName] = lookupReference.LookupKeyCount;
            }
        }

        return keyCounts;
    }

    public static bool TryParseSizeLookup(string? formula, out LookupFormulaReference lookupReference) {
        return TryParseSizeLookup(formula, null, out lookupReference);
    }

    public static bool TryParseSizeLookup(
        string? formula,
        IReadOnlyDictionary<string, string>? parameterValues,
        out LookupFormulaReference lookupReference
    ) {
        lookupReference = default;
        if (string.IsNullOrWhiteSpace(formula))
            return false;

        const string marker = "size_lookup";
        var markerIndex = formula.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
            return false;

        var openParenIndex = formula.IndexOf('(', markerIndex);
        if (openParenIndex < 0 || !TryFindMatchingParen(formula, openParenIndex, out var closeParenIndex))
            return false;

        var arguments = SplitArguments(formula.Substring(openParenIndex + 1, closeParenIndex - openParenIndex - 1));
        if (arguments.Count < 4)
            return false;

        var tableName = ResolveTableName(arguments[0], parameterValues);
        var returnColumn = Unquote(arguments[1]);
        if (string.IsNullOrWhiteSpace(tableName) || string.IsNullOrWhiteSpace(returnColumn))
            return false;

        lookupReference = new LookupFormulaReference(tableName, returnColumn, arguments.Count - 3);
        return true;
    }

    private static bool TryFindMatchingParen(string formula, int openParenIndex, out int closeParenIndex) {
        var depth = 0;
        var inString = false;

        for (var i = openParenIndex; i < formula.Length; i++) {
            var currentChar = formula[i];
            if (currentChar == '"')
                inString = !inString;

            if (inString)
                continue;

            if (currentChar == '(') {
                depth++;
                continue;
            }

            if (currentChar != ')')
                continue;

            depth--;
            if (depth == 0) {
                closeParenIndex = i;
                return true;
            }
        }

        closeParenIndex = -1;
        return false;
    }

    private static List<string> SplitArguments(string argumentsText) {
        var arguments = new List<string>();
        var current = new StringBuilder();
        var depth = 0;
        var inString = false;

        foreach (var currentChar in argumentsText) {
            if (currentChar == '"')
                inString = !inString;

            if (!inString) {
                if (currentChar == '(') {
                    depth++;
                } else if (currentChar == ')') {
                    depth--;
                } else if (currentChar == ',' && depth == 0) {
                    arguments.Add(current.ToString().Trim());
                    current.Clear();
                    continue;
                }
            }

            current.Append(currentChar);
        }

        arguments.Add(current.ToString().Trim());
        return arguments;
    }

    private static string Unquote(string value) {
        var trimmed = value.Trim();
        return trimmed.Length >= 2 && trimmed[0] == '"' && trimmed[^1] == '"'
            ? trimmed[1..^1]
            : trimmed;
    }

    private static string ResolveTableName(string tableNameArgument, IReadOnlyDictionary<string, string>? parameterValues) {
        var literalValue = Unquote(tableNameArgument);
        if (tableNameArgument.TrimStart().StartsWith("\"", StringComparison.Ordinal))
            return literalValue;

        if (parameterValues != null && parameterValues.TryGetValue(literalValue, out var resolvedValue))
            return resolvedValue.Trim();

        return literalValue;
    }
}

internal readonly record struct LookupFormulaReference(
    string TableName,
    string ReturnColumn,
    int LookupKeyCount
);
