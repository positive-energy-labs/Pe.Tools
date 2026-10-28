using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

public sealed class SpaceSceneScopeProofTests {
    [Test]
    public void ProximityTransformsLinkedBoundsAndKeepsSourceIdentity(UIApplication uiApplication) {
        var path = Path.Combine(Path.GetTempPath(), $"proximity-link-{Guid.NewGuid():N}.rvt");
        var source = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        long nearId, farId;
        try {
            using (var transaction = new Transaction(source, "Create linked proximity geometry")) {
                transaction.Start();
                nearId = Cube(source, 100).Id.Value();
                farId = Cube(source, 50).Id.Value();
                transaction.Commit();
            }
            source.SaveAs(path);
        } finally { source.Close(false); }
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape focus;
            RevitLinkInstance link;
            using (var transaction = new Transaction(doc, "Place rotated translated link")) {
                transaction.Start();
                focus = Cube(doc, 0);
                using var options = new RevitLinkOptions(false);
                var loaded = RevitLinkType.Create(doc, ModelPathUtils.ConvertUserVisiblePathToModelPath(path), options);
                link = RevitLinkInstance.Create(doc, loaded.ElementId);
                ElementTransformUtils.RotateElement(doc, link.Id, Line.CreateBound(XYZ.Zero, XYZ.BasisZ), Math.PI / 2);
                ElementTransformUtils.MoveElement(doc, link.Id, new XYZ(0, -98, 0));
                transaction.Commit();
            }
            var links = new[] { link };
            var generation = SpaceWorld.LinkGeneration(doc, links);
            var captures = 0;
            LinkedGeometryStore.Geometry Capture() { captures++; return new([], []); }
            var store = LinkedGeometryStore.For(link.GetLinkDocument()!, link.Id.Value(), link.GetTotalTransform(), generation);
            Assert.That(store, Is.Not.Null, "A clean saved loaded linked snapshot is cacheable.");
            store!.Read("identity-proof", Capture);
            using var bytes = new MemoryStream();
            var scene = Scene.Write(doc, new SceneRequest([focus.Id.Value()], 3, ContextRepresentation: SceneContextRepresentation.Meshes), bytes);
            using var repeated = new MemoryStream();
            Scene.Write(doc, new SceneRequest([focus.Id.Value()], 4, ContextRepresentation: SceneContextRepresentation.Meshes), repeated);
            Assert.That(repeated.ToArray(), Is.EqualTo(bytes.ToArray()), "Coarse context recapture preserves crossing faces across overlapping scopes.");
            using (var transaction = new Transaction(doc, "Edit host without changing link")) {
                transaction.Start();
                Cube(doc, 200);
                transaction.Commit();
            }
            var sameGeneration = SpaceWorld.LinkGeneration(doc, links);
            Assert.That(sameGeneration, Is.EqualTo(generation));
            LinkedGeometryStore.For(link.GetLinkDocument()!, link.Id.Value(), link.GetTotalTransform(), sameGeneration)!
                .Read("identity-proof", Capture);
            Assert.That(captures, Is.EqualTo(1), "Ordinary host edits preserve linked geometry reuse.");
            var linked = scene.Elements.Where(e => e.Handle.LinkInstanceId == link.Id.Value()).ToList();
            Assert.That(linked.Any(e => e.Handle.ElementId == nearId), Is.True);
            Assert.That(linked.Any(e => e.Handle.ElementId == farId), Is.False);
            Assert.That(linked.All(e => !e.Focus), Is.True);
            Assert.That(scene.Elements.Single(e => e.Focus).Handle.ElementId, Is.EqualTo(focus.Id.Value()));
            Assert.That(scene.Sources.Single(s => s.LinkInstanceId == link.Id.Value()).SourceToHost[13], Is.EqualTo(-98).Within(1e-8));
            using (var transaction = new Transaction(doc, "Move linked snapshot")) {
                transaction.Start();
                ElementTransformUtils.MoveElement(doc, link.Id, new XYZ(1, 0, 0));
                transaction.Commit();
            }
            LinkedGeometryStore.For(link.GetLinkDocument()!, link.Id.Value(), link.GetTotalTransform(),
                SpaceWorld.LinkGeneration(doc, links))!.Read("identity-proof", Capture);
            Assert.That(captures, Is.EqualTo(2), "A link placement change cannot read old host-coordinate triangles.");
        } finally {
            doc.Close(false);
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Test]
    public void ProximityKeepsCrossingFacesAndFocusButRejectsTheEnclosingBoxGap(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape first, last, gap, wall, contains;
            ModelCurve line;
            using (var transaction = new Transaction(doc, "Create proximity proof geometry")) {
                transaction.Start();
                first = Cube(doc, 0);
                last = Cube(doc, 100);
                gap = Cube(doc, 50);
                wall = Block(doc, -100, 2, 0, 200, 0.1, 1);
                contains = Block(doc, -20, -20, -20, 40, 40, 40);
                line = doc.Create.NewModelCurve(Line.CreateBound(new XYZ(0, 0, 0), new XYZ(2, 0, 0)),
                    SketchPlane.Create(doc, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, XYZ.Zero)));
                transaction.Commit();
            }
            using var bytes = new MemoryStream();
            var scene = Scene.Write(doc, new SceneRequest([first.Id.Value(), last.Id.Value()], 3, ContextRepresentation: SceneContextRepresentation.Meshes), bytes);
            Assert.That(scene.Elements.Where(e => e.Focus).Select(e => e.Handle.ElementId), Is.EquivalentTo(new[] { first.Id.Value(), last.Id.Value() }));
            Assert.That(scene.Elements.Any(e => e.Handle.ElementId == gap.Id.Value()), Is.False);
            Assert.That(scene.Elements.Any(e => e.Handle.ElementId == wall.Id.Value()), Is.True, "A long triangle's interior crosses the radius although its vertices do not.");
            Assert.That(scene.Elements.Any(e => e.Handle.ElementId == contains.Id.Value()), Is.True, "Containing solids cannot be called empty because their surfaces are far away.");
            Assert.That(scene.Elements.Where(e => e.Focus).Sum(e => e.VertexCount), Is.EqualTo(72));
            var read = scene.Sources.Single().Read!;
            Assert.That(scene.Elements.Any(e => e.Handle.ElementId == line.Id.Value()), Is.False, "A model line is not context.");
            Assert.That(read.Excluded["sketch"], Is.GreaterThanOrEqualTo(1), "The exclusion is counted before iteration, not hidden.");
            Assert.That(read.Counted, Is.GreaterThan(read.Kept));
            using var boxBytes = new MemoryStream();
            var boxes = Scene.Write(doc, new SceneRequest([first.Id.Value(), last.Id.Value()], 3, ContextRepresentation: SceneContextRepresentation.Boxes), boxBytes);
            Assert.That(boxes.Elements.Any(e => e.Handle.ElementId == gap.Id.Value()), Is.False,
                "Boxes read per-element reach too: the gap inside the focus's enclosing crop is never iterated.");
            Assert.That(boxes.Elements.Any(e => e.Handle.ElementId == wall.Id.Value()), Is.True);
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
            var request = new SceneRequest([focus.Id.Value()], 4, ContextRepresentation: SceneContextRepresentation.Meshes);
            using var scopedBytes = new MemoryStream();
            var scoped = Scene.Write(doc, request, scopedBytes);
            var firstWorld = SpaceWorld.Prepare(doc);
            var secondWorld = SpaceWorld.Prepare(doc);
            Assert.That(secondWorld, Is.Not.SameAs(firstWorld), "Geometry belongs to each operation.");
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
            var explicitCrop = Scene.Write(doc, new SceneRequest([focus.Id.Value()], Bounds: new Aabb(1.5, -1, -1, 4, 2, 2), ContextRepresentation: SceneContextRepresentation.Meshes), explicitBytes);
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
