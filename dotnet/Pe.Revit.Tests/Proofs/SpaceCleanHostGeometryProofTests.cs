using Pe.Revit.Loader.Documents;
using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

/// <summary>Saved host geometry can be reused only within a clean native document open lifetime.</summary>
public sealed class SpaceCleanHostGeometryProofTests {
    [Test]
    public void SavedHostReusesDiskGeometryButDirtyTransactionSavedVersionAndReopenStayFresh(UIApplication uiApplication) {
        using var tracker = new DocumentTracker(uiApplication);
        SpaceWorld.Wire(tracker);
        Document? document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var directory = Path.Combine(Path.GetTempPath(), "pe-clean-host-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "host.rvt");
        try {
            DirectShape subject;
            using (var transaction = new Transaction(document, "Create host cache proof geometry")) {
                transaction.Start();
                subject = Cube(document);
                transaction.Commit();
            }
            document.SaveAs(path);
            Assert.That(document.IsModified, Is.False, "Fixture must be saved and clean before reuse.");
            var generation = SpaceWorld.HostGeneration(document);
            Assert.That(generation, Is.Not.Null, "SDK native open identity is required for host reuse.");
            using (var firstStore = LinkedGeometryStore.For(document, null, Transform.Identity, generation!))
                Assert.That(firstStore, Is.Not.Null, "A saved clean host is eligible.");

            var first = ReadScene(document, subject.Id);
            Assert.That(first.Length, Is.GreaterThan(0));
            using (var cached = LinkedGeometryStore.For(document, null, Transform.Identity, generation!)) {
                Assert.That(cached, Is.Not.Null);
                var geometry = cached!.Read(subject.UniqueId + "/mesh",
                    () => throw new InvalidOperationException("Host scene must have populated the shared geometry store."));
                Assert.That(geometry.Triangles.Length, Is.EqualTo(12));
            }
            Assert.That(ReadScene(document, subject.Id), Is.EqualTo(first), "Repeated clean host scopes preserve exact geometry bytes.");
            Assert.That(SpaceWorld.HostGeneration(document), Is.EqualTo(generation), "Link-manifest reconciliation must not alter host generation.");

            // Hold generation fixed so this probe isolates the loaded version component of the store identity.
            var versionGeneration = "host-version-proof-" + Guid.NewGuid().ToString("N");
            var captures = 0;
            LinkedGeometryStore.Geometry Capture() {
                captures++;
                var triangles = new List<Tri>();
                var rows = new List<PrimRow>();
                Ingest.Element(subject, 0, 0, triangles, Transform.Identity, rows, false);
                return new LinkedGeometryStore.Geometry(rows.ToArray(), triangles.ToArray());
            }
            using (var versionStore = LinkedGeometryStore.For(document, null, Transform.Identity, versionGeneration))
                versionStore!.Read("version-proof", Capture);
            using var originalVersion = Document.GetDocumentVersion(document);

            using (var transaction = new Transaction(document, "Host cache cannot reuse inside transaction")) {
                transaction.Start();
                Assert.That(document.IsModifiable, Is.True);
                using var unavailable = LinkedGeometryStore.For(document, null, Transform.Identity, generation!);
                Assert.That(unavailable, Is.Null, "An active transaction disables host reuse even before its first edit.");
                transaction.RollBack();
            }
            using (var transaction = new Transaction(document, "Move saved host proof geometry")) {
                transaction.Start();
                ElementTransformUtils.MoveElement(document, subject.Id, new XYZ(10, 0, 0));
                transaction.Commit();
            }
            Assert.That(document.IsModified, Is.True);
            using (var unavailable = LinkedGeometryStore.For(document, null, Transform.Identity, generation!))
                Assert.That(unavailable, Is.Null, "Unsaved host edits must use current native geometry.");
            Assert.That(SpaceWorld.HostGeneration(document), Is.Not.EqualTo(generation), "A committed edit advances the host epoch.");
            var dirty = ReadScene(document, subject.Id);
            Assert.That(dirty, Is.Not.EqualTo(first));
            using var dirtyVertices = new MemoryStream();
            var dirtyScene = Scene.Write(document, new SceneRequest([subject.Id.Value()], FocusOnly: true), dirtyVertices);
            Assert.That(dirtyScene.Elements.Min(row => row.Bounds.MinX), Is.EqualTo(10).Within(1e-6),
                "The dirty host scene must reflect the current moved body, not saved disk rows.");

            document.Save();
            Assert.That(document.IsModified, Is.False);
            using var changedVersion = Document.GetDocumentVersion(document);
            Assert.That((changedVersion.VersionGUID, changedVersion.NumberOfSaves),
                Is.Not.EqualTo((originalVersion.VersionGUID, originalVersion.NumberOfSaves)));
            using (var versionStore = LinkedGeometryStore.For(document, null, Transform.Identity, versionGeneration)) {
                Assert.That(versionStore, Is.Not.Null);
                var changed = versionStore!.Read("version-proof", Capture);
                Assert.That(changed.Rows.Min(row => row.Box.MinX), Is.EqualTo(10).Within(1e-6));
            }
            Assert.That(captures, Is.EqualTo(2), "A changed saved version cannot reuse old rows even with the same generation.");
            Assert.That(ReadScene(document, subject.Id), Is.EqualTo(dirty), "Saving cannot restore old cached geometry.");

            var beforeClose = SpaceWorld.HostGeneration(document);
            document.Close(false);
            document = null;
            document = uiApplication.Application.OpenDocumentFile(path);
            Assert.That(SpaceWorld.HostGeneration(document), Is.Not.EqualTo(beforeClose),
                "Reopening the same descriptive document key must use a new SDK open identity.");
        } finally {
            document?.Close(false);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    private static byte[] ReadScene(Document document, ElementId element) {
        // Scene.Write's stream is only float32 vertices; Stamp/timing metadata is returned separately.
        using var output = new MemoryStream();
        Scene.Write(document, new SceneRequest([element.Value()], FocusOnly: true), output);
        return output.ToArray();
    }

    private static DirectShape Cube(Document document) {
        using var loop = new CurveLoop();
        var points = new[] { XYZ.Zero, XYZ.BasisX, new XYZ(1, 1, 0), XYZ.BasisY };
        for (var i = 0; i < points.Length; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
        using var body = GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, 1);
        var shape = DirectShape.CreateElement(document, new ElementId(BuiltInCategory.OST_GenericModel));
        shape.SetShape([body]);
        return shape;
    }
}
