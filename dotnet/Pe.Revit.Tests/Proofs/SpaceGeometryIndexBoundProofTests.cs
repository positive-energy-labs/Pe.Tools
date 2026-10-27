using Pe.Revit.Space;
using System.IO;
using Vector3 = System.Numerics.Vector3;

namespace Pe.Revit.Tests;

public sealed class SpaceGeometryIndexBoundProofTests {
    [Test]
    public void GeometryPackCapsDistinctKeysAndFallsBackWithoutLosingCurrentGeometry() {
        const int limit = 262144;
        var directory = Path.Combine(Path.GetTempPath(), "pe-index-bound-" + Guid.NewGuid().ToString("N"));
        try {
            using (var initial = new LinkedGeometryStore(directory).Open()) initial.Read("cached", () => Sample(1));
            var path = Path.Combine(directory, "geometry.pack");
            var original = File.ReadAllBytes(path);
            using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write))
            using (var writer = new BinaryWriter(stream)) {
                for (var i = 0; i < limit - 1; i++) WriteStructuralRecord(writer, i);
                // Duplicate keys replace their offset; they must not consume another index entry.
                writer.Write(original, 8, original.Length - 8);
            }

            var atLimit = new FileInfo(path).Length;
            using (var bounded = new LinkedGeometryStore(directory).Open()) {
                Assert.That(bounded.Read("cached", () => throw new InvalidOperationException("Exactly the distinct-key limit remains readable"))
                    .Rows.Single().ElementId, Is.EqualTo(1));
                var captures = 0;
                LinkedGeometryStore.Geometry Fresh() { captures++; return Sample(2); }
                Assert.That(bounded.Read("one-more-distinct-key", Fresh).Rows.Single().ElementId, Is.EqualTo(2),
                    "Overflow must return the just-captured geometry.");
                Assert.That(bounded.Read("cached", Fresh).Rows.Single().ElementId, Is.EqualTo(2),
                    "Overflow closes cache reuse for the remainder of this operation.");
                Assert.That(captures, Is.EqualTo(2));
            }
            Assert.That(new FileInfo(path).Length, Is.EqualTo(atLimit), "An overflowing new key is not appended.");

            using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write))
            using (var writer = new BinaryWriter(stream)) WriteStructuralRecord(writer, limit);
            var overflowLength = new FileInfo(path).Length;
            using (var overflow = new LinkedGeometryStore(directory).Open())
                Assert.That(overflow.Read("cached", () => Sample(3)).Rows.Single().ElementId, Is.EqualTo(3),
                    "An over-limit pack fails closed when scanned, without returning stale cached geometry.");
            Assert.That(new FileInfo(path).Length, Is.EqualTo(overflowLength), "Index overflow does not truncate valid pack bytes.");
        } finally {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    private static void WriteStructuralRecord(BinaryWriter writer, int index) {
        var key = new byte[32];
        BitConverter.GetBytes(index).CopyTo(key, 0);
        writer.Write(key);
        writer.Write(1);
        writer.Write(new byte[32]);
        writer.Write((byte)0);
    }

    private static LinkedGeometryStore.Geometry Sample(long id) => new([
        new PrimRow(0, id, id.ToString(), "Generic Models", PrimKind.Solid, new Aabb(0, 0, 0, 2, 2, 0), 1)
    ], [new Tri { A = Vector3.Zero, B = new Vector3(2, 0, 0), C = new Vector3(0, 2, 0), Prim = 0 }]);
}
