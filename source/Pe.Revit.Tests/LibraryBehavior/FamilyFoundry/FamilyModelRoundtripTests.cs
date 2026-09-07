using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>Native family.json acceptance through saved RFAs, with no authored state available to capture.</summary>
[TestFixture]
public sealed class FamilyModelRoundtripTests {
    [TestCase("a-box")]
    [TestCase("b-grd")]
    [TestCase("c-bath-shower")]
    [TestCase("d-bath-shower-refline")]
    public void Authored_family_survives_capture_rebuild_and_reopen(string fixture, UIApplication ui) {
        var artifact = FamilyFoundryRoundtripHarness.RunFamilyModelRoundtrip(
            ui.Application, $"{fixture}.family.json", $"native-roundtrip-{fixture}");
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
