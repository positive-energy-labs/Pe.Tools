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
        Assert.That(b.ParameterValues, Is.EqualTo(a.ParameterValues));
        Assert.That(b.Planes.Keys, Is.EquivalentTo(a.Planes.Keys));
        Assert.That(b.DimensionCount, Is.EqualTo(a.DimensionCount));
        Assert.That(b.Prisms, Has.Count.EqualTo(a.Prisms.Count));
        Assert.That(b.Cylinders, Has.Count.EqualTo(a.Cylinders.Count));

        for (var index = 0; index < a.Prisms.Count; index++) {
            AssertXyz(b.Prisms[index].Min, a.Prisms[index].Min);
            AssertXyz(b.Prisms[index].Max, a.Prisms[index].Max);
        }
    }

    private static void AssertXyz(XYZ actual, XYZ expected) {
        Assert.That(actual.X, Is.EqualTo(expected.X).Within(1e-6));
        Assert.That(actual.Y, Is.EqualTo(expected.Y).Within(1e-6));
        Assert.That(actual.Z, Is.EqualTo(expected.Z).Within(1e-6));
    }
}
