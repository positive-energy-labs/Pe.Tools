using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

public sealed class SpaceSceneScopeProofTests {
    [Test]
    public void ProximityKeepsCrossingFacesAndFocusButRejectsTheEnclosingBoxGap(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape first, last, gap, wall, contains;
            using (var transaction = new Transaction(doc, "Create proximity proof geometry")) {
                transaction.Start();
                first = Cube(doc, 0);
                last = Cube(doc, 100);
                gap = Cube(doc, 50);
                wall = Block(doc, -100, 2, 0, 200, 0.1, 1);
                contains = Block(doc, -20, -20, -20, 40, 40, 40);
                transaction.Commit();
            }
            using var bytes = new MemoryStream();
            var scene = Scene.Write(doc, new SceneRequest([first.Id.Value(), last.Id.Value()], 3, Proximity: true), bytes);
            Assert.That(scene.Elements.Where(e => e.Focus).Select(e => e.Handle.ElementId), Is.EquivalentTo(new[] { first.Id.Value(), last.Id.Value() }));
            Assert.That(scene.Elements.Any(e => e.Handle.ElementId == gap.Id.Value()), Is.False);
            Assert.That(scene.Elements.Any(e => e.Handle.ElementId == wall.Id.Value()), Is.True, "A long triangle's interior crosses the radius although its vertices do not.");
            Assert.That(scene.Elements.Any(e => e.Handle.ElementId == contains.Id.Value()), Is.True, "Containing solids cannot be called empty because their surfaces are far away.");
            Assert.That(scene.Elements.Where(e => e.Focus).Sum(e => e.VertexCount), Is.EqualTo(72));
            using var oldBytes = new MemoryStream();
            var old = Scene.Write(doc, new SceneRequest([first.Id.Value(), last.Id.Value()], 3), oldBytes);
            Assert.That(old.Elements.Any(e => e.Handle.ElementId == gap.Id.Value()), Is.True);
        } finally { doc.Close(false); }
    }

    private static DirectShape Block(Document doc, double x, double y, double z, double length, double width, double height) {
        var points = new[] { new XYZ(x, y, z), new XYZ(x + length, y, z), new XYZ(x + length, y + width, z), new XYZ(x, y + width, z) };
        var loop = new CurveLoop();
        for (var i = 0; i < points.Length; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
        var shape = DirectShape.CreateElement(doc, new ElementId(BuiltInCategory.OST_GenericModel));
        shape.SetShape([GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, height)]);
        return shape;
    }

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
