using System.Text;

namespace Pe.Shared.RevitData.Families;

/// <summary>The Revit size-table CSV as text: one reader, and the one sameness rule the reconciler diffs by.</summary>
public static class FamilyLookupTableCsv {
    /// <summary>
    ///     Same table: identical header row and row names in order, text cells equal as written, numeric cells equal as numbers.
    ///     Revit's export rewrites rows as CRLF and numbers six-decimal (`1` → `1.000000`), so literal text never converges.
    /// </summary>
    public static bool Same(string authored, string captured) {
        var a = Rows(authored);
        var b = Rows(captured);
        if (a.Count == 0 || b.Count == 0 || !a[0].SequenceEqual(b[0], StringComparer.Ordinal) || a.Count != b.Count) return false;
        return a.Skip(1).Zip(b.Skip(1), (x, y) => SameRow(a[0], x, y)).All(same => same);
    }

    public static List<List<string>> Rows(string csv) {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < csv.Length; i++) {
            var c = csv[i];
            if (quoted) {
                if (c != '"') cell.Append(c);
                else if (i + 1 < csv.Length && csv[i + 1] == '"') { cell.Append('"'); i++; }
                else quoted = false;
                continue;
            }
            switch (c) {
            case '"': quoted = true; break;
            case ',': row.Add(cell.ToString()); cell.Clear(); break;
            case '\r' or '\n':
                if (c == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n') i++;
                row.Add(cell.ToString()); cell.Clear(); rows.Add(row); row = [];
                break;
            default: cell.Append(c); break;
            }
        }
        if (quoted) throw new InvalidOperationException("Lookup-table CSV ended with an unterminated quoted field.");
        if (cell.Length > 0 || row.Count > 0) { row.Add(cell.ToString()); rows.Add(row); }
        return rows;
    }

    // Column i + 1 is `Name##type##unit`; `other` is Revit's text type, every other type holds numbers. Row order is kept: the
    // capture preserves authored order, and a reordered table is not claimed equal without proof that Revit ignores order.
    private static bool SameRow(IReadOnlyList<string> header, IReadOnlyList<string> a, IReadOnlyList<string> b) {
        if (a.Count != b.Count || a.Count == 0 || !string.Equals(a[0], b[0], StringComparison.Ordinal)) return false;
        for (var i = 1; i < a.Count; i++) {
            var text = i >= header.Count || string.Equals(header[i].Split(["##"], StringSplitOptions.None).ElementAtOrDefault(1)?.Trim(), "other", StringComparison.OrdinalIgnoreCase);
            if (!text && Number(a[i]) is { } x && Number(b[i]) is { } y ? x != y : !string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
        }
        return true;
    }

    private static double? Number(string cell) =>
        double.TryParse(cell, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : null;
}
