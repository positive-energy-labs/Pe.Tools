using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter;

namespace Pe.Revit.Tests;

/// <summary>
///     Verdict-2 acceptance for the ops library: one caller renames a parameter across THREE families in one
///     project, live. This drives <see cref="RenameParamAcross.Run" /> — the same function the
///     `family-rename-proof` pod's single entrypoint calls — so the pod is proven by this test rather than by
///     being pressed against a user document.
/// </summary>
[TestFixture]
public sealed class FamilyRenameAcrossFamiliesTests {
    private const string OldName = "PE Tag";
    private const string NewName = "PE Asset Tag";

    private static readonly string[] FamilyNames = ["PE Rename A", "PE Rename B", "PE Rename C"];

    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._application = uiApplication?.Application
                            ?? throw new InvalidOperationException("ricaun.RevitTest did not provide a UIApplication.");

    [TestCase(OldName, NewName, DataType.Text)]
    [TestCase("Width", "Renamed Width", DataType.Length)]
    public void One_call_renames_a_parameter_across_three_loaded_families(string from, string to, DataType dataType) {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.One_call_renames_a_parameter_across_three_loaded_families));
        Document? project = null;
        try {
            project = RevitFamilyFixtureHarness.CreateProjectDocument(this._application);
            foreach (var name in FamilyNames) {
                var rfa = Path.Combine(outputDirectory, $"{name}.rfa");
                _ = FamilyModelBuild.BuildAndSave(this._application, TaggedBox(name, dataType), rfa, overwrite: true);
                _ = RevitFamilyFixtureHarness.LoadFamilyIntoProject(this._application, project, rfa);
            }

            var outcomes = RenameParamAcross.Run(project, FamilyNames, from, to, dataType);

            Assert.That(outcomes.Select(o => o.Family), Is.EqualTo(FamilyNames));
            foreach (var outcome in outcomes) {
                Assert.That(outcome.Error, Is.Null, $"{outcome.Family}: {outcome.Error}");
                Assert.That(outcome.Before, Does.Contain(from), $"{outcome.Family} before: {string.Join(", ", outcome.Before)}");
                Assert.That(outcome.Renamed(from, to), Is.True,
                    $"{outcome.Family} after: {string.Join(", ", outcome.After)}\nreceipt: {JsonConvert.SerializeObject(outcome.Receipt, Formatting.Indented)}");
            }

            // The receipts and the before/after snapshots are the library's own account of itself. The proof is
            // what Revit holds: re-open each LOADED family and read its FamilyManager.
            foreach (var name in FamilyNames) {
                var parameters = ParameterNamesOf(project, name, from, to, dataType);
                Assert.That(parameters, Does.Contain(to), $"{name}: {string.Join(", ", parameters)}");
                Assert.That(parameters, Does.Not.Contain(from), $"{name}: {string.Join(", ", parameters)}");
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(project);
        }
    }

    /// <summary>Retain the unreferenced text case and cover native width labels, type values and formula references.</summary>
    private static FamilyModel TaggedBox(string familyName, DataType dataType) {
        var json = JObject.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("a-box.family.json")));
        json["family"]!["name"] = familyName;
        ((JObject)json["parameters"]!)[OldName] = new JObject { ["dataType"] = "Text" };
        if (dataType == DataType.Length)
            ((JObject)json["parameters"]!)["Double Width"] = new JObject { ["dataType"] = "Length", ["formula"] = "Width * 2" };
        var parsed = FamilyModelJson.Parse(json.ToString());
        Assert.That(parsed.Value, Is.Not.Null, string.Join(Environment.NewLine, parsed.Diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        return parsed.Value!;
    }

    private static List<string> ParameterNamesOf(Document project, string familyName, string from, string to, DataType dataType) {
        var family = project.FamiliesMatching(new PatchSelect { Names = [familyName] }).Single();
        Document? familyDocument = null;
        try {
            familyDocument = project.EditFamily(family);
            Assert.That(familyDocument.FamilyManager.Parameters.Cast<FamilyParameter>()
                    .Any(parameter => parameter.Definition.Name == from), Is.False,
                $"{familyName}: native source parameter '{from}' survived rename.");
            if (dataType == DataType.Length) {
                var manager = familyDocument.FamilyManager;
                var renamed = manager.Parameters.Cast<FamilyParameter>().Single(p => p.Definition.Name == to);
                var dependent = manager.Parameters.Cast<FamilyParameter>().Single(p => p.Definition.Name == "Double Width");
                Assert.That(dependent.Formula, Does.Contain(to));
                foreach (var type in manager.Types.Cast<FamilyType>()) {
                    var expected = type.Name == "Wide" ? 3d : 2d;
                    Assert.That(type.AsDouble(renamed), Is.EqualTo(expected).Within(1e-9));
                    Assert.That(type.AsDouble(dependent), Is.EqualTo(expected * 2).Within(1e-9));
                }
                Assert.That(renamed.AssociatedDimensions(new FamilyDocument(familyDocument)), Is.Not.Empty,
                    "Width dimension label must survive rename.");
            }
            return familyDocument.FamilyManager.Parameters.Cast<FamilyParameter>()
                .Select(p => p.Definition.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }
}
