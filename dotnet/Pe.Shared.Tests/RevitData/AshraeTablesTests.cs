using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;
using System.Runtime.CompilerServices;

namespace Pe.Shared.Tests.RevitData;

/// <summary>ducts.tables over three .tbl files copied verbatim from Revit's shipped ASHRAE folder.</summary>
[TestFixture]
public sealed class AshraeTablesTests {
    private static string Folder([CallerFilePath] string source = "") =>
        Path.Combine(Path.GetDirectoryName(source)!, "Fixtures", "Ashrae");

    private static IReadOnlyList<double> Values(AshraeGrid g) => g.Rows.Single().Values;
    private static IReadOnlyList<IReadOnlyList<double>> Rows(AshraeGrid g) => g.Rows.Select(r => r.Values).ToList();

    [Test]
    public void One_d_table_reads_diameters_from_the_inch_mm_row() {
        var data = AshraeTables.Read(Folder(), ["cd3-2", "XX9-9"]);

        var co = data.Tables["CD3-2"]["Co"];
        Assert.That(co.Title, Does.StartWith("CD3-2  Elbow, Die Stamped, 90 Degree, r/D = 1.0"));
        Assert.That(co.Axis!.Name, Is.EqualTo("D, in.(mm)"));
        Assert.That(co.Axis!.Values, Is.EqualTo(new double[] { 3, 4, 5, 6, 7, 8, 9, 10 }));
        Assert.That(co.RowAxes, Is.Empty);
        Assert.That(Values(co), Is.EqualTo(new[] { 0.44, 0.37, 0.3, 0.25, 0.24, 0.24, 0.24, 0.24 }));
        Assert.That(data.Missing, Is.EqualTo(new[] { "XX9-9" }));
    }

    [Test]
    public void Two_d_table_keeps_each_result_block_with_its_axes() {
        var sd59 = AshraeTables.Read(Folder(), ["SD5-9"]).Tables["SD5-9"];

        Assert.That(sd59.Keys, Is.EquivalentTo(new[] { "Cb", "Cs" }));
        var cb = sd59["Cb"];
        Assert.That(cb.Axis!.Name, Is.EqualTo("Qb/Qc"));
        Assert.That(cb.RowAxes.Single(), Is.EqualTo("Ab/Ac"));
        Assert.That(cb.Axis!.Values, Has.Count.EqualTo(11));
        Assert.That(cb.Rows.Select(r => r.Coordinates.Single()), Is.EqualTo(new[] { 0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0 }));
        Assert.That(Rows(cb), Has.Count.EqualTo(11).And.All.Count.EqualTo(11));
        Assert.That(Rows(cb)[0][4], Is.EqualTo(163), "Ab/Ac 0.01, Qb/Qc 0.4");
        Assert.That(Rows(cb)[3][3], Is.EqualTo(1.20), "Ab/Ac 0.3, Qb/Qc 0.3");
        Assert.That(sd59["Cs"].Axis!.Name, Is.EqualTo("Qs/Qc"));
        Assert.That(Rows(sd59["Cs"])[10][10], Is.EqualTo(0.13));
        var wire = Newtonsoft.Json.JsonConvert.SerializeObject(cb);
        Assert.That(wire, Does.Contain("\"Values\":[1.2,8.82,"), "2-D grid is number[][] on the wire");
    }

    [Test]
    public void Constant_table_is_one_value_with_no_axis() {
        var co = AshraeTables.Read(Folder(), ["CR3-10"]).Tables["CR3-10"]["Co"];

        Assert.That(co.Axis, Is.Null);
        Assert.That(Values(co).Single(), Is.EqualTo(0.12));
        Assert.That(Newtonsoft.Json.JsonConvert.SerializeObject(co), Does.Contain("\"Values\":[0.12]"), "1-D grid is number[] on the wire");
    }

    [Test]
    public void No_table_parses_to_no_results_and_a_missing_folder_throws() {
        Assert.That(AshraeTables.Parse("CD11-1  No table\r\n"), Is.Empty);
        Assert.Throws<DirectoryNotFoundException>(() => AshraeTables.Read(Path.Combine(Folder(), "nope"), ["CD3-2"]));
    }

