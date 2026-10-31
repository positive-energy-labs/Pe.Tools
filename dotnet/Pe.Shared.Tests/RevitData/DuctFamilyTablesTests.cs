using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;
using System.Runtime.CompilerServices;

namespace Pe.Shared.Tests.RevitData;

/// <summary>
///     ducts.family-patch over the four shipped CD3 grids: the dense PeElbowC recipe the 2026-10-08 lookup spike
///     stamped (3132 rows, PROVEN charged to the digit on Project A), and the no-flow-leg lint for junctions.
/// </summary>
[TestFixture]
public sealed class DuctFamilyTablesTests {
    private static string Folder([CallerFilePath] string source = "") =>
        Path.Combine(Path.GetDirectoryName(source)!, "Fixtures", "Ashrae");

    private static DuctTablesData Tables() => AshraeTables.Read(Folder(), DuctFamilyTables.ElbowSources);

    [Test]
    public void Elbow_table_is_the_spike_csv_row_for_row() {
        var (csv, rows) = DuctFamilyTables.ElbowCsv(Tables());
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries);

        Assert.That(rows, Is.EqualTo(3 * 18 * 58), "r/D {1, 1.5, 2} x 18 angles x 58 diameters");
        Assert.That(lines[0], Is.EqualTo(",rD##number##general,AngleDeg##number##general,D##length##inches,C##number##general"), "first header cell empty");
        Assert.That(lines, Has.Length.EqualTo(rows + 1));
        // Values the spike CSV held (PeElbowC.csv, 2026-10-08): CD3-1 at 6 in is 0.14 and at 12 in holds the 10 in value 0.11.
        Assert.That(lines, Does.Contain("r1.5_a90_d6,1.5,90,6,0.14"));
        Assert.That(lines, Does.Contain("r1.5_a90_d12,1.5,90,12,0.11"));
        Assert.That(lines, Does.Contain("r1_a45_d6,1,45,6,0.11"), "CD3-4 at 6 in");
        Assert.That(lines, Does.Contain("r1_a5_d3,1,5,3,0.022"), "5 degrees scales the 45 degree value by 5/45");
        Assert.That(lines, Does.Contain("r2_a90_d6,2,90,6,0.14"), "r/D 2 reuses the 1.5 grids");
        Assert.That(lines.Skip(1).Select(l => l.Split(',')[4]), Has.All.Matches<string>(c => double.Parse(c, System.Globalization.CultureInfo.InvariantCulture) > 0));
    }

    [Test]
    public void Patch_selects_the_family_and_carries_the_formula_table_and_reload_policy() {
        var data = DuctFamilyTables.Patch(new DuctFamilyPatchRequest("Round Elbow"), Tables());
        var patch = data.Patch;

        Assert.That(patch["select"]!["names"]!.Select(n => n.ToString()), Is.EqualTo(new[] { "Round Elbow" }));
        var pe = patch["patch"]!["parameters"]!["Pe_C"]!;
        Assert.That((bool)pe["isInstance"]!, Is.True);
        Assert.That(pe["dataType"]!.ToString(), Is.EqualTo("Number"));
        Assert.That(pe["propertiesGroup"]!.ToString(), Is.EqualTo("autodesk.parameter.group:mechanicalAirflow-1.0.0"));
        Assert.That(pe["formula"]!.ToString(), Is.EqualTo(data.Formula).And.StartWith("size_lookup(\"PeElbowC\", \"C\", -1, Radius Multiplier, round(Angle / 1° / 5) * 5, round(Duct Radius * 24 / 1') * 1' / 12)"));
        Assert.That(patch["patch"]!["lookupTables"]!["PeElbowC"]!["csv"]!.ToString(), Does.StartWith(",rD##number##general"));
        Assert.That(patch["run"]!["failures"]!["cantKeepConnectivity"]!.ToString(), Is.EqualTo("Resolve"));
        Assert.That(data.Rows, Is.EqualTo(3132));
        // The patch parses as Family Foundry reads it.
        var parsed = Pe.Shared.RevitData.Families.FamilyPatch.Parse(patch.ToString());
        Assert.That(parsed.Run!.Failures!["cantKeepConnectivity"], Is.EqualTo(Pe.Shared.RevitData.Families.FailureAction.Resolve));
        Assert.That(DuctFamilyTables.Patch(new DuctFamilyPatchRequest("Round Elbow", Parameter: "PE_M_C"), Tables()).Patch["patch"]!["parameters"]!["PE_M_C"], Is.Not.Null);
    }

    [Test]
    public void Patch_names_the_missing_grid() {
        var ex = Assert.Throws<InvalidOperationException>(() => DuctFamilyTables.ElbowCsv(AshraeTables.Read(Folder(), ["CD3-2"])));
        Assert.That(ex!.Message, Does.Contain("CD3-4"));
    }
}
