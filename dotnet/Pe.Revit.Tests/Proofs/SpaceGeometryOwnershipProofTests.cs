using System.IO;
using System.Numerics;
using System.Runtime.CompilerServices;
using Pe.Revit.Space;

namespace Pe.Revit.Tests;

public sealed class SpaceGeometryOwnershipProofTests {
    [Test]
    public void DiskGeometryReusesUncroppedElementsAndRecapturesMissingOrCorruptEntries() {
        var directory = Path.Combine(Path.GetTempPath(), "pe-linked-geometry-" + Guid.NewGuid().ToString("N"));
        try {
            var captures = 0;
            LinkedGeometryStore.Geometry Capture() {
                captures++;
                return new LinkedGeometryStore.Geometry([
                    new PrimRow(0, 7, "element", "Generic Models", PrimKind.Solid, new Aabb(0, 0, 0, 2, 2, 0), 1)
                ], [new Tri { A = Vector3.Zero, B = new Vector3(2, 0, 0), C = new Vector3(0, 2, 0), Prim = 0 }]);
            }
            var store = new LinkedGeometryStore(directory);
            var first = store.Read("element", Capture);
            var second = new LinkedGeometryStore(directory).Read("element", Capture);
            Assert.That(captures, Is.EqualTo(1), "A second operation reads geometry without extraction.");
            Assert.That(second.Rows, Is.EqualTo(first.Rows));
            Assert.That(second.Triangles[0].B, Is.EqualTo(new Vector3(2, 0, 0)));
            var file = Directory.GetFiles(directory, "*.pack").Single();
            File.WriteAllBytes(file, [1, 2, 3]);
            store.Read("element", Capture);
            Assert.That(captures, Is.EqualTo(2), "Corrupt entries recapture.");
            File.Delete(file);
            store.Read("element", Capture);
            Assert.That(captures, Is.EqualTo(3), "Missing entries recapture.");
            new LinkedGeometryStore(Path.Combine(directory, "new-generation")).Read("element", Capture);
            Assert.That(captures, Is.EqualTo(4), "Link generations cannot reuse old entries.");
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Test]
    public void GeometryPackReusesOverlappingScopesWithoutOneFilePerElement() {
        var directory = Path.Combine(Path.GetTempPath(), "pe-linked-pack-" + Guid.NewGuid().ToString("N"));
        try {
            var captures = new List<string>();
            LinkedGeometryStore.Geometry Read(LinkedGeometryStore store, string key, long id) => store.Read(key, () => {
                captures.Add(key);
                return Sample(id);
            });
            using (var first = new LinkedGeometryStore(directory).Open()) {
                Read(first, "a/mesh", 1);
                Read(first, "b/mesh", 2);
            }
            using (var overlap = new LinkedGeometryStore(directory).Open()) {
                Assert.That(Read(overlap, "b/mesh", 2).Rows.Single().ElementId, Is.EqualTo(2));
                Read(overlap, "c/mesh", 3);
            }
            using (var repeated = new LinkedGeometryStore(directory).Open()) {
                Read(repeated, "a/mesh", 1);
                Read(repeated, "b/mesh", 2);
                Read(repeated, "c/mesh", 3);
            }
            Assert.That(captures, Is.EqualTo(new[] { "a/mesh", "b/mesh", "c/mesh" }));
            Assert.That(Directory.GetFiles(directory).Select(Path.GetFileName), Is.EqualTo(new[] { "geometry.pack" }));
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Test]
    public void CorruptPackEntryRecapturesWithoutDroppingOtherEntriesAndLatestRecordWins() {
        var directory = Path.Combine(Path.GetTempPath(), "pe-linked-pack-" + Guid.NewGuid().ToString("N"));
        try {
            using (var first = new LinkedGeometryStore(directory).Open()) {
                first.Read("a", () => Sample(1));
                first.Read("b", () => Sample(2));
            }
            var path = Path.Combine(directory, "geometry.pack");
            // Header: pack signature/schema (8), entry key (32), length (4), checksum (32).
            using (var file = new FileStream(path, FileMode.Open, FileAccess.ReadWrite)) {
                file.Position = 8 + 32 + 4 + 32;
                var original = file.ReadByte();
                file.Position--;
                file.WriteByte((byte)(original ^ 1));
            }
            var captures = 0;
            using (var repair = new LinkedGeometryStore(directory).Open()) {
                Assert.That(repair.Read("b", () => throw new InvalidOperationException("Good entry must remain cached")).Rows.Single().ElementId, Is.EqualTo(2));
                var replacement = repair.Read("a", () => { captures++; return Sample(3); });
                Assert.That(replacement.Rows.Single().ElementId, Is.EqualTo(3));
                Assert.That(repair.Read("a", () => throw new InvalidOperationException("Repaired entry must remain cached")).Rows.Single().ElementId, Is.EqualTo(3));
            }
            using (var reopened = new LinkedGeometryStore(directory).Open()) {
                Assert.That(reopened.Read("a", () => throw new InvalidOperationException("Latest duplicate must win after reopening")).Rows.Single().ElementId, Is.EqualTo(3));
                Assert.That(reopened.Read("b", () => throw new InvalidOperationException("Unrelated entry must survive repair")).Rows.Single().ElementId, Is.EqualTo(2));
            }
            Assert.That(captures, Is.EqualTo(1));
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void GeometryPackRecoversOnlyItsCompletePrefixAfterInterruptedAppend(bool truncatePayload) {
        var directory = Path.Combine(Path.GetTempPath(), "pe-linked-pack-" + Guid.NewGuid().ToString("N"));
        try {
            var path = Path.Combine(directory, "geometry.pack");
            using (var first = new LinkedGeometryStore(directory).Open()) first.Read("a", () => Sample(1));
            var prefixLength = new FileInfo(path).Length;
            if (truncatePayload) {
                using (var second = new LinkedGeometryStore(directory).Open()) second.Read("b", () => Sample(2));
                using var file = new FileStream(path, FileMode.Open, FileAccess.Write);
                file.SetLength(file.Length - 1);
            } else {
                using var file = new FileStream(path, FileMode.Append, FileAccess.Write);
                file.Write(new byte[] { 1, 2, 3, 4, 5 }, 0, 5);
            }
            using (var recovered = new LinkedGeometryStore(directory).Open()) {
                Assert.That(new FileInfo(path).Length, Is.EqualTo(prefixLength));
                Assert.That(recovered.Read("a", () => throw new InvalidOperationException("Complete prefix must survive")).Rows.Single().ElementId, Is.EqualTo(1));
                var recaptures = 0;
                recovered.Read("b", () => { recaptures++; return Sample(2); });
                Assert.That(recaptures, Is.EqualTo(1));
            }
            using (var repeated = new LinkedGeometryStore(directory).Open())
                Assert.That(repeated.Read("b", () => throw new InvalidOperationException("Recaptured tail must survive reopening")).Rows.Single().ElementId, Is.EqualTo(2));
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Test]
    public void GeometryPackRejectsAnInvalidRecordLengthBeforeAllocatingItsPayload() {
        var directory = Path.Combine(Path.GetTempPath(), "pe-linked-pack-" + Guid.NewGuid().ToString("N"));
        try {
            var path = Path.Combine(directory, "geometry.pack");
            using (var first = new LinkedGeometryStore(directory).Open()) first.Read("a", () => Sample(1));
            var completeLength = new FileInfo(path).Length;
            using (var file = new FileStream(path, FileMode.Append, FileAccess.Write))
            using (var writer = new BinaryWriter(file)) {
                writer.Write(new byte[32]);
                writer.Write(int.MaxValue);
                writer.Write(new byte[32]);
            }
            using (var recovered = new LinkedGeometryStore(directory).Open()) {
                Assert.That(new FileInfo(path).Length, Is.EqualTo(completeLength));
                Assert.That(recovered.Read("a", () => throw new InvalidOperationException("Valid prefix must survive invalid length")).Rows.Single().ElementId, Is.EqualTo(1));
            }
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private static LinkedGeometryStore.Geometry Sample(long id) => new([
        new PrimRow(0, id, id.ToString(), "Generic Models", PrimKind.Solid, new Aabb(0, 0, 0, 2, 2, 0), 1)
    ], [new Tri { A = Vector3.Zero, B = new Vector3(2, 0, 0), C = new Vector3(0, 2, 0), Prim = 0 }]);

    [Test]
    public void PreparedWorldDoesNotSurviveItsOperation(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var reference = PrepareAndRelease(doc);
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            Assert.That(reference.IsAlive, Is.False, "Global change metadata must not retain World or its native documents and geometry.");
            Assert.That(SpaceView.Status(doc).Built, Is.False, "Status cannot prepare or retain a query world.");
        } finally { doc.Close(false); }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static WeakReference PrepareAndRelease(Document doc) => new(SpaceWorld.Prepare(doc));
}
