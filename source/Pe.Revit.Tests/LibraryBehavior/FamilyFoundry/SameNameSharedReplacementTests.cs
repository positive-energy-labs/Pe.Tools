using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests;

/// <summary>
///     A same-name identity change (family to shared, shared to another GUID, shared to family) must keep per-type values,
///     formulas, dimension labels and visibility associations, and the receipt must not call a lossy replacement converged.
/// </summary>
[TestFixture]
public sealed class SameNameSharedReplacementTests {
    private static readonly string[] Replaced = ["Depth", "Height", "Show"];
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    // Depth: per-type values plus the label of a driving dimension. Height: its own formula. Show: per-type values plus a detail visibility
    // association. Half Depth is not replaced; its formula depends on Depth.
    private Document Build() {
        var parsed = FamilyModelJson.Parse("""
            { "family": { "name": "Same-name shared replacement", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "parameters": {
                "Depth": { "dataType": "Length" }, "Show": { "dataType": "YesNo" },
                "Height": { "dataType": "Length", "formula": "Depth * 2" }, "Half Depth": { "dataType": "Length", "formula": "Depth / 2" } },
              "types": { "A": { "Depth": "1ft", "Show": "Yes" }, "B": { "Depth": "2ft", "Show": "No" } },
              "datums": { "Ref. Level": { "normal": "Z", "isLevel": true }, "Center (Left/Right)": { "normal": "X" }, "Center (Front/Back)": { "normal": "Y" } },
              "refPlanes": { "left": { "normal": "PlusX", "at": "-1ft" }, "right": { "normal": "PlusX", "at": "1ft" }, "back": { "normal": "PlusY", "at": "1ft" } },
              "dimensions": { "depth": { "between": ["Center (Front/Back)", "back"], "label": "Depth", "view": "RefLevel" } },
              "details": { "Outline": { "view": "RefLevel", "curves": [{ "curves": [{"kind":"Line","on":"left"},{"kind":"Line","on":"back"},{"kind":"Line","on":"right"}] }], "visible": "param:Show" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty);
        return FamilyModelBuild.Build(this._ui.Application, parsed.Value!).Document;
    }

    private static JObject Shared(ForgeTypeId spec) => new() {
        ["shared"] = true, ["sharedGuid"] = Guid.NewGuid().ToString(), ["sharedSpecId"] = spec.TypeId
    };

    private static FamilyPatch Hop(int hop) => new() { Patch = new JObject { ["parameters"] = hop == 3
        ? new JObject(Replaced.Select(name => new JProperty(name, new JObject { ["shared"] = false, ["dataType"] = name == "Show" ? "YesNo" : "Length" })))
        : new JObject { ["Depth"] = Shared(SpecTypeId.Length), ["Height"] = Shared(SpecTypeId.Length), ["Show"] = Shared(SpecTypeId.Boolean.YesNo) } } };

    /// <summary>Native truth by name: what a replacement must carry across, independent of capture.</summary>
    private static JObject Observe(Document document) {
        var fm = document.FamilyManager;
        var cells = new JObject();
        foreach (var type in fm.Types.Cast<FamilyType>().OrderBy(type => type.Name, StringComparer.Ordinal))
            cells[type.Name] = new JObject {
                ["Depth"] = type.AsDouble(fm.FindParameter("Depth")), ["Height"] = type.AsDouble(fm.FindParameter("Height")),
                ["Half Depth"] = type.AsDouble(fm.FindParameter("Half Depth")), ["Show"] = type.AsInteger(fm.FindParameter("Show"))
            };
        return new JObject {
            ["cells"] = cells,
            ["formulas"] = new JObject { ["Height"] = fm.FindParameter("Height")?.Formula, ["Half Depth"] = fm.FindParameter("Half Depth")?.Formula },
            ["labels"] = new JArray(new FilteredElementCollector(document).OfClass(typeof(Dimension)).Cast<Dimension>()
                .Select(dimension => dimension.FamilyLabel?.Definition.Name).OfType<string>().OrderBy(name => name, StringComparer.Ordinal)),
            ["visibility"] = new JArray(new FilteredElementCollector(document).OfClass(typeof(CurveElement)).OfType<SymbolicCurve>()
                .Select(curve => fm.GetAssociatedFamilyParameter(curve.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM))?.Definition.Name ?? "<none>")
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
            Assert.That(original["visibility"]!.Values<string>(), Is.EqualTo(new[] { "Show", "Show", "Show" }), "fixture: Show drives every outline curve");
            Assert.That(original["cells"]!["A"]!["Height"]!.Value<double>(), Is.EqualTo(2d), "fixture: Height reads its formula");
            using var processor = new OperationProcessor(document);
            Func<Document, FamilySharedParameterSource> source = d => new(d, []);
            for (var hop = 1; hop <= finalHop; hop++) {
                var patch = Hop(hop);
                var before = document.CaptureFamilyModel();
                var preview = document.PreviewFamily(patch, sharedSource: source);
                Assert.That(preview.Diagnostics, Is.Empty, $"hop {hop} preview");
                // Preview promises an identity change only: no cell, formula, label or visibility edit. Apply must deliver exactly that.
                Assert.That(preview.Changes.Where(change => change.Section is "types.cell" or "dimensions" or "details" ||
                    change.Section == "parameters" && change.Key == "Half Depth"), Is.Empty, $"hop {hop} preview claims a non-identity change");
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
