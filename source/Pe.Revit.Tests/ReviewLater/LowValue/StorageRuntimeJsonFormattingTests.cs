// Quarantined: formatting roundtrip appears to pin serializer implementation details.
// Keep only if forge type-label persistence is a real compatibility contract; otherwise delete.
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Revit.Tests;

[TestFixture]
[Explicit("Quarantined low-value serializer formatting test; review before treating as coverage.")]
public sealed class StorageRuntimeJsonFormattingTests {
    [Test]
    public void LocalDiskJsonFile_roundtrips_parameter_snapshot_forge_type_labels() {
        var filePath = Path.Combine(
            Path.GetTempPath(),
            $"storage-runtime-json-formatting-{Guid.NewGuid():N}.json");

        try {
            var jsonFile = new LocalDiskJsonFile<ParameterSnapshot>(filePath);
            var snapshot = new ParameterSnapshot {
                Name = "Width",
                IsInstance = false,
                PropertiesGroup = GroupTypeId.IdentityData,
                DataType = SpecTypeId.Length,
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = "2' - 0\"" }
            };

            jsonFile.Write(snapshot);

            var content = File.ReadAllText(filePath);
            var expectedGroupLabel = RevitLabelCatalog.GetLabelForPropertyGroup(GroupTypeId.IdentityData);
            var expectedDataTypeLabel = BuildExpectedSpecLabel(SpecTypeId.Length);

            Assert.Multiple(() => {
                Assert.That(content, Does.Contain($"\"PropertiesGroup\": \"{expectedGroupLabel}\""));
                Assert.That(content, Does.Contain($"\"DataType\": \"{expectedDataTypeLabel}\""));
                Assert.That(content, Does.Not.Contain("\"TypeId\""));
            });

            var roundtripped = jsonFile.Read();

            Assert.Multiple(() => {
                Assert.That(roundtripped.PropertiesGroup.TypeId, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
                Assert.That(roundtripped.DataType.TypeId, Is.EqualTo(SpecTypeId.Length.TypeId));
                Assert.That(roundtripped.ValuesPerType["Default"], Is.EqualTo("2' - 0\""));
            });
        } finally {
            if (File.Exists(filePath))
                File.Delete(filePath);
        }
    }

    private static string BuildExpectedSpecLabel(ForgeTypeId forgeTypeId) =>
        RevitLabelCatalog.GetLabelForSpec(forgeTypeId);
}
