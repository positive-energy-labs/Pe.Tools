using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

/// <summary>Host context cache reuse must preserve native per-body region rejection and its scene budget.</summary>
public sealed class SpaceHostContextCacheProofTests {
    [Test]
    public void CachedCompoundHostKeepsScopedBodiesAndInteriorCacheReuse(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var directory = Path.Combine(Path.GetTempPath(), "pe-host-context-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try {
            DirectShape focus, compound, interior;
            using (var transaction = new Transaction(document, "Create compound host context proof")) {
                transaction.Start();
                focus = Shape(document, (0, 0, 0, 1));
                compound = Shape(document, (-1, -1, -1, 3), (50, 0, 0, 1));
                interior = Shape(document, (3, 0, 0, 1));
                transaction.Commit();
            }
            var request = new SceneRequest([focus.Id.Value()], 4, MaxTriangles: 36);
            using var originalBytes = new MemoryStream();
            var original = Scene.Write(document, request, originalBytes);
            Assert.That(document.IsModified, Is.True, "Dirty baseline must use original native scoped capture.");
            Assert.That(original.Elements.Count, Is.EqualTo(3));
            Assert.That(original.OmittedElements, Is.Zero);
            Assert.That(original.Triangles, Is.EqualTo(36));

            document.SaveAs(Path.Combine(directory, "host.rvt"));
            var generation = SpaceWorld.HostGeneration(document);
            Assert.That(generation, Is.Not.Null);
            using (var warm = new MemoryStream()) {
                var whole = Scene.Write(document, new SceneRequest([compound.Id.Value()], FocusOnly: true), warm);
                Assert.That(whole.Triangles, Is.EqualTo(24), "Prewarm includes both near and remote bodies.");
            }
            using (var cached = LinkedGeometryStore.For(document, null, Transform.Identity, generation!)) {
                var whole = cached!.Read(compound.UniqueId + "/mesh",
                    () => throw new InvalidOperationException("Uncropped compound geometry must already be cached."));
                Assert.That(whole.Triangles.Length, Is.EqualTo(24));
            }
            using var scopedBytes = new MemoryStream();
            var scoped = Scene.Write(document, request, scopedBytes);
            Assert.That(scopedBytes.ToArray(), Is.EqualTo(originalBytes.ToArray()),
                "Cached context must preserve the original scoped triangle payload.");
            Assert.That(scoped.Elements.Select(row => (row.Handle.ElementId, row.VertexCount, row.Bounds)),
                Is.EqualTo(original.Elements.Select(row => (row.Handle.ElementId, row.VertexCount, row.Bounds))));
            Assert.That(scoped.OmittedElements, Is.Zero, "Remote bodies must not consume the interior element's budget.");
            Assert.That(scoped.Elements.Single(row => row.Handle.ElementId == compound.Id.Value()).VertexCount, Is.EqualTo(36));

            // A separate test generation marks one valid cached row so a native fallback cannot mimic a hit.
            var interiorGeneration = "interior-context-proof-" + Guid.NewGuid().ToString("N");
            using (var cached = LinkedGeometryStore.For(document, null, Transform.Identity, interiorGeneration)) {
                var triangles = new List<Tri>();
                var rows = new List<PrimRow>();
                Ingest.Element(interior, 0, 0, triangles, Transform.Identity, rows, false);
                cached!.Read(interior.UniqueId + "/mesh", () => new LinkedGeometryStore.Geometry(
                    rows.Select(row => row with { Category = "cached-interior-proof" }).ToArray(), triangles.ToArray()));
            }
            var partition = new Pe.Revit.Space.Partition(0, document, SourceKind.Host, null, Transform.Identity, interiorGeneration);
            partition.BuildElements([interior], SpaceWorld.Epoch(document), new Aabb(-4, -4, -4, 5, 5, 5));
            Assert.That(partition.Prims.Single().Category, Is.EqualTo("cached-interior-proof"),
                "A fully enclosed native element box retains disk reuse for contextual reads.");
        } finally {
            document.Close(false);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    private static DirectShape Shape(Document document, params (double X, double Y, double Z, double Size)[] blocks) {
        var bodies = new List<GeometryObject>();
        try {
            foreach (var (x, y, z, size) in blocks) {
                using var loop = new CurveLoop();
                var points = new[] { new XYZ(x, y, z), new XYZ(x + size, y, z), new XYZ(x + size, y + size, z), new XYZ(x, y + size, z) };
                for (var i = 0; i < points.Length; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
                bodies.Add(GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, size));
            }
            var shape = DirectShape.CreateElement(document, new ElementId(BuiltInCategory.OST_GenericModel));
            shape.SetShape(bodies);
            return shape;
        } finally { foreach (var body in bodies) body.Dispose(); }
    }
}
