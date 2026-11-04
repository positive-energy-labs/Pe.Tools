using Pe.Revit.Loader.Documents;
using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

/// <summary>Native host close unloads linked geometry without a tracker close event for the link.</summary>
public sealed class SpaceGeometryLedgerLinksProofTests {
    [Test]
    public void HostCloseReleasesLinkedIds(UIApplication uiApplication) => CloseHosts(uiApplication, false);

    [Test]
    public void SharedLinkIdsSurviveUntilTheLastHostCloses(UIApplication uiApplication) => CloseHosts(uiApplication, true);

    private static void CloseHosts(UIApplication uiApplication, bool shared) {
        using var tracker = new DocumentTracker(uiApplication);
        SpaceWorld.Wire(tracker);
        var directory = Path.Combine(Path.GetTempPath(), "pe-ledger-links-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var sourcePath = Path.Combine(directory, "source.rvt");
        var hostPath = Path.Combine(directory, "host.rvt");
        Document? source = null, host = null, other = null;
        var closed = new List<string>();
        tracker.Closed += key => closed.Add(key.Value);
        try {
            source = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
            using (var tx = new Transaction(source, "Create linked ledger witness")) {
                tx.Start();
                using var loop = new CurveLoop();
                XYZ[] points = [XYZ.Zero, XYZ.BasisX, new(1, 1, 0), XYZ.BasisY];
                for (var i = 0; i < points.Length; i++)
                    loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
                using var solid = GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, 1);
                var shape = DirectShape.CreateElement(source, new ElementId(BuiltInCategory.OST_GenericModel));
                shape.SetShape([solid]);
                tx.Commit();
            }
            source.SaveAs(sourcePath);
            source.Close(false);
            source = null;
            host = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
            var link = Link(host);
            var linkKey = link.GetLinkDocument()!.GetDocumentKey();
            var first = Read(host);
            Assert.That(first.NewlyTessellatedCount, Is.GreaterThan(0));
            var retained = GeometryLedger.Snapshot([linkKey]);
            Assert.That(retained, Is.Not.Empty, "The detailed read must actually tessellate linked elements.");
            Assert.That(Read(host).NewlyTessellatedCount, Is.Zero);
            // First save changes the host key after acquisition; close must still release its sources.
            host.SaveAs(hostPath);
            if (shared) {
                other = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
                Assert.That(Link(other).GetLinkDocument()!.GetDocumentKey(), Is.EqualTo(linkKey));
                // No Space read: this host still keeps the shared native source loaded.
            }
            closed.Clear();
            Assert.That(host.Close(false), Is.True);
            host = null;
            Assert.That(closed, Does.Not.Contain(linkKey), "The production tracker excludes linked documents.");
            if (shared) {
                Assert.That(GeometryLedger.Snapshot([linkKey]), Is.EquivalentTo(retained),
                    "Closing one host must preserve the source held by another open host.");
                Read(other!);
                Assert.That(other!.Close(false), Is.True);
                other = null;
            }
            Assert.That(GeometryLedger.Snapshot([linkKey]), Is.Empty,
                "After the last host closes, no linked tessellation ids may survive.");
            host = uiApplication.Application.OpenDocumentFile(hostPath);
            Assert.That(Read(host).NewlyTessellatedCount, Is.GreaterThan(0));
            Assert.That(GeometryLedger.Snapshot([linkKey]), Is.Not.Empty);
        } finally {
            other?.Close(false);
            host?.Close(false);
            source?.Close(false);
            Directory.Delete(directory, true);
        }

        RevitLinkInstance Link(Document document) {
            using var tx = new Transaction(document, "Place ledger witness link");
            tx.Start();
            using var options = new RevitLinkOptions(false);
            using var path = ModelPathUtils.ConvertUserVisiblePathToModelPath(sourcePath);
            var loaded = RevitLinkType.Create(document, path, options);
            var instance = RevitLinkInstance.Create(document, loaded.ElementId);
            tx.Commit();
            return instance;
        }

        static GeometryCost Read(Document document) {
            using var bytes = new MemoryStream();
            var scene = Scene.Write(document, new SceneRequest(Bounds: new Aabb(-2, -2, -2, 3, 3, 3),
                ContextRepresentation: SceneContextRepresentation.Meshes), bytes);
            return scene.Stamp.GeometryCost!;
        }
    }
}
