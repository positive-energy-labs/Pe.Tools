using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>Native family.json acceptance through saved RFAs, with no authored state available to capture.</summary>
[TestFixture]
public sealed class FamilyModelRoundtripTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Rejected_template_placement_leaves_no_open_document() {
        var application = this._ui.Application;
        var before = application.Documents.Cast<Document>().ToArray();
        var model = new FamilyModel { Family = new FamilyModelHeader {
            Name = "Rejected placement", Category = FamilyCategory.GenericModels,
            Template = "Generic Model", Placement = FamilyModelPlacement.ViewBased
        } };
        Assert.Throws<InvalidOperationException>(() => FamilyModelBuild.Build(application, model));
        Assert.That(application.Documents.Cast<Document>(), Is.EquivalentTo(before));
    }

    [Test]
    public void Reapply_moves_a_named_plane_in_the_same_family() {
        var parsed = FamilyModelJson.Parse("""
            { "family": { "name": "Plane reapply", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "types": { "Standard": {} }, "refPlanes": { "Service clearance": { "normal": "PlusX", "at": "1ft" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty);
        var desired = parsed.Value!;
        Document? document = null;
        try {
            var built = FamilyModelBuild.Build(this._ui.Application, desired);
            document = built.Document;
            Assert.That(built.Receipt?.Converged, Is.True);
            desired.RefPlanes["Service clearance"] = new FamilyModelRefPlane { Normal = Axis.PlusX, At = PortableLength.FromFeet(2) };
            var receipt = FamilyModelBuild.Reconcile(document, desired);
            Assert.That(receipt?.Converged, Is.True);
            var plane = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                .Single(p => p.Name == "Service clearance");
            Assert.That(plane.GetPlane().Origin.X, Is.EqualTo(2).Within(1e-7));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [Test]
    public void Portable_values_preserve_units_and_literal_text_and_reapply_without_changes() {
        var parsed = FamilyModelJson.Parse("""
            { "family": { "name": "Portable angle", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "parameters": { "Rotation": { "dataType": "Angle", "value": "90deg" }, "Note": { "dataType": "Text", "value": "Rotation" } },
              "types": { "Quarter turn": {}, "Half turn": { "Rotation": "180deg" } } }
            """);
        Assert.That(parsed.Diagnostics, Is.Empty);
        Document? document = null;
        try {
            document = FamilyModelBuild.Build(this._ui.Application, parsed.Value!).Document;
            var parameter = document.FamilyManager.get_Parameter("Rotation");
            foreach (FamilyType type in document.FamilyManager.Types) {
                Assert.That(type.AsDouble(parameter), Is.EqualTo(type.Name == "Half turn" ? Math.PI : Math.PI / 2).Within(1e-9));
                Assert.That(type.AsString(document.FamilyManager.get_Parameter("Note")), Is.EqualTo("Rotation"));
            }
            var receipt = FamilyModelBuild.Reconcile(document, parsed.Value!);
            Assert.That(receipt?.Converged, Is.True);
            Assert.That(receipt!.Outcomes, Is.Empty);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [TestCase("a-box")]
    [TestCase("b-grd")]
    [TestCase("c-bath-shower")]
    [TestCase("d-bath-shower-refline")]
    public void Authored_family_survives_capture_rebuild_and_reopen(string fixture) {
        var artifact = FamilyFoundryRoundtripHarness.RunFamilyModelRoundtrip(
            this._ui.Application, $"{fixture}.family.json", $"native-roundtrip-{fixture}");
        try {
            AssertNativeContent(artifact.ReopenedA, artifact.Authored);
            AssertNativeContent(artifact.ReopenedB, artifact.Authored);
            var a = artifact.ReopenedA.CaptureFamilyModel();
            var b = artifact.ReopenedB.CaptureFamilyModel();
            Assert.That(FamilyReconciler.Diff(a, b, UnitResolvers.Revit(artifact.ReopenedB)), Is.Empty,
                "Saved Revit content must survive the capture/rebuild boundary.");

            var states = FamilyFoundryRoundtripHarness.CreateExistingTypeStates(artifact.ReopenedA);
            var before = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.ReopenedA, states, FamilyFoundryRuntimeProbe.Collect);
            var after = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.ReopenedB, states, FamilyFoundryRuntimeProbe.Collect);
            Assert.That(after.Select(x => x.TypeName), Is.EqualTo(before.Select(x => x.TypeName)));
            for (var i = 0; i < before.Count; i++) AssertRuntimeSame(before[i].Result, after[i].Result);

            var receipt = FamilyModelBuild.Reconcile(artifact.ReopenedB, artifact.Authored);
            Assert.That(receipt?.Converged, Is.True, "Reapplying the original specification must converge.");
            Assert.That(receipt!.Outcomes, Is.Empty, "Reapply must not need another mutation round.");
        } finally {
            artifact.CloseDocuments();
        }
    }

    private static void AssertNativeContent(Document document, FamilyModel desired) {
        var fm = document.FamilyManager;
        Assert.That(fm.Types.Cast<FamilyType>().Select(t => t.Name), Is.SupersetOf(desired.Types.Keys));
        foreach (var (name, spec) in desired.Parameters) {
            var parameter = fm.get_Parameter(name);
            Assert.That(parameter, Is.Not.Null, name);
            if (spec.Formula is not null) Assert.That(parameter!.Formula, Is.EqualTo(spec.Formula), name);
            if (spec.IsInstance is { } instance) Assert.That(parameter!.IsInstance, Is.EqualTo(instance), name);
            if (spec.Shared is { } shared) Assert.That(parameter!.IsShared, Is.EqualTo(shared), name);
        }
        Assert.That(new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).GetElementCount(),
            Is.EqualTo(desired.Connectors.Count), "Connectors must actually exist in the saved RFA.");
        if (desired.RoomCalculationPoint is { } point)
            Assert.That(document.OwnerFamily.ShowSpatialElementCalculationPoint, Is.EqualTo(point.Enabled));
        Assert.That(new FilteredElementCollector(document).OfClass(typeof(Extrusion)).GetElementCount(),
            Is.GreaterThanOrEqualTo(desired.Forms.Count), "Authored forms must actually exist.");
        foreach (var element in new FilteredElementCollector(document).WhereElementIsNotElementType())
            Assert.That(element.GetEntitySchemaGuids(), Is.Empty, $"Unexpected stored metadata on {element.Id}.");
    }

    private static void AssertRuntimeSame(RuntimeStateProbe a, RuntimeStateProbe b) {
        Assert.That(b.ParameterValues.Keys, Is.EquivalentTo(a.ParameterValues.Keys), a.TypeName);
        foreach (var (key, value) in a.ParameterValues)
            Assert.That(b.ParameterValues[key], Is.EqualTo(value).Within(1e-7), $"{a.TypeName}/{key}");
        Assert.That(b.Planes.Keys, Is.EquivalentTo(a.Planes.Keys), a.TypeName);
        foreach (var (key, plane) in a.Planes) {
            Assert.That(Math.Abs(b.Planes[key].Normal.DotProduct(plane.Normal)), Is.EqualTo(1).Within(1e-7), key);
            Assert.That(Math.Abs((b.Planes[key].Midpoint - plane.Midpoint).DotProduct(plane.Normal)),
                Is.LessThan(1e-7), key);
        }
        Assert.That(b.DimensionCount, Is.EqualTo(a.DimensionCount), a.TypeName);
        Assert.That(b.ExtrusionCount, Is.EqualTo(a.ExtrusionCount), a.TypeName);
        foreach (var prism in a.Prisms) {
            var match = b.Prisms.SingleOrDefault(p => p.SketchPlaneName == prism.SketchPlaneName
                && p.IsSolid == prism.IsSolid && p.Min.DistanceTo(prism.Min) < 1e-7 && p.Max.DistanceTo(prism.Max) < 1e-7);
            Assert.That(match, Is.Not.Null, $"Missing extrusion bounds in {a.TypeName} on {prism.SketchPlaneName}");
            Assert.That(match!.StartOffset, Is.EqualTo(prism.StartOffset).Within(1e-7));
            Assert.That(match.EndOffset, Is.EqualTo(prism.EndOffset).Within(1e-7));
        }
        foreach (var cylinder in a.Cylinders) {
            var match = b.Cylinders.SingleOrDefault(c => c.SketchPlaneName == cylinder.SketchPlaneName
                && c.IsSolid == cylinder.IsSolid && c.Min.DistanceTo(cylinder.Min) < 1e-7 && c.Max.DistanceTo(cylinder.Max) < 1e-7);
            Assert.That(match, Is.Not.Null, $"Missing cylinder bounds in {a.TypeName} on {cylinder.SketchPlaneName}");
            Assert.That(match!.Diameter, Is.EqualTo(cylinder.Diameter).Within(1e-7));
            Assert.That(match.StartOffset, Is.EqualTo(cylinder.StartOffset).Within(1e-7));
            Assert.That(match.EndOffset, Is.EqualTo(cylinder.EndOffset).Within(1e-7));
        }
        Assert.That(b.ConnectorCount, Is.EqualTo(a.ConnectorCount), a.TypeName);
        var remaining = b.Connectors.ToList();
        foreach (var connector in a.Connectors) {
            var match = remaining.SingleOrDefault(c => c.Domain == connector.Domain
                && c.Origin.DistanceTo(connector.Origin) < 1e-7);
            Assert.That(match, Is.Not.Null, $"Missing connector at {connector.Origin} in {a.TypeName}");
            Assert.Multiple(() => {
                Assert.That(match!.Profile, Is.EqualTo(connector.Profile));
                Assert.That(match.SystemClassification, Is.EqualTo(connector.SystemClassification));
                Assert.That(match.FlowDirection, Is.EqualTo(connector.FlowDirection));
                Assert.That(match.FaceNormal.DistanceTo(connector.FaceNormal), Is.LessThan(1e-7));
                Assert.That(match.Diameter, Is.EqualTo(connector.Diameter).Within(1e-7));
                Assert.That(match.Width, Is.EqualTo(connector.Width).Within(1e-7));
                Assert.That(match.Length, Is.EqualTo(connector.Length).Within(1e-7));
            });
            remaining.Remove(match!);
        }
        Assert.Multiple(() => {
            Assert.That(b.Settings.AlwaysVertical, Is.EqualTo(a.Settings.AlwaysVertical));
            Assert.That(b.Settings.Shared, Is.EqualTo(a.Settings.Shared));
            Assert.That(b.Settings.CutWithVoidsWhenLoaded, Is.EqualTo(a.Settings.CutWithVoidsWhenLoaded));
            Assert.That(b.Settings.PartType, Is.EqualTo(a.Settings.PartType));
            Assert.That(b.Settings.RoomCalculationPointEnabled, Is.EqualTo(a.Settings.RoomCalculationPointEnabled));
            Assert.That(b.Settings.LookupTableNames, Is.EqualTo(a.Settings.LookupTableNames));
        });
    }
}
