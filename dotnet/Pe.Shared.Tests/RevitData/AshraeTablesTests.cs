using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;
using System.Runtime.CompilerServices;

namespace Pe.Shared.Tests.RevitData;

/// <summary>ducts.tables over three .tbl files copied verbatim from Revit's shipped ASHRAE folder.</summary>
[TestFixture]
public sealed class AshraeTablesTests {
    private static string Folder([CallerFilePath] string source = "") =>
        Path.Combine(Path.GetDirectoryName(source)!, "Fixtures", "Ashrae");

    private static IReadOnlyList<double> Values(AshraeGrid g) => (IReadOnlyList<double>)g.Grid;
    private static IReadOnlyList<IReadOnlyList<double>> Rows(AshraeGrid g) => (IReadOnlyList<IReadOnlyList<double>>)g.Grid;

    [Test]
    public void One_d_table_reads_diameters_from_the_inch_mm_row() {
        var data = AshraeTables.Read(Folder(), ["cd3-2", "XX9-9"]);

        var co = data.Tables["CD3-2"]["Co"];
        Assert.That(co.Title, Does.StartWith("CD3-2  Elbow, Die Stamped, 90 Degree, r/D = 1.0"));
        Assert.That(co.XLabel, Is.EqualTo("D, in.(mm)"));
        Assert.That(co.X, Is.EqualTo(new double[] { 3, 4, 5, 6, 7, 8, 9, 10 }));
        Assert.That(co.Y, Is.Null);
        Assert.That(Values(co), Is.EqualTo(new[] { 0.44, 0.37, 0.3, 0.25, 0.24, 0.24, 0.24, 0.24 }));
        Assert.That(data.Missing, Is.EqualTo(new[] { "XX9-9" }));
    }

    [Test]
    public void Two_d_table_keeps_each_result_block_with_its_axes() {
        var sd59 = AshraeTables.Read(Folder(), ["SD5-9"]).Tables["SD5-9"];

        Assert.That(sd59.Keys, Is.EquivalentTo(new[] { "Cb", "Cs" }));
        var cb = sd59["Cb"];
        Assert.That(cb.XLabel, Is.EqualTo("Qb/Qc"));
        Assert.That(cb.YLabel, Is.EqualTo("Ab/Ac"));
        Assert.That(cb.X, Has.Count.EqualTo(11));
        Assert.That(cb.Y, Is.EqualTo(new[] { 0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0 }));
        Assert.That(Rows(cb), Has.Count.EqualTo(11).And.All.Count.EqualTo(11));
        Assert.That(Rows(cb)[0][4], Is.EqualTo(163), "Ab/Ac 0.01, Qb/Qc 0.4");
        Assert.That(Rows(cb)[3][3], Is.EqualTo(1.20), "Ab/Ac 0.3, Qb/Qc 0.3");
        Assert.That(sd59["Cs"].XLabel, Is.EqualTo("Qs/Qc"));
        Assert.That(Rows(sd59["Cs"])[10][10], Is.EqualTo(0.13));
        var wire = Newtonsoft.Json.JsonConvert.SerializeObject(cb);
        Assert.That(wire, Does.Contain("\"Grid\":[[1.2,8.82,"), "2-D grid is number[][] on the wire");
    }

    private static IReadOnlyList<IReadOnlyList<IReadOnlyList<double>?>> Slices(AshraeGrid g) =>
        (IReadOnlyList<IReadOnlyList<IReadOnlyList<double>?>>)g.Grid;

    [Test]
    public void Three_axis_table_reads_one_slice_per_outer_value_and_null_where_a_slice_prints_no_row() {
        var er51 = AshraeTables.Read(Folder(), ["ER5-1"]).Tables["ER5-1"];

        Assert.That(er51.Keys, Is.EquivalentTo(new[] { "Cb", "Cs" }));
        var cb = er51["Cb"];
        Assert.That(cb.Title, Does.StartWith("ER5-1  Smooth Radius Wye of the Type As + Ab > or = Ac"));
        Assert.That((cb.XLabel, cb.YLabel, cb.ZLabel), Is.EqualTo(("Qb/Qc", "Ab/Ac", "As/Ac")));
        Assert.That(cb.Z, Is.EqualTo(new[] { 0.5, 0.75, 1.0 }));
        Assert.That(cb.Y, Is.EqualTo(new[] { 0.25, 0.5, 1.0 }));
        Assert.That(Slices(cb)[0][0], Is.Null, "As/Ac 0.5 prints no Ab/Ac 0.25 row");
        Assert.That(Slices(cb)[0][1]![0], Is.EqualTo(-6313), "As/Ac 0.5, Ab/Ac 0.5, Qb/Qc 0.01");
        Assert.That(Slices(cb)[2][0], Is.EqualTo(new[] { -444, -3.13, 0, 0.35, 0.47, 0.55, 0.64, 0.74, 0.82, 0.88, 0.95 }));
        Assert.That(Slices(er51["Cs"])[2][2]![10], Is.EqualTo(0.12), "Cs As/Ac 1, Ab/Ac 1, Qs/Qc 1");
        var wire = Newtonsoft.Json.JsonConvert.SerializeObject(cb);
        Assert.That(wire, Does.Contain("\"Grid\":[[null,[-6313.0,"), "3-axis grid is (number[] | null)[][] on the wire");
        Assert.That(wire, Does.Contain("\"ZLabel\":\"As/Ac\""));
    }

