using System.Globalization;
using System.Text.RegularExpressions;

namespace Pe.Shared.RevitData.Ducts;

// The `ducts.tables` contract: ASHRAE Duct Fitting Database grids read verbatim from the .tbl text files Revit
// ships. The web looks C up from these; Revit's own ASHRAE route computes zero on this machine (pressure-drop ledger).

/// <summary>The table ids to read, as ASHRAE names them ("CD3-2", "SD5-9"); case does not matter.</summary>
public sealed record DuctTablesRequest(IReadOnlyList<string> Ids);

/// <summary>
///     Tables keyed by upper-case id, then by result key (Co, Cb, Cs; a block printed twice gets "#2").
///     A table Revit ships as "No table" has no results. Missing names ids with no file in Folder. Unsupported maps
///     an id to why it was not parsed: three-axis tables (a second Y such as Re or As/Ac) and fixed-width rows whose
///     numbers run together; a wrong grid is worse than none.
/// </summary>
public sealed record DuctTablesData(
    string Folder,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, AshraeGrid>> Tables,
    IReadOnlyList<string> Missing,
    IReadOnlyDictionary<string, string> Unsupported);

/// <summary>
///     One coefficient grid; the wire shape the web's loss-grid.ts reads. With Y present, Grid is number[][]: one row
///     per Y, one column per X. With Y absent, Grid is number[] over X; a constant ("Co= 0.12") is one value with X
///     empty. Grid is typed object because the wire is a union; Rows and Values build it.
/// </summary>
public sealed record AshraeGrid(
    string Title,
    string XLabel,
    IReadOnlyList<double> X,
    string? YLabel,
    IReadOnlyList<double>? Y,
    object Grid) {
    public static AshraeGrid Rows(string title, string xLabel, IReadOnlyList<double> x, string? yLabel, IReadOnlyList<double> y,
        IReadOnlyList<IReadOnlyList<double>> rows) => new(title, xLabel, x, yLabel, y, rows);

    public static AshraeGrid Values(string title, string xLabel, IReadOnlyList<double> x, IReadOnlyList<double> values) =>
        new(title, xLabel, x, null, null, values);
}

