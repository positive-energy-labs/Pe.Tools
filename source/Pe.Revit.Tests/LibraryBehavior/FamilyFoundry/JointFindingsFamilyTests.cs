using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests;

/// <summary>Native repros for the project-a joint-hold Family defects (tip 3231934, /families bulk path).</summary>
[TestFixture]
public sealed class JointFindingsFamilyTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    private static (Exception? Error, FamilyPreview Preview, ReconcileFamily Operation) Apply(Document document, JObject patchJson) {
        var patch = new FamilyPatch { Patch = patchJson };
        var preview = document.PreviewFamily(patch);
        var operation = new ReconcileFamily(patch, expectedPlanHash: preview.PlanHash);
        using var processor = new OperationProcessor(document);
        var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
        var (_, error) = contexts.Single().OperationLogs;
        return (error, preview, operation);
    }

    // F-J4-2 (ruling 1530-1: empty is a value, not delete): the per-type table dropped "" as "no value", so Revit kept the old text and
    // reconciliation reported residue.
    [TestCase("Text", TestName = "Text_type_parameter_cleared_to_empty_reads_back_empty")]
    [TestCase("Url", TestName = "Url_type_parameter_cleared_to_empty_reads_back_empty")]
    public void Type_parameter_cleared_to_empty_reads_back_empty(string spec) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._ui.Application, BuiltInCategory.OST_GenericModel, "FF clear text");
        try {
            using (var seed = new Transaction(document, "Seed text")) {
                seed.Start();
                var fm = document.FamilyManager;
                var url = fm.AddParameter("Url", GroupTypeId.IdentityData, spec == "Url" ? SpecTypeId.String.Url : SpecTypeId.String.Text, false);
                foreach (var name in new[] { "A", "B" }) {
                    fm.CurrentType = fm.NewType(name);
                    fm.Set(url, $"https://{name.ToLowerInvariant()}.example");
                }
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var (error, preview, operation) = Apply(document, JObject.Parse("""{"types":{"A":{"Url":""}}}"""));
            Assert.That(preview.Changes.Where(c => c.Section == "types.cell").Select(c => c.Key), Is.EqualTo(new[] { "A/Url" }));
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var manager = document.FamilyManager;
            var parameter = manager.FindParameter("Url");
            Assert.That(parameter, Is.Not.Null, "empty is a value, not delete");
            var types = manager.Types.Cast<FamilyType>().ToDictionary(t => t.Name);
            Assert.That(types["A"].AsString(parameter), Is.EqualTo(string.Empty));
            Assert.That(types["B"].AsString(parameter), Is.EqualTo("https://b.example"));
            var captured = document.CaptureFamilyModel();
            Assert.That(captured.Types["A"].TryGetValue("Url", out var cell) ? cell.Text : "<no cell>", Is.EqualTo(string.Empty),
                "the capture keeps the empty value as a cell, so a reapply is a no-op");
            var again = Apply(document, JObject.Parse("""{"types":{"A":{"Url":""}}}"""));
            Assert.That(again.Operation.LastPlan!.Changes, Is.Empty);
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }

    // F-J3-2: a round connector sized through its Radius slot by a type parameter was captured as the CURRENT type's literal diameter, so
    // a value-only patch left connector residue once the value writer changed the current type.
    [Test]
    public void Radius_driven_connector_round_trips_across_types_and_a_value_patch_touches_no_connector() {
        var parsed = FamilyModelJson.Parse("""
            { "family": { "name": "FF radius connector", "category": "AirTerminals", "template": "Generic Model face based", "placement": "WorkPlaneBased" },
              "parameters": { "D": { "dataType": "Length" }, "R": { "dataType": "Length", "formula": "D / 2" }, "Url": { "dataType": "Text" },
                "Size": { "dataType": "Length", "value": "2ft" }, "Thick": { "dataType": "Length", "value": "1in" } },
              "types": { "A": { "D": "5in", "Url": "a" }, "B": { "D": "8in", "Url": "b" } },
              "datums": { "Ref. Level": { "normal": "Z", "isLevel": true }, "Center (Left/Right)": { "normal": "X" }, "Center (Front/Back)": { "normal": "Y" } },
              "forms": { "flange": { "kind": "Prism", "center": ["Center (Left/Right)", "Center (Front/Back)"], "bottom": "Ref. Level", "width": "param:Size", "depth": "param:Size", "height": "param:Thick" } },
              "connectors": { "supply": { "domain": "Duct", "systemType": "SupplyAir", "on": "flange.top", "at": ["Center (Left/Right)", "Center (Front/Back)"],
                "shape": "Round", "diameter": "param:D", "flowDirection": "In" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty, string.Join("; ", parsed.Diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        Document? document = null;
        try {
            document = FamilyModelBuild.Build(this._ui.Application, parsed.Value!).Document;
            var connector = new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>().Single();
            using (var rewire = new Transaction(document, "Size the connector through its radius")) {
                rewire.Start();
                var fm = document.FamilyManager;
                fm.AssociateElementParameterToFamilyParameter(connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER), null);
                fm.AssociateElementParameterToFamilyParameter(connector.get_Parameter(BuiltInParameter.CONNECTOR_RADIUS), fm.FindParameter("R"));
                Assert.That(rewire.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            Assert.That(document.FamilyManager.GetAssociatedFamilyParameter(connector.get_Parameter(BuiltInParameter.CONNECTOR_RADIUS))?.Definition.Name,
                Is.EqualTo("R"), "fixture: the radius slot drives the size");

            FamilyModel CaptureAs(string typeName) {
                using var current = new Transaction(document, $"Current type {typeName}");
                current.Start();
                document.FamilyManager.CurrentType = document.FamilyManager.Types.Cast<FamilyType>().Single(t => t.Name == typeName);
                Assert.That(current.Commit(), Is.EqualTo(TransactionStatus.Committed));
                return document.CaptureFamilyModel();
            }
            var asA = CaptureAs("A");
            var asB = CaptureAs("B");
            Assert.That(FamilyReconciler.Diff(asA, asB, UnitResolvers.Revit(document)).Where(c => c.Section == "connectors"), Is.Empty,
                "an unedited family captures the same connectors whatever type is current");
            Assert.That(asA.Unmodeled.Select(f => (f.Reason, f.Path)), Has.Member((UnmodeledReason.ConnectorSizeByRadius, "$.connectors.duct-supplyair.diameter")),
                "the radius association is named, not flattened to a literal");

            var (error, preview, operation) = Apply(document, JObject.Parse("""{"types":{"A":{"Url":"a-edited"}}}"""));
            Assert.That(preview.Changes.Where(c => c.Section == "connectors"), Is.Empty, "a value-only patch plans no connector change");
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(operation.LastReceipt!.Residue, Is.Empty);
            Assert.That(document.FamilyManager.GetAssociatedFamilyParameter(connector.get_Parameter(BuiltInParameter.CONNECTOR_RADIUS))?.Definition.Name,
                Is.EqualTo("R"), "the radius association survives");
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }
}
