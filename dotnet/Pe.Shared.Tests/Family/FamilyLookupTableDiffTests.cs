using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

/// <summary>The reconciler's lookup-table diff: preview, apply residue and Build all read this one comparison.</summary>
[TestFixture]
public sealed class FamilyLookupTableDiffTests {
    private const string Head = """{"family":{"name":"x","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"}""";
    private const string Captured = ",Key##length##feet,Out##number##general\r\nr1,1.000000,10.000000\r\nr2,2.000000,20.000000\r\n";

    private static FamilyModel Model(string csv) =>
        FamilyModelJson.Parse(Head + ",\"lookupTables\":{\"Depths\":{\"csv\":" + Newtonsoft.Json.JsonConvert.ToString(csv) + "}}}").Value!;

    private static IReadOnlyList<FamilyChange> Diff(string authored) =>
        FamilyReconciler.Diff(Model(authored), Model(Captured), (string _, PortableValue _, out double value) => { value = 0; return false; })
            .Where(change => change.Section == "lookupTables").ToList();

    [TestCase(",Key##length##feet,Out##number##general\nr1,1.000000,10.000000\nr2,2.000000,20.000000\n", TestName = "Diff_ignores_line_endings")]
    [TestCase(",Key##length##feet,Out##number##general\r\nr1,1,10\r\nr2,2,20\r\n", TestName = "Diff_ignores_number_spelling")]
    [TestCase(",Key##length##feet,Out##number##general\nr1,1,10\nr2,2,20\n", TestName = "Diff_accepts_the_authored_corpus_spelling")]
    public void Same_table_is_no_change(string authored) => Assert.That(Diff(authored), Is.Empty);

    [TestCase(",Key##length##feet,Out##number##general\nr1,1,11\nr2,2,20\n", TestName = "Diff_reports_a_value_change")]
    [TestCase(",Key##length##inches,Out##number##general\nr1,1,10\nr2,2,20\n", TestName = "Diff_reports_a_unit_change")]
    public void Different_table_is_one_update(string authored) =>
        Assert.That(Diff(authored).Select(change => (change.Key, change.Kind)), Is.EqualTo(new[] { ("Depths", ChangeKind.Update) }));
}
