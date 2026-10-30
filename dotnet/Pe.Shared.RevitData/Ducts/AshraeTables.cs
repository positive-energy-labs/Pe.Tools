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
///     an id to why it was not parsed: a row whose value count does not match its axes (a triangular two-axis table,
///     a value Revit's file prints past its row); a wrong grid is worse than none.
/// </summary>
public sealed record DuctTablesData(
    string Folder,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, AshraeGrid>> Tables,
    IReadOnlyList<string> Missing,
    IReadOnlyDictionary<string, string> Unsupported);

/// <summary>
///     One coefficient grid; the wire shape the web's loss-grid.ts reads. With Z present (a three-axis table such as
///     ER5-1's As/Ac by Ab/Ac by Qb/Qc), Grid is (number[] | null)[][]: one slice per Z, in it one row per Y, one column
///     per X. Y is every inner value any slice prints, and a row is null where its slice prints none (ER5-1 has no
///     Ab/Ac 0.25 row at As/Ac 0.5; ED5-4 states Ab2/Ac only up to Ab1/Ac). Z is the table's first (outer) column, Y
///     its second. With Y present and Z absent, Grid is number[][]: one row per Y, one column per X. With Y absent, Grid
///     is number[] over X; a constant ("Co= 0.12") is one value with X empty. Grid is typed object because the wire is
///     a union; Slices, Rows and Values build it.
/// </summary>
public sealed record AshraeGrid(
    string Title,
    string XLabel,
    IReadOnlyList<double> X,
    string? YLabel,
    IReadOnlyList<double>? Y,
    object Grid,
    string? ZLabel = null,
    IReadOnlyList<double>? Z = null) {
    public static AshraeGrid Slices(string title, string xLabel, IReadOnlyList<double> x, string yLabel, IReadOnlyList<double> y,
        string zLabel, IReadOnlyList<double> z, IReadOnlyList<IReadOnlyList<IReadOnlyList<double>?>> slices) =>
        new(title, xLabel, x, yLabel, y, slices, zLabel, z);

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
    private static readonly Regex TitleLine = new(@"^\s*[A-Z]{2}\d+-\d+\s", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex FlowLabel = new(@"^Q([a-z]\d?)/Qc$", RegexOptions.Compiled);
    // Fixed-width columns run together when a value fills its field ("-1240736-10230.46", "0.80-1244608" in ED5-1/2/3).
    private static readonly Regex RunTogether = new(@"(?<=[\d.])(?=-\d)", RegexOptions.Compiled);
    // Two typing slips in Revit's ED5-3.tbl, repaired because each reads one way only: "O.O1" (letter O) for 0.01 and
    // "- 3873" for -3873. Anything else that is not a number still refuses its row.
    private static readonly Regex LetterO = new(@"^-?[0-9O]*\.[0-9O]+$", RegexOptions.Compiled);

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
            // A comment line (') is the file's revision or a branch note, never data: drop the line, keep the block
            // (ER5-10's Cs block opens with "'  For the other branch, ..."). The title is the line naming the table id;
            // a note printed above it (ER5-9's Cs block) is not the title.
            var lines = block.Split('\n')
                .Where(l => l.Trim().Length > 0 && l.Trim().Trim('#', ' ').Length > 0)
                .Where(l => !l.TrimStart().StartsWith("'", StringComparison.Ordinal))
                .ToList();
            var at = lines.FindIndex(l => TitleLine.IsMatch(l));
            if (at > 0) lines = lines.Skip(at).ToList();
            if (lines.Count == 0) continue;
            var title = lines[0].Trim();
            if (title.EndsWith("No table", StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var (key, grid) in lines.Any(l => l.Contains("->")) ? TwoD(title, lines) : OneD(title, lines))
                Add(results, key, grid);
        }
        return results;
    }

    private static IEnumerable<(string, AshraeGrid)> TwoD(string title, List<string> lines) {
        string? named = null;
        for (var i = 1; i < lines.Count; i++) {
            if (!lines[i].Contains("->")) {
                if (ResultKeyTail.Match(lines[i]) is { Success: true } m && !Numbers(lines[i]).Any()) named = m.Groups[1].Value;
                continue;
            }
            var parts = lines[i].Split(["->"], StringSplitOptions.None);
            var x = Numbers(parts[1]).ToList();
            var xLabel = parts[0].Trim();
            // A block with no result line names its result by its flow axis (ER5-9's second block: Qs/Qc is Cs).
            var key = named ?? (FlowLabel.Match(xLabel) is { Success: true } f ? "C" + f.Groups[1].Value : "Co");
            var j = i + 1;
            // A one-row result under an arrow header ("Qs/Qc-> ..." then "Cs 0.0 33200. ..."): 1-D over X.
            if (j < lines.Count && ResultRow.Match(lines[j]) is { Success: true } one) {
                var values = Numbers(one.Groups[2].Value).ToList();
                if (values.Count != x.Count) throw new FormatException($"{one.Groups[1].Value}: {values.Count} values for {x.Count} columns");
                yield return (one.Groups[1].Value, AshraeGrid.Values(title, xLabel, x, values));
                i = j;
                continue;
            }
            string? yLabel = null;
            if (j < lines.Count && !StartsNumeric(lines[j])) yLabel = lines[j++].Trim();
            // Two labels over the rows ("As/Ac    Ab/Ac") and a first row with both: a three-axis table.
            var labels = yLabel?.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries) ?? [];
            if (labels.Length == 2 && j < lines.Count && Numbers(lines[j]).Count() == x.Count + 2) {
                var (slices, next) = ThreeD(title, xLabel, x, labels[0], labels[1], lines, j, key);
                yield return (key, slices);
                i = next - 1;
                continue;
            }
            var ys = new List<double>();
            var grid = new List<IReadOnlyList<double>>();
            for (; j < lines.Count && StartsNumeric(lines[j]); j++) {
                var row = Numbers(lines[j]).ToList();
                if (row.Count != x.Count + 1)
                    throw new FormatException($"{key}: row {ys.Count + 1} has {row.Count - 1} values for {x.Count} columns (a second Y axis or run-together numbers)");
                ys.Add(row[0]);
                grid.Add(row.Skip(1).ToList());
            }
            yield return (key, AshraeGrid.Rows(title, xLabel, x, yLabel, ys, grid));
            i = j - 1;
        }
    }

    /// <summary>
    ///     A three-axis block from its first data row at <paramref name="start" />: the columns are right-aligned, so a
    ///     row whose first number ends in the outer column ("0.50  0.50  -6313. ...") starts a Z slice and one ending in
    ///     the inner column ("0.1  -19386 ...") is the next Y in that slice, and a row with no values (ED5-4's "0.1"
    ///     alone) is a combination the table does not state. A row whose value count does not match X refuses the table
    ///     (ED5-5 prints the next row's Y at the end of a row). Returns the grid and the index of the line after it.
    /// </summary>
    private static (AshraeGrid, int) ThreeD(string title, string xLabel, IReadOnlyList<double> x, string zLabel, string yLabel,
        List<string> lines, int start, string key) {
        var first = lines[start].TrimEnd();
        var zEnd = EndOfToken(first, 0);
        var split = (zEnd + EndOfToken(first, zEnd)) / 2;
        var rows = new List<(double Z, double Y, IReadOnlyList<double>? Values)>();
        double? z = null;
        var j = start;
        for (; j < lines.Count; j++) {
            // The block ends at the next result's header; any other line that is not a clean row refuses the table
            // rather than dropping the slices after it.
            if (lines[j].Contains("->") || ResultKeyTail.IsMatch(lines[j]) && !Numbers(lines[j]).Any()) break;
            var tokens = Tokens(lines[j]).ToList();
            if (tokens.FirstOrDefault(t => !Number.IsMatch(t)) is { } bad)
                throw new FormatException($"{key}: row {rows.Count + 1} after {zLabel} {z} holds \"{bad}\", not a number");
            var values = tokens.Select(Value).ToList();
            if (EndOfToken(lines[j], 0) <= split) {
                z = values[0];
                values.RemoveAt(0);
            }
            if (z is null || values.Count == 0) throw new FormatException($"{key}: row {rows.Count + 1} names no {yLabel}");
            var y = values[0];
            if (values.Count == 1) {
                rows.Add((z.Value, y, null));
                continue;
            }
            if (values.Count - 1 != x.Count)
                throw new FormatException($"{key}: {zLabel} {z}, {yLabel} {y} has {values.Count - 1} values for {x.Count} columns");
            rows.Add((z.Value, y, values.Skip(1).ToList()));
        }
        var zs = rows.Select(r => r.Z).Distinct().ToList();
        var ys = rows.Select(r => r.Y).Distinct().OrderBy(v => v).ToList();
        if (!Ascending(zs)) throw new FormatException($"{key}: {zLabel} does not ascend");
        var slices = new List<IReadOnlyList<IReadOnlyList<double>?>>();
        foreach (var zv in zs) {
            var slice = rows.Where(r => r.Z == zv).ToList();
            if (!Ascending(slice.Select(r => r.Y).ToList()))
                throw new FormatException($"{key}: {yLabel} does not ascend at {zLabel} {zv}");
            if (slice.All(r => r.Values is null)) throw new FormatException($"{key}: {zLabel} {zv} states no row");
            slices.Add(ys.Select(yv => slice.FirstOrDefault(r => r.Y == yv).Values).ToList());
        }
        return (AshraeGrid.Slices(title, xLabel, x, yLabel, ys, zLabel, zs, slices), j);
    }

    private static bool Ascending(IReadOnlyList<double> values) => values.Zip(values.Skip(1), (a, b) => a < b).All(up => up);

    /// <summary>The column just past the first whitespace-delimited token at or after <paramref name="from" />.</summary>
    private static int EndOfToken(string line, int from) {
        var i = from;
        while (i < line.Length && char.IsWhiteSpace(line[i])) i++;
        while (i < line.Length && !char.IsWhiteSpace(line[i])) i++;
        return i;
    }

    private static IEnumerable<string> Tokens(string text) {
        var tokens = text.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries)
            .SelectMany(t => RunTogether.Split(t))
            .Select(t => t.Contains('O') && LetterO.IsMatch(t) ? t.Replace('O', '0') : t)
            .ToList();
        for (var i = 0; i < tokens.Count; i++) {
            if (tokens[i] == "-" && i + 1 < tokens.Count && Number.IsMatch(tokens[i + 1])) {
                yield return "-" + tokens[++i];
                continue;
            }
            yield return tokens[i];
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

    private static IEnumerable<double> Numbers(string text) => Tokens(text).Where(t => Number.IsMatch(t)).Select(Value);

    private static double Value(string token) =>
        double.Parse(token.Split('(')[0].TrimEnd('.'), NumberStyles.Float, CultureInfo.InvariantCulture);
}
