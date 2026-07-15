using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB.ExtensibleStorage;
using Newtonsoft.Json;
using Pe.Revit.FamilyFoundry.Capture;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyModelRoundtripTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._application = uiApplication?.Application
                            ?? throw new InvalidOperationException(
                                "ricaun.RevitTest did not provide a UIApplication.");

    [Test]
    public void Minimal_box_roundtrips_from_reopened_Revit_state_without_metadata() {
        FamilyModelRoundtripArtifact? artifact = null;
        try {
            artifact = FamilyFoundryRoundtripHarness.RunFamilyModelRoundtrip(
                this._application,
                Path.Combine("family-model", "minimal-box.family.json"),
                nameof(this.Minimal_box_roundtrips_from_reopened_Revit_state_without_metadata));

            Assert.That(artifact.CapturedFromA.Unmodeled, Is.Empty);
            Assert.That(artifact.CapturedFromA.RoomCalculationPoint?.Enabled, Is.True);
            AssertNoUndeclaredParameters(artifact.ReopenedA, artifact.Authored);
            AssertNoUndeclaredParameters(artifact.ReopenedB, artifact.CapturedFromA);
            AssertNoPersistedMetadata(artifact.ReopenedA);
            AssertNoPersistedMetadata(artifact.ReopenedB);

            var capturedB = artifact.ReopenedB.CaptureFamilyModel();
            Assert.That(capturedB.Unmodeled, Is.Empty);
            Assert.That(
                JsonConvert.SerializeObject(capturedB, Formatting.Indented),
                Is.EqualTo(JsonConvert.SerializeObject(artifact.CapturedFromA, Formatting.Indented)));

            AssertEquivalentRuntime(
                FamilyFoundryRuntimeProbe.Collect(artifact.ReopenedA),
                FamilyFoundryRuntimeProbe.Collect(artifact.ReopenedB));
        } finally {
            artifact?.CloseDocuments();
        }
    }

    [Test]
    public void Showcase_roundtrips_solids_voids_frames_and_MEP_connectors() {
        FamilyModelRoundtripArtifact? artifact = null;
        try {
            artifact = FamilyFoundryRoundtripHarness.RunFamilyModelRoundtrip(
                this._application,
                Path.Combine("family-model", "family-model-showcase.family.json"),
                nameof(this.Showcase_roundtrips_solids_voids_frames_and_MEP_connectors));

            Assert.That(artifact.CapturedFromA.Unmodeled, Is.Empty,
                JsonConvert.SerializeObject(artifact.CapturedFromA.Unmodeled, Formatting.Indented));
            Assert.That(artifact.CapturedFromA.Planes.Keys,
                Does.Contain("return-elevation").And.Contain("pipe-elevation").And.Contain("electrical-elevation"));
            Assert.That(artifact.CapturedFromA.Solids, Has.Count.EqualTo(4));
            Assert.That(artifact.CapturedFromA.Frames, Has.Count.EqualTo(4));
            Assert.That(artifact.CapturedFromA.Connectors, Has.Count.EqualTo(4));
            Assert.That(artifact.CapturedFromA.Frames["return-air"].Origin[0], Is.EqualTo("face:body.Back"),
                $"Captured planes: {string.Join(", ", artifact.CapturedFromA.Planes.Keys)}");
            AssertFrame(artifact.CapturedFromA, "supply-air", "+Z", "+Y");
            AssertFrame(artifact.CapturedFromA, "return-air", "+Y", "+Z");
            AssertFrame(artifact.CapturedFromA, "sanitary", "+X", "+Z");
            AssertFrame(artifact.CapturedFromA, "power-balanced", "+X", "+Z");
            Assert.That(
                artifact.CapturedFromA.Connectors.Values.Select(connector => connector.Stub?.Depth),
                Is.All.EqualTo("param:Stub Depth"),
                "Stub depth associations must survive save/reopen; equal numeric literals are not roundtrip proof.");
            Assert.That(artifact.CapturedFromA.RoomCalculationPoint?.Enabled, Is.True);
            AssertNoUndeclaredParameters(artifact.ReopenedA, artifact.Authored);
            AssertNoUndeclaredParameters(artifact.ReopenedB, artifact.CapturedFromA);
            AssertNoPersistedMetadata(artifact.ReopenedA);
            AssertNoPersistedMetadata(artifact.ReopenedB);

            var capturedB = artifact.ReopenedB.CaptureFamilyModel();
            Assert.That(capturedB.Unmodeled, Is.Empty,
                JsonConvert.SerializeObject(capturedB.Unmodeled, Formatting.Indented));
            Assert.That(
                JsonConvert.SerializeObject(capturedB, Formatting.Indented),
                Is.EqualTo(JsonConvert.SerializeObject(artifact.CapturedFromA, Formatting.Indented)));
            var typeStates = FamilyFoundryRoundtripHarness.CreateExistingTypeStates(artifact.ReopenedA);
            Assert.That(typeStates.Select(state => state.Name),
                Is.EqualTo(new[] { "Compact", "Standard", "Tall" }));
            var statesA = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.ReopenedA,
                typeStates,
                FamilyFoundryRuntimeProbe.Collect);
            var statesB = FamilyFoundryRoundtripHarness.EvaluateRoundtripStates(
                artifact.ReopenedB,
                typeStates,
                FamilyFoundryRuntimeProbe.Collect);
            for (var index = 0; index < statesA.Count; index++) {
                Assert.That(statesB[index].TypeName, Is.EqualTo(statesA[index].TypeName));
                AssertEquivalentRuntime(statesA[index].Result, statesB[index].Result);
            }
        } finally {
            artifact?.CloseDocuments();
        }
    }


    private static void AssertNoUndeclaredParameters(Document document, Pe.Shared.RevitData.Families.FamilyModel model) {
        var declared = model.FamilyParameters.Keys
            .Concat(model.SharedParameters.Keys)
            .ToHashSet(StringComparer.Ordinal);
        var undeclared = document.FamilyManager.GetParameters()
            .Where(parameter => parameter.Id.Value() > 0)
            .Select(parameter => parameter.Definition.Name)
            .Where(name => !declared.Contains(name))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        Assert.That(undeclared, Is.Empty,
            $"FFManager introduced undeclared family parameters: {string.Join(", ", undeclared)}");
    }

    private static void AssertFrame(
        Pe.Shared.RevitData.Families.FamilyModel model,
        string slug,
        string normal,
        string up
    ) {
        Assert.That(model.Frames[slug].Normal, Is.EqualTo(normal), $"{slug} normal");
        Assert.That(model.Frames[slug].Up, Is.EqualTo(up), $"{slug} up");
    }

    private static void AssertNoPersistedMetadata(Document document) {
        Assert.That(new FilteredElementCollector(document).OfClass(typeof(DataStorage)).GetElementCount(), Is.Zero,
            "FFManager must not persist roundtrip state in DataStorage.");

        var entityOwners = Schema.ListSchemas()
            .SelectMany(schema => new FilteredElementCollector(document)
                .WherePasses(new ExtensibleStorageFilter(schema.GUID))
                .ToElementIds()
                .Select(id => $"{schema.SchemaName}:{id.Value()}"))
            .ToList();
        Assert.That(entityOwners, Is.Empty,
            $"FFManager must not persist roundtrip state in extensible storage: {string.Join(", ", entityOwners)}");
    }

    private static void AssertEquivalentRuntime(RuntimeStateProbe a, RuntimeStateProbe b) {
        Assert.That(b.TypeName, Is.EqualTo(a.TypeName));
        Assert.That(b.ParameterValues.Keys, Is.EquivalentTo(a.ParameterValues.Keys));
        foreach (var (name, expected) in a.ParameterValues)
            Assert.That(b.ParameterValues[name], Is.EqualTo(expected).Within(1e-9), name);
        Assert.That(b.Planes.Keys, Is.EquivalentTo(a.Planes.Keys));
        foreach (var (name, expected) in a.Planes) {
            AssertXyz(b.Planes[name].Normal, expected.Normal);
            AssertXyz(b.Planes[name].Midpoint, expected.Midpoint);
        }
        Assert.That(b.DimensionCount, Is.EqualTo(a.DimensionCount));
        Assert.That(b.Prisms, Has.Count.EqualTo(a.Prisms.Count));
        Assert.That(b.Cylinders, Has.Count.EqualTo(a.Cylinders.Count));
        Assert.That(b.Connectors, Has.Count.EqualTo(a.Connectors.Count));

        var prismsA = OrderPrisms(a.Prisms);
        var prismsB = OrderPrisms(b.Prisms);
        for (var index = 0; index < prismsA.Count; index++) {
            var context = $"prism {index}: A={Describe(prismsA[index])}; B={Describe(prismsB[index])}";
            AssertXyz(prismsB[index].Min, prismsA[index].Min, context);
            AssertXyz(prismsB[index].Max, prismsA[index].Max, context);
            Assert.That(prismsB[index].StartOffset,
                Is.EqualTo(prismsA[index].StartOffset).Within(1e-6), context);
            Assert.That(prismsB[index].EndOffset,
                Is.EqualTo(prismsA[index].EndOffset).Within(1e-6), context);
        }

        for (var index = 0; index < a.Cylinders.Count; index++) {
            AssertXyz(b.Cylinders[index].Min, a.Cylinders[index].Min);
            AssertXyz(b.Cylinders[index].Max, a.Cylinders[index].Max);
            Assert.That(b.Cylinders[index].Diameter,
                Is.EqualTo(a.Cylinders[index].Diameter).Within(1e-6));
        }

        for (var index = 0; index < a.Connectors.Count; index++) {
            var expected = a.Connectors[index];
            var actual = b.Connectors[index];
            Assert.That(actual.Domain, Is.EqualTo(expected.Domain));
            Assert.That(actual.Profile, Is.EqualTo(expected.Profile));
            Assert.That(actual.SystemClassification, Is.EqualTo(expected.SystemClassification));
            Assert.That(actual.FlowDirection, Is.EqualTo(expected.FlowDirection));
            AssertXyz(actual.Origin, expected.Origin);
            AssertXyz(actual.WidthAxis, expected.WidthAxis);
            AssertXyz(actual.LengthAxis, expected.LengthAxis);
            AssertXyz(actual.FaceNormal, expected.FaceNormal);
            AssertNullableDouble(actual.Diameter, expected.Diameter);
            AssertNullableDouble(actual.Width, expected.Width);
            AssertNullableDouble(actual.Length, expected.Length);
        }
    }

    private static void AssertNullableDouble(double? actual, double? expected) {
        if (expected == null) {
            Assert.That(actual, Is.Null);
            return;
        }

        Assert.That(actual, Is.Not.Null.And.EqualTo(expected.Value).Within(1e-6));
    }

    private static IReadOnlyList<RuntimePrismProbe> OrderPrisms(IEnumerable<RuntimePrismProbe> prisms) =>
        prisms.OrderBy(prism => prism.Min.X)
            .ThenBy(prism => prism.Min.Y)
            .ThenBy(prism => prism.Min.Z)
            .ThenBy(prism => prism.Max.X)
            .ThenBy(prism => prism.Max.Y)
            .ThenBy(prism => prism.Max.Z)
            .ToList();

    private static string Describe(RuntimePrismProbe prism) =>
        $"{prism.SketchPlaneName} [{prism.Min.X},{prism.Min.Y},{prism.Min.Z}]..[{prism.Max.X},{prism.Max.Y},{prism.Max.Z}]";

    private static void AssertXyz(XYZ actual, XYZ expected, string? context = null) {
        Assert.That(actual.X, Is.EqualTo(expected.X).Within(1e-6), context);
        Assert.That(actual.Y, Is.EqualTo(expected.Y).Within(1e-6), context);
        Assert.That(actual.Z, Is.EqualTo(expected.Z).Within(1e-6), context);
    }
}