    [Test]
    public void Ed5_3_reads_both_diameter_blocks_through_run_together_columns_and_its_two_typing_slips() {
        var ed53 = AshraeTables.Read(Folder(), ["ED5-3"]).Tables["ED5-3"];

        Assert.That(ed53.Keys, Is.EquivalentTo(new[] { "Cb", "Cs", "Cb#2", "Cs#2" }));
        Assert.That(ed53["Cb"].Title, Does.Contain("Dc < or = 10 inches"));
        Assert.That(ed53["Cb#2"].Title, Does.Contain("Dc > 10 inches"));
        foreach (var g in ed53.Values) {
            Assert.That(g.Z, Has.Count.EqualTo(11), g.Title);
            Assert.That(Slices(g), Has.All.Count.EqualTo(11));
        }
        // "-1242777-10249.51": two fixed-width columns with no space between them.
        Assert.That(Slices(ed53["Cb"])[0][8]!.Take(2), Is.EqualTo(new[] { -1242777, -10249.51 }));
        // "O.O1" (letter O) for Ab/Ac 0.01 at As/Ac 0.4, Dc > 10 in.
        Assert.That(Slices(ed53["Cb#2"])[4][0]![0], Is.EqualTo(-2.81));
        // "- 3873" at As/Ac 0.8, Ab/Ac 1.0, Qs/Qc 0.01, Dc <= 10 in.
        Assert.That(Slices(ed53["Cs"])[8][10]![0], Is.EqualTo(-3873));
        // Dc > 10 in Cs prints no Ab/Ac 0.8 row at As/Ac 0.01.
        Assert.That(Slices(ed53["Cs#2"])[0][8], Is.Null);
    }

    [Test]
    public void Bullhead_tables_read_two_d_rectangular_and_triangular_three_d_round_and_a_spilled_row_refuses() {
        var data = AshraeTables.Read(Folder(), ["ER5-5", "ED5-4", "ED5-5"]);

        var er55 = data.Tables["ER5-5"]["Cb1"];
        Assert.That((er55.XLabel, er55.YLabel, er55.Z), Is.EqualTo(("Qb1/Qc", "Ab1/Ac", (IReadOnlyList<double>?)null)));
        Assert.That(Rows(er55)[3][10], Is.EqualTo(2.0), "Ab1/Ac 1, Qb1/Qc 1");
        var ed54 = data.Tables["ED5-4"]["Cb1"];
        Assert.That(ed54.ZLabel, Is.EqualTo("Ab1/Ac"));
        // Db1 >= Db2: slice k states Ab2/Ac up to its own Ab1/Ac, nothing above.
        Assert.That(Slices(ed54).Select(s => s.Count(r => r is not null)), Is.EqualTo(Enumerable.Range(1, 11)));
        Assert.That(Slices(ed54)[1][1], Is.EqualTo(new[] { 1550, 13.0, 2.5, 0.94, 0.53, 0.4, 0.36, 0.35, 0.34, 0.33, 0.32 }));
        Assert.That(data.Unsupported["ED5-5"], Is.EqualTo("Cb1: Ab1/Ac 0.1, Ab2/Ac 0.1 has 12 values for 11 columns"));
    }

    [Test]
    public void The_loss_server_refuses_a_three_axis_grid_rather_than_misreading_it() {
        var cb = AshraeTables.Read(Folder(), ["ER5-1"]).Tables["ER5-1"]["Cb"];
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(cb, 0.5, 0.5));
    }

    [Test]
    public void Constant_table_is_one_value_with_no_axis() {
        var co = AshraeTables.Read(Folder(), ["CR3-10"]).Tables["CR3-10"]["Co"];

        Assert.That(co.X, Is.Empty);
        Assert.That(Values(co).Single(), Is.EqualTo(0.12));
        Assert.That(Newtonsoft.Json.JsonConvert.SerializeObject(co), Does.Contain("\"Grid\":[0.12]"), "1-D grid is number[] on the wire");
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
            .Where(t => t.Value.Count == 0 || t.Value.Values.Any(g => g.Z is { } z
                ? g.Y is not { } ys || Slices(g).Count != z.Count || Slices(g).Any(s => s.Count != ys.Count
                    || s.All(r => r is null) || s.Any(r => r is not null && r.Count != g.X.Count))
                : g.Y is { } y
                ? Rows(g).Count != y.Count || Rows(g).Any(r => r.Count != g.X.Count)
                : Values(g).Count == 0 || (g.X.Count > 0 && Values(g).Count != g.X.Count)))
            .Select(t => t.Key)
            .ToList();
        Assert.That(bad, Is.Empty);
        string[] used = ["CD3-2", "CD3-12", "CD3-21", "SD4-1", "SD4-2", "SR4-3", "SD5-9", "CD9-1", "ER5-1", "ER5-2", "ER5-5", "ED5-3", "ED5-4"];
        Assert.That(used.Where(id => !data.Tables.ContainsKey(id) || data.Tables[id].Count == 0), Is.Empty,
            string.Join("; ", data.Unsupported.Select(kv => kv.Key + " " + kv.Value)));
        TestContext.WriteLine($"{data.Tables.Count} parsed, {data.Unsupported.Count} unsupported: {string.Join(", ", data.Unsupported.Keys)}");
    }
}