    /// <summary>
    ///     Every table Revit ships parses into well-formed grids, says "No table", or is named Unsupported; never a
    ///     ragged grid. The tables the campaign looked up all parse.
    /// </summary>
    [Test]
    public void Every_installed_table_parses() {
        var folder = AshraeTables.DefaultFolder;
        if (!Directory.Exists(folder)) Assert.Ignore($"no Revit ASHRAE tables at {folder}");
        var ids = Directory.GetFiles(folder, "*.tbl").Select(Path.GetFileNameWithoutExtension).ToList();
        var data = AshraeTables.Read(folder, ids!);

        var bad = data.Tables
            .Where(t => !File.ReadAllText(Path.Combine(folder, t.Key + ".tbl")).Contains("No table"))
            .Where(t => t.Value.Count == 0 || t.Value.Values.Any(g => g.Rows.Count == 0))
            .Select(t => t.Key)
            .ToList();
        Assert.That(bad, Is.Empty);
        string[] used = ["CD3-2", "CD3-12", "CD3-21", "SD4-1", "SD4-2", "SR4-3", "SD5-9", "CD9-1"];
        Assert.That(used.Where(id => !data.Tables.ContainsKey(id) || data.Tables[id].Count == 0), Is.Empty,
            string.Join("; ", data.Unsupported.Select(kv => kv.Key + " " + kv.Value)));
        TestContext.WriteLine($"{data.Tables.Count} parsed, {data.Unsupported.Count} unsupported: {string.Join(", ", data.Unsupported.Keys)}");
    }
    [TestCase("ED5-1", 121)]
    [TestCase("ER5-1", 8)]
    [TestCase("SR5-1", 9)]
    public void Three_coordinate_tables_preserve_every_published_sample(string id, int rows) {
        var tables = AshraeTables.Read(Folder(), [id]);
        Assert.That(tables.Unsupported, Is.Empty);
        foreach (var (key, grid) in tables.Tables[id]) {
            Assert.That(grid.RowAxes, Is.EqualTo(new[] { "As/Ac", "Ab/Ac" }));
            Assert.That(grid.Rows.Count, Is.EqualTo(rows));
            foreach (var row in grid.Rows)
                for (var i = 0; i < grid.Axis!.Values.Count; i++) {
                    var at = new Dictionary<string, double> { [grid.Axis.Name] = grid.Axis.Values[i], ["As/Ac"] = row.Coordinates[0], ["Ab/Ac"] = row.Coordinates[1] };
                    Assert.That(AshraeLookup.Value(grid, at), Is.EqualTo(row.Values[i]), $"{id} {key} sample");
                }
        }
    }

    [Test]
    public void Sparse_corners_exact_axes_and_named_inputs_fail_closed() {
        var grid = AshraeTables.Read(Folder(), ["ER5-1"]).Tables["ER5-1"]["Cb"];
        static Dictionary<string, double> At(double a, double b, double q = .1) => new() { ["Qb/Qc"] = q, ["As/Ac"] = a, ["Ab/Ac"] = b };
        Assert.That(AshraeLookup.Value(grid, At(.5, .5, .01)), Is.EqualTo(-6313));
        Assert.That(AshraeLookup.Value(grid, At(.75, .5, .01)), Is.EqualTo(-2831));
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(grid, At(.5, .25)));
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(grid, At(.6, .3)));
        Assert.That(double.IsFinite(AshraeLookup.Value(grid, At(.75, .4))), Is.True);
        Assert.That(double.IsFinite(AshraeLookup.Value(grid, At(.875, .75, .15))), Is.True);
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(grid, At(.75, .5, 0)));
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(grid, new Dictionary<string,double> { ["Qb/Qc"] = .1, ["Ab/Ac"] = .5 }));
        Assert.Throws<FormatException>(() => AshraeLookup.Value(grid with { Rows = grid.Rows.Append(grid.Rows[0]).ToList() }, At(.5, .5)));
        Assert.Throws<FormatException>(() => AshraeLookup.Value(grid with { RowAxes = ["As/Ac", "As/Ac"] }, At(.5, .5)));
        Assert.Throws<FormatException>(() => AshraeTables.Parse("bad\n Cb\n Qb/Qc-> .1 .2\n As/Ac Ab/Ac\n .5 .5 1 2"));
    }

}