/// <summary>Reads and parses Revit's shipped ASHRAE .tbl files. Revit-free.</summary>
public static class AshraeTables {
    /// <summary>Where Revit 2025 and 2026 install the tables (x86 Common Files, shared across years).</summary>
    public static string DefaultFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFilesX86),
        "Autodesk Shared", "Revit Shared", "Ashrae");

    private static readonly Regex Number = new(@"^-?\d+(?:\.\d*)?(?:\(\d+\))?$", RegexOptions.Compiled);
    private static readonly Regex ResultRow = new(@"^\s*(C[a-z]\d?)\s*=?\s+(-?\d.*)$", RegexOptions.Compiled);
    private static readonly Regex ResultKeyTail = new(@"(?:^|\s)(C[a-z]\d?)\s*$", RegexOptions.Compiled);

    public static DuctTablesData Read(string folder, IReadOnlyList<string> ids) {
        if (!Directory.Exists(folder))
            throw new DirectoryNotFoundException($"ASHRAE table folder not found: {folder}");
        var files = Directory.GetFiles(folder, "*.tbl")
            .ToDictionary(f => Path.GetFileNameWithoutExtension(f).ToUpperInvariant(), f => f);
        var tables = new Dictionary<string, IReadOnlyDictionary<string, AshraeGrid>>(StringComparer.Ordinal);
        var missing = new List<string>();
        var unsupported = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in ids.Select(i => i.Trim().ToUpperInvariant()).Distinct()) {
            if (!files.TryGetValue(id, out var path)) {
                missing.Add(id);
                continue;
            }
            try {
                tables[id] = Parse(File.ReadAllText(path, Latin1));
            } catch (FormatException ex) {
                unsupported[id] = ex.Message;
            }
        }
        return new DuctTablesData(folder, tables, missing, unsupported);
    }

    private static readonly System.Text.Encoding Latin1 = System.Text.Encoding.GetEncoding(28591);

    /// <summary>Parses one .tbl file's text into its result grids; FormatException names a shape it will not guess at.</summary>
    public static IReadOnlyDictionary<string, AshraeGrid> Parse(string text) {
        var results = new Dictionary<string, AshraeGrid>(StringComparer.Ordinal);
        var blocks = Regex.Split(text.Replace("\r\n", "\n"), @"\n\s*=+\s*(?:\n|$)");
        foreach (var block in blocks) {
            var lines = block.Split('\n')
                .Where(l => l.Trim().Length > 0 && l.Trim().Trim('#', ' ').Length > 0)
                .ToList();
            if (lines.Count == 0 || lines[0].TrimStart().StartsWith("'", StringComparison.Ordinal)) continue;
            var title = lines[0].Trim();
            if (title.EndsWith("No table", StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var (key, grid) in lines.Any(l => l.Contains("->")) ? TwoD(title, lines) : OneD(title, lines))
                Add(results, key, grid);
        }
        return results;
    }

    private static IEnumerable<(string, AshraeGrid)> TwoD(string title, List<string> lines) {
        var key = "Co";
        for (var i = 1; i < lines.Count; i++) {
            if (!lines[i].Contains("->")) {
                if (ResultKeyTail.Match(lines[i]) is { Success: true } m && !Numbers(lines[i]).Any()) key = m.Groups[1].Value;
                continue;
            }
            var parts = lines[i].Split(["->"], StringSplitOptions.None);
            var x = Numbers(parts[1]).ToList();
            var j = i + 1;
            // A one-row result under an arrow header ("Qs/Qc-> ..." then "Cs 0.0 33200. ..."): 1-D over X.
            if (j < lines.Count && ResultRow.Match(lines[j]) is { Success: true } one) {
                var values = Numbers(one.Groups[2].Value).ToList();
                if (values.Count != x.Count) throw new FormatException($"{one.Groups[1].Value}: {values.Count} values for {x.Count} columns");
                yield return (one.Groups[1].Value, AshraeGrid.Values(title, parts[0].Trim(), x, values));
                i = j;
                continue;
            }
            string? yLabel = null;
            if (j < lines.Count && !StartsNumeric(lines[j])) yLabel = lines[j++].Trim();
            var ys = new List<double>();
            var grid = new List<IReadOnlyList<double>>();
            for (; j < lines.Count && StartsNumeric(lines[j]); j++) {
                var row = Numbers(lines[j]).ToList();
                if (row.Count != x.Count + 1)
                    throw new FormatException($"{key}: row {ys.Count + 1} has {row.Count - 1} values for {x.Count} columns (a second Y axis or run-together numbers)");
                ys.Add(row[0]);
                grid.Add(row.Skip(1).ToList());
            }
            yield return (key, AshraeGrid.Rows(title, parts[0].Trim(), x, yLabel, ys, grid));
            i = j - 1;
        }
    }

    private static IEnumerable<(string, AshraeGrid)> OneD(string title, List<string> lines) {
        string? label = null;
        List<double>? x = null;
        for (var i = 1; i < lines.Count; i++) {
            var line = lines[i];
            if (ResultRow.Match(line) is { Success: true } r) {
                var values = Numbers(r.Groups[2].Value).ToList();
                if (values.Count == 0) continue;
                if (line.Contains("=") && values.Count == 1)
                    yield return (r.Groups[1].Value, AshraeGrid.Values(title, "", [], values));
                else if (x is not null && values.Count > x.Count)
                    throw new FormatException($"{r.Groups[1].Value}: {values.Count} values for {x.Count} columns");
                else if (x is not null)
                    yield return (r.Groups[1].Value,
                        AshraeGrid.Values(title, label!, x.Skip(Math.Max(0, x.Count - values.Count)).ToList(), values));
                continue;
            }
            var tokens = line.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
            var first = Array.FindIndex(tokens, t => Number.IsMatch(t));
            if (first > 0 && tokens.Skip(first).All(t => Number.IsMatch(t))) {
                label = string.Join(" ", tokens.Take(first)).TrimEnd(',');
                x = tokens.Skip(first).Select(Value).ToList();
            }
        }
    }

    private static void Add(Dictionary<string, AshraeGrid> results, string key, AshraeGrid grid) {
        var k = key;
        for (var n = 2; results.ContainsKey(k); n++) k = $"{key}#{n}";
        results[k] = grid;
    }

    private static bool StartsNumeric(string line) =>
        line.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries) is { Length: > 1 } t && t.All(x => Number.IsMatch(x));

    private static IEnumerable<double> Numbers(string text) =>
        text.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries).Where(t => Number.IsMatch(t)).Select(Value);

    private static double Value(string token) =>
        double.Parse(token.Split('(')[0].TrimEnd('.'), NumberStyles.Float, CultureInfo.InvariantCulture);
}
