using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

public sealed class SpaceSceneScopeProofTests {
    [Test]
    public void BoundedScenePreservesMeshesWithoutPreparingQueryWorld(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape focus;
            DirectShape context;
            using (var transaction = new Transaction(doc, "Create scoped scene proof geometry")) {
                transaction.Start();
                focus = Cube(doc, 0);
                context = Cube(doc, 2);
                _ = Cube(doc, 100);
                transaction.Commit();
            }
            var request = new SceneRequest([focus.Id.Value()], 4);
            using var scopedBytes = new MemoryStream();
            var scoped = Scene.Write(doc, request, scopedBytes);
            Assert.That(SpaceWorld.Resident(doc).BuiltUtc, Is.EqualTo(default(DateTime)),
                "First bounded capture must not ingest the query world.");
            Assert.That(scoped.Elements.Select(e => e.Handle.ElementId),
                Is.EquivalentTo(new[] { focus.Id.Value(), context.Id.Value() }));
            Assert.That(scoped.Stamp.Fresh, Is.True);
            Assert.That(scoped.Triangles, Is.EqualTo(24));

            using var focusBytes = new MemoryStream();
            var focusScene = Scene.Write(doc, new SceneRequest([focus.Id.Value(), long.MaxValue], FocusOnly: true), focusBytes);
            Assert.That(focusScene.Phase, Is.EqualTo("focus"));
            Assert.That(focusScene.Elements.Single().Handle.ElementId, Is.EqualTo(focus.Id.Value()));
            Assert.That(focusScene.Triangles, Is.EqualTo(12));
            Assert.That(focusScene.RequestedElementIds, Does.Contain(long.MaxValue));
            Assert.That(focusScene.UnavailableElements.Single().ElementId, Is.EqualTo(long.MaxValue));
            Assert.That(SpaceWorld.Resident(doc).BuiltUtc, Is.EqualTo(default(DateTime)));

            SpaceWorld.Prepare(doc);
            using var worldBytes = new MemoryStream();
            var fromWorld = Scene.Write(doc, request, worldBytes);
            Assert.That(worldBytes.ToArray(), Is.EqualTo(scopedBytes.ToArray()));
            Assert.That(fromWorld.Elements, Is.EqualTo(scoped.Elements));

            using (var undo = new TransactionGroup(doc, "Undo scene proof edit")) {
                undo.Start();
                using (var transaction = new Transaction(doc, "Move context out of crop")) {
                    transaction.Start();
                    ElementTransformUtils.MoveElement(doc, context.Id, new XYZ(100, 0, 0));
                    transaction.Commit();
                }
                using var editedBytes = new MemoryStream();
                var edited = Scene.Write(doc, request, editedBytes);
                Assert.That(edited.Elements.Any(e => e.Handle.ElementId == context.Id.Value()), Is.False);
                Assert.That(edited.Triangles, Is.EqualTo(12));
                undo.RollBack();
            }
            using var restoredBytes = new MemoryStream();
            Scene.Write(doc, request, restoredBytes);
            Assert.That(restoredBytes.ToArray(), Is.EqualTo(scopedBytes.ToArray()));
            using var explicitBytes = new MemoryStream();
            var explicitCrop = Scene.Write(doc, new SceneRequest([focus.Id.Value()], Bounds: new Aabb(1.5, -1, -1, 4, 2, 2)), explicitBytes);
            Assert.That(explicitCrop.Elements.Single().Handle.ElementId, Is.EqualTo(context.Id.Value()));
            Assert.That(explicitCrop.Elements.Single().Focus, Is.False);
        } finally {
            doc.Close(false);
        }
    }

    private static DirectShape Cube(Document doc, double x) {
        var points = new[] { new XYZ(x, 0, 0), new XYZ(x + 1, 0, 0), new XYZ(x + 1, 1, 0), new XYZ(x, 1, 0) };
        var loop = new CurveLoop();
        for (var i = 0; i < points.Length; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
        var shape = DirectShape.CreateElement(doc, new ElementId(BuiltInCategory.OST_GenericModel));
        shape.SetShape([GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, 1)]);
        return shape;
    }
}
