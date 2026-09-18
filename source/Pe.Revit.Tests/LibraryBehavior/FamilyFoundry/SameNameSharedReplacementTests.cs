using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests;

/// <summary>
///     A same-name identity change (family to shared, shared to another GUID, shared to family) must keep per-type values,
///     formulas, dimension and array labels, nested and visibility associations, and lookup references, and the receipt must not call a lossy replacement converged.
/// </summary>
[TestFixture]
public sealed class SameNameSharedReplacementTests {
    private static readonly string[] Replaced = ["Depth", "Height", "Show", "Count"];
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    // Depth: per-type values, the label of a driving dimension, a nested instance association and a lookup key. Height: its own formula.
    // Show: per-type values plus a detail visibility association. Count: per-type values plus the label of a linear array of that nested
    // family. Half Depth and Looked Up are not replaced; their formulas reference Depth by name.
    private Document Build() {
        var parsed = FamilyModelJson.Parse("""
            { "family": { "name": "Same-name shared replacement", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "parameters": {
                "Depth": { "dataType": "Length" }, "Show": { "dataType": "YesNo" },
                "Height": { "dataType": "Length", "formula": "Depth * 2" }, "Half Depth": { "dataType": "Length", "formula": "Depth / 2" },
                "Count": { "dataType": "Integer" }, "Looked Up": { "dataType": "Number", "formula": "size_lookup(LookupTableName, \"Out\", 0, Depth)" },
                "LookupTableName": { "dataType": "Text", "value": "Depths" } },
              "types": { "A": { "Depth": "1ft", "Show": "Yes", "Count": "2" }, "B": { "Depth": "2ft", "Show": "No", "Count": "3" } },
              "lookupTables": { "Depths": { "csv": ",Key##length##feet,Out##number##general\nr1,1,10\nr2,2,20\n" } },
              "datums": { "Ref. Level": { "normal": "Z", "isLevel": true }, "Center (Left/Right)": { "normal": "X" }, "Center (Front/Back)": { "normal": "Y" } },
              "refPlanes": { "left": { "normal": "PlusX", "at": "-1ft" }, "right": { "normal": "PlusX", "at": "1ft" }, "back": { "normal": "PlusY", "at": "1ft" },
                             "front": { "normal": "PlusY", "at": "-1ft" } },
              "dimensions": { "depth": { "between": ["Center (Front/Back)", "back"], "label": "Depth", "view": "RefLevel" } },
              "details": { "Outline": { "view": "RefLevel", "curves": [{ "curves": [{"kind":"Line","on":"left"},{"kind":"Line","on":"back"},{"kind":"Line","on":"right"},{"kind":"Line","on":"front"}] }], "visible": "param:Show" } },
              "nested": { "vane": { "family": "vane", "type": "type one", "host": "Ref. Level",
                "align": [ { "instance": "Center (Left/Right)", "to": "Center (Left/Right)" }, { "instance": "Center (Front/Back)", "to": "Center (Front/Back)" } ],
                "associate": { "_vane length": "param:Depth" } } },
              "arrays": { "vanes": { "member": "vane", "direction": "PlusY", "label": "param:Count", "moveTo": "Last", "spacingPlane": "back" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty, string.Join("; ", parsed.Diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        // The nested family builds from the sibling Fixtures/FamilyModel/vane.json.
        var modelDirectory = Path.GetDirectoryName(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("vane.json"));
        return FamilyModelBuild.Build(this._ui.Application, parsed.Value!, modelDirectory: modelDirectory).Document;
    }

    private static JObject Shared(ForgeTypeId spec) => new() {
        ["shared"] = true, ["sharedGuid"] = Guid.NewGuid().ToString(), ["sharedSpecId"] = spec.TypeId
    };

    private static FamilyPatch Hop(int hop) => new() { Patch = new JObject { ["parameters"] = hop == 3
        ? new JObject(Replaced.Select(name => new JProperty(name, new JObject { ["shared"] = false, ["dataType"] = name switch { "Show" => "YesNo", "Count" => "Integer", _ => "Length" } })))
        : new JObject { ["Depth"] = Shared(SpecTypeId.Length), ["Height"] = Shared(SpecTypeId.Length), ["Show"] = Shared(SpecTypeId.Boolean.YesNo),
            ["Count"] = Shared(SpecTypeId.Int.Integer) } } };

    /// <summary>Native truth by name: what a replacement must carry across, independent of capture.</summary>
    private static JObject Observe(Document document) {
        var fm = document.FamilyManager;
        var cells = new JObject();
        foreach (var type in fm.Types.Cast<FamilyType>().OrderBy(type => type.Name, StringComparer.Ordinal))
            cells[type.Name] = new JObject {
                ["Depth"] = type.AsDouble(fm.FindParameter("Depth")), ["Height"] = type.AsDouble(fm.FindParameter("Height")),
                ["Half Depth"] = type.AsDouble(fm.FindParameter("Half Depth")), ["Show"] = type.AsInteger(fm.FindParameter("Show")),
                ["Count"] = type.AsInteger(fm.FindParameter("Count")), ["Looked Up"] = type.AsDouble(fm.FindParameter("Looked Up"))
            };
        return new JObject {
            ["cells"] = cells,
            ["formulas"] = new JObject { ["Height"] = fm.FindParameter("Height")?.Formula, ["Half Depth"] = fm.FindParameter("Half Depth")?.Formula,
                ["Looked Up"] = fm.FindParameter("Looked Up")?.Formula },
            ["labels"] = new JArray(new FilteredElementCollector(document).OfClass(typeof(Dimension)).Cast<Dimension>()
                .Select(dimension => dimension.FamilyLabel?.Definition.Name).OfType<string>().OrderBy(name => name, StringComparer.Ordinal)),
            ["visibility"] = new JArray(new FilteredElementCollector(document).OfClass(typeof(CurveElement)).OfType<SymbolicCurve>()
                .Select(curve => fm.GetAssociatedFamilyParameter(curve.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM))?.Definition.Name ?? "<none>")
                .OrderBy(name => name, StringComparer.Ordinal)),
            ["arrays"] = new JArray(new FilteredElementCollector(document).OfClass(typeof(LinearArray)).Cast<LinearArray>()
                .Select(array => array.Label?.Definition.Name ?? "<none>").OrderBy(name => name, StringComparer.Ordinal)),
            // Every arrayed member carries the association; count them per name so a member that loses it shows.
            ["nested"] = new JArray(new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .Where(instance => instance.Symbol.Family.Name == "vane")
                .Select(instance => fm.GetAssociatedFamilyParameter(instance.LookupParameter("_vane length"))?.Definition.Name ?? "<none>")
                .OrderBy(name => name, StringComparer.Ordinal))
        };
    }

    private static JToken Section(FamilyModel model, Func<FamilyModel, object> section) =>
        JToken.Parse(Newtonsoft.Json.JsonConvert.SerializeObject(section(model), FamilyModelJson.Settings));

    [TestCase(1, TestName = "Family_to_shared_keeps_values_formulas_and_associations")]
    [TestCase(2, TestName = "Shared_to_other_guid_keeps_values_formulas_and_associations")]
    [TestCase(3, TestName = "Shared_to_family_keeps_values_formulas_and_associations")]
    public void Same_name_identity_change_preserves_original(int finalHop) {
        Document? document = null;
        try {
            document = this.Build();
            var original = Observe(document);
            Assert.That(original["labels"]!.Values<string>(), Is.EqualTo(new[] { "Depth" }), "fixture: Depth labels the driving dimension");
            Assert.That(original["visibility"]!.Values<string>(), Is.EqualTo(new[] { "Show", "Show", "Show", "Show" }), "fixture: Show drives every outline curve");
            Assert.That(original["cells"]!["A"]!["Height"]!.Value<double>(), Is.EqualTo(2d), "fixture: Height reads its formula");
            Assert.That(original["arrays"]!.Values<string>(), Is.EqualTo(new[] { "Count" }), "fixture: Count labels the vane array");
            Assert.That(original["nested"]!.Values<string>(), Is.Not.Empty.And.All.EqualTo("Depth"), "fixture: every vane associates _vane length to Depth");
            Assert.That((original["cells"]!["A"]!["Looked Up"]!.Value<double>(), original["cells"]!["B"]!["Looked Up"]!.Value<double>()), Is.EqualTo((10d, 20d)),
                "fixture: Looked Up reads the table keyed on Depth");
            using var processor = new OperationProcessor(document);
            Func<Document, FamilySharedParameterSource> source = d => new(d, []);
            for (var hop = 1; hop <= finalHop; hop++) {
                var patch = Hop(hop);
                var before = document.CaptureFamilyModel();
                var preview = document.PreviewFamily(patch, sharedSource: source);
                Assert.That(preview.Diagnostics, Is.Empty, $"hop {hop} preview");
                // Preview promises an identity change only: no cell, formula, label or visibility edit. Apply must deliver exactly that.
                Assert.That(preview.Changes.Where(change => change.Section is "types.cell" or "dimensions" or "details" or "arrays" or "nested" or "lookupTables" ||
                    change.Section == "parameters" && change.Key is "Half Depth" or "Looked Up"), Is.Empty, $"hop {hop} preview claims a non-identity change");
                var apply = new ReconcileFamily(patch, expectedPlanHash: preview.PlanHash, sharedSource: source);
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(apply));
                var (_, error) = contexts.Single().OperationLogs;
                var observed = Observe(document);
                var lost = !JToken.DeepEquals(original, observed);
                // Receipt honesty first: a converged receipt over a lossy native replacement is the invisible loss this fixture exists for.
                Assert.That(apply.LastReceipt?.Converged == true && lost, Is.False,
                    $"hop {hop}: receipt converged while native state changed.\noriginal: {original}\nobserved: {observed}");
                Assert.That(error, Is.Null, $"hop {hop}: {error}");
                Assert.That(apply.LastReceipt?.Converged, Is.True, $"hop {hop}");
                Assert.That(apply.LastReceipt!.PlanHash, Is.EqualTo(preview.PlanHash), $"hop {hop}");
                Assert.That(observed.ToString(), Is.EqualTo(original.ToString()), $"hop {hop}: native values, formulas or associations changed");
                var fm = document.FamilyManager;
                foreach (var name in Replaced) {
                    var parameter = fm.FindParameter(name) ?? throw new AssertionException($"hop {hop}: '{name}' is gone");
                    var wanted = (string?)patch.Patch["parameters"]![name]!["sharedGuid"];
                    Assert.That(parameter.IsShared ? parameter.GUID.ToString() : null, Is.EqualTo(wanted), $"hop {hop}: '{name}' identity");
                }
                Assert.That(fm.Parameters.Cast<FamilyParameter>().Select(p => p.Definition.Name), Has.None.StartsWith("FF_Transfer_"), $"hop {hop}");
                var after = document.CaptureFamilyModel();
                foreach (var (name, section) in new (string, Func<FamilyModel, object>)[] {
                             ("types", m => m.Types), ("dimensions", m => m.Dimensions), ("details", m => m.Details),
                             ("arrays", m => m.Arrays), ("nested", m => m.Nested), ("lookupTables", m => m.LookupTables),
                             ("formulas", m => m.Parameters.ToDictionary(p => p.Key, p => p.Value.Formula)) })
                    Assert.That(JToken.DeepEquals(Section(after, section), Section(before, section)), Is.True,
                        $"hop {hop}: captured {name} differ from the preview baseline\nbefore: {Section(before, section)}\nafter: {Section(after, section)}");
                var repeated = new ReconcileFamily(patch, sharedSource: source);
                _ = processor.ProcessQueue(new OperationQueue().Add(repeated));
                Assert.That(repeated.LastReceipt?.Converged, Is.True, $"hop {hop} reapply");
                Assert.That(repeated.LastPlan!.Changes, Is.Empty, $"hop {hop} reapply");
            }
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }
}
