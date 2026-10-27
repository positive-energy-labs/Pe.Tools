using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

public sealed class SceneAcquisitionBudgetProofTests {
    [Test]
    public void OutputBudgetStopsAcquisitionBeforeReadingTheRestOfTheScope(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape focus;
            using (var tx = new Transaction(doc, "Create streaming scope")) {
                tx.Start(); focus = Cube(doc, 0);
                for (var i = 1; i <= 40; i++) Cube(doc, i * 2);
                tx.Commit();
            }
            using var output = new MemoryStream();
            var scene = Scene.Write(doc, new SceneRequest([focus.Id.Value()], 100, MaxTriangles: 24, Proximity: true), output);
            Assert.That(scene.Format, Is.EqualTo("space-scene-v2"));
            Assert.That(scene.Elements.Single(row => row.Focus).Handle.ElementId, Is.EqualTo(focus.Id.Value()));
            Assert.That(scene.Triangles, Is.EqualTo(24));
            Assert.That(scene.Work.ExtractedElements, Is.EqualTo(2), "The other39 context elements must never acquire geometry.");
            Assert.That(scene.Completeness.Complete, Is.False);
            Assert.That(scene.Completeness.LimitReason, Is.EqualTo("output-budget"));
            Assert.That(scene.Completeness.DeferredCandidates, Is.GreaterThan(0));
            Assert.That(scene.Work.PeakRetainedTriangles, Is.LessThanOrEqualTo(60));
            using var repeat = new MemoryStream();
            var repeated = Scene.Write(doc, new SceneRequest([focus.Id.Value()], FocusOnly: true), repeat);
            Assert.That(repeated.Work.Memory!.BaselinePrivateBytes, Is.EqualTo(scene.Work.Memory!.BaselinePrivateBytes), "Pressure protection must not rebase each request.");
        } finally { doc.Close(false); }
    }

    [Test]
    public void ExactFocusFailsExplicitlyRatherThanPublishingPartialSelectedGeometry(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape focus;
            using (var tx = new Transaction(doc, "Create focus budget proof")) { tx.Start(); focus = Cube(doc, 0); tx.Commit(); }
            using var output = new MemoryStream();
            var error = Assert.Throws<InvalidOperationException>(() => Scene.Write(doc, new SceneRequest([focus.Id.Value()], MaxTriangles: 1, FocusOnly: true), output));
            Assert.That(error!.Message, Does.Contain("Exact focus acquisition stopped"));
            Assert.That(output.Length, Is.Zero);
        } finally { doc.Close(false); }
    }

    [Test]
    public void FocusBoundsIndexPreservesUnionGapContainmentAndDistance() {
        var boxes = Enumerable.Range(0, 1024).Select(i => new Aabb(i * 5, i % 7, 0, i * 5 + 1, i % 7 + 1, 1)).ToArray();
        var index = new SceneFocusIndex(boxes.ToArray());
        foreach (var i in new[] { 0, 1, 300, 1023 }) {
            var query = new Aabb(i * 5 + 2, i % 7, 0, i * 5 + 3, i % 7 + 1, 1);
            Assert.That(index.DistanceSquared(query), Is.EqualTo(boxes.Min(box => box.DistanceSquared(query))));
            Assert.That(index.Overlaps(query, 0), Is.EqualTo(boxes.Any(box => box.Overlaps(query))));
            Assert.That(index.Overlaps(query, 2), Is.EqualTo(boxes.Any(box => box.Expand(2).Overlaps(query))));
        }
        Assert.That(index.ContainedBy(new Aabb(-1, -1, -1, 2, 2, 2)), Is.True);
        Assert.That(index.ContainedBy(new Aabb(2, 0, 0, 3, 1, 1)), Is.False);
    }

    private static DirectShape Cube(Document doc, double x) {
        var points = new[] { new XYZ(x, 0, 0), new XYZ(x + 1, 0, 0), new XYZ(x + 1, 1, 0), new XYZ(x, 1, 0) };
        using var loop = new CurveLoop();
        for (var i = 0; i < 4; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % 4]));
        var shape = DirectShape.CreateElement(doc, new ElementId(BuiltInCategory.OST_GenericModel));
        using var solid = GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, 1);
        shape.SetShape([solid]); return shape;
    }
}
