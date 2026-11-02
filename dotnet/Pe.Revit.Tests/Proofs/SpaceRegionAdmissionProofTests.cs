using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

/// <summary>
///     A Region is admission, never the read (spatial ledger, 2026-11-02): Sweep, Probe and a scene's focus keep their own
///     reach, and every geometry prepare reports its acquisition cost.
/// </summary>
public sealed class SpaceRegionAdmissionProofTests {
    private static readonly Filter Ribbons = new(Kinds: [PrimKind.Curve2D]);

    [Test]
    public void SweepOutsideItsRegionIsRefusedAndInsideItReadsOnlyItsOwnReach(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            long under = Blocks(doc, out _, out _);
            // The region holds both blocks; the sweep's reach holds only the lower one.
            var region = new Region("box", Box: [-5, -5, 0, 5, 5, 12]).Resolve(doc);
            XYZ[] inside = [new(-2, 0.5, 2.25), new(3, 0.5, 2.25)];
            region.AdmitSweep(inside);
            var sweep = Verbs.Sweep(doc, inside, 1, 0.5, 1.5);
            Assert.That(sweep.Segments.Single().Nearest!.ElementId, Is.EqualTo(under));
            Assert.That(sweep.Stamp.Sources.Single().Elements, Is.EqualTo(1), "Region is admission: the upper block inside the region is never read.");

            Assert.Throws<ArgumentException>(() => region.AdmitSweep([new XYZ(-2, 0.5, 2.25), new XYZ(8, 0.5, 2.25)]),
                "A polyline point outside the region is refused.");
            region.AdmitSweep([new XYZ(-5, 0, 0), new XYZ(5, 5, 12)]);
        } finally { doc.Close(false); }
    }

    [Test]
    public void ProbeInsideARegionStillFindsTheFloorAndCeilingPastItsBox(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var floor = Blocks(doc, out var ceiling, out _);
            // The room box sits between the slabs: the floor top is at z 1 and the ceiling underside at z 10, both outside it.
            var region = new Region("box", Box: [-5, -5, 2, 5, 5, 8]).Resolve(doc);
            var at = new XYZ(0.5, 0.5, 5);
            region.AdmitProbe(at);
            var probe = Verbs.Probe(doc, at);
            Assert.That((probe.Floor!.Handle.ElementId, probe.Ceiling!.Handle.ElementId), Is.EqualTo((floor, ceiling)));
            Assert.Throws<ArgumentException>(() => region.AdmitProbe(new XYZ(0.5, 0.5, 9)), "A probe point outside the region is refused.");
        } finally { doc.Close(false); }
    }

    [Test]
    public void Curve2DSweepWorksOnTheVerbsOwnPrepareAndIsRefusedOnARegionPrepare(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            Blocks(doc, out _, out _);
            XYZ[] line = [new(-2, 0.5, 2.25), new(3, 0.5, 2.25)];
            var answer = Verbs.Sweep(doc, line, 1, 0.5, 1.5, Ribbons);
            Assert.That(answer.Segments.Single().Verdict, Is.EqualTo("CLEAR"), "A Curve2D question reads ribbons and answers.");
            var regionWorld = SpaceWorld.Prepare(doc, new Aabb(-5, -5, 0, 5, 5, 12));
            Assert.Throws<ArgumentException>(() => Verbs.Sweep(regionWorld, line, 1, 0.5, 1.5, Ribbons),
                "The defect this replaces: a region-prepared world carries no ribbons and refuses Curve2D.");
        } finally { doc.Close(false); }
    }

    [Test]
    public void SceneRegionIsAdmissionAndFocusKeepsItsOwnReachAndFocusOnly(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var under = Blocks(doc, out var over, out var far);
            var wide = new Region("box", Box: [-5, -5, 0, 5, 5, 12]);

            using var focusBytes = new MemoryStream();
            var focusOnly = Scene.Write(doc, new SceneRequest([under], FocusOnly: true, Region: wide), focusBytes);
            Assert.That(focusOnly.Phase, Is.EqualTo("focus"), "FocusOnly follows the caller even with a region.");
            Assert.That(focusOnly.Elements.Select(e => e.Handle.ElementId), Is.EqualTo(new[] { under }));

            using var contextBytes = new MemoryStream();
            var context = Scene.Write(doc, new SceneRequest([under], 1, Region: wide, ContextRepresentation: SceneContextRepresentation.Meshes), contextBytes);
            Assert.That(context.Elements.Select(e => e.Handle.ElementId), Does.Not.Contain(over),
                "The region does not replace the focus element's effective 5 ft reach: the block 9 ft above it is not context.");

            using var regionOnlyBytes = new MemoryStream();
            var regionOnly = Scene.Write(doc, new SceneRequest(Region: wide, ContextRepresentation: SceneContextRepresentation.Meshes), regionOnlyBytes);
            Assert.That(regionOnly.Elements.Select(e => e.Handle.ElementId), Is.EquivalentTo(new[] { under, over }),
                "With no focus the region box is the question; the far block lies outside it.");
            Assert.That(regionOnly.Elements.Select(e => e.Handle.ElementId), Does.Not.Contain(far));

            using var outsideBytes = new MemoryStream();
            Assert.Throws<ArgumentException>(() => Scene.Write(doc, new SceneRequest([far], FocusOnly: true, Region: wide), outsideBytes),
                "A focus element outside the region is refused.");
        } finally { doc.Close(false); }
    }

    [Test]
    public void DefaultScenePlansFocusAndContextWithoutTessellation(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var first = Blocks(doc, out var second, out _);
            using var bytes = new MemoryStream();
            var scene = Scene.Write(doc, new SceneRequest([first]), bytes);
            Assert.That(scene.Elements.Select(e => e.Handle.ElementId), Does.Contain(second));
            Assert.That(scene.Stamp.GeometryCost!.PlannedCount, Is.EqualTo(2));
            Assert.That(scene.Stamp.GeometryCost.PlannedCost, Is.Zero);
            Assert.That(scene.Stamp.GeometryCost.NewlyTessellatedCount, Is.Zero);
            Assert.That(scene.Stamp.GeometryCost.CumulativeTessellatedCount, Is.Zero);
            Assert.That(scene.Work.NativeGeometryCalls, Is.Zero);
            Assert.That(scene.Triangles, Is.Zero);
        } finally { GeometryLedger.Closed(doc.GetDocumentKey()); doc.Close(false); }
    }

    [Test]
    public void DetailedReadRaisesReachAndRepeatAddsNoTessellatedIds(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var first = Blocks(doc, out _, out _);
            var request = new SceneRequest([first], 2, ContextRepresentation: SceneContextRepresentation.Meshes);
            using var bytes = new MemoryStream();
            var firstRead = Scene.Write(doc, request, bytes);
            Assert.That(firstRead.RequestedContextPaddingFt, Is.EqualTo(2));
            Assert.That(firstRead.EffectiveContextPaddingFt, Is.EqualTo(5));
            Assert.That(firstRead.Stamp.GeometryCost!.NewlyTessellatedCount, Is.GreaterThan(0));
            using var repeat = new MemoryStream();
            var next = Scene.Write(doc, request, repeat);
            Assert.That(next.Stamp.GeometryCost!.NewlyTessellatedCount, Is.Zero);
            Assert.That(next.Stamp.GeometryCost.CumulativeTessellatedCount, Is.EqualTo(firstRead.Stamp.GeometryCost.CumulativeTessellatedCount));
            Assert.That(SpaceWorld.Prepare(doc).GeometryCost!.PlannedCount, Is.GreaterThanOrEqualTo(3));
        } finally { GeometryLedger.Closed(doc.GetDocumentKey()); doc.Close(false); }
    }

    [Test]
    public void CadBelowTheQuestionIsIncludedInThePlan(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".dxf");
        try {
            File.WriteAllText(path, "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n30\n0\n11\n10\n21\n0\n31\n0\n0\nENDSEC\n0\nEOF\n");
            ElementId imported;
            using (var tx = new Transaction(doc, "Import planned CAD")) {
                tx.Start();
                var view = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().First(v => !v.IsTemplate);
                using var options = new DWGImportOptions { ThisViewOnly = false, Unit = ImportUnit.Foot, Placement = ImportPlacement.Origin };
                Assert.That(doc.Import(path, options, view, out imported), Is.True);
                tx.Commit();
            }
            var scope = new Aabb(-1, -1, 4, 11, 1, 5);
            var source = SpaceWorld.SceneSources(doc).Partitions[0];
            var plan = source.WithImports(source.Plan([scope.Corners()], scope.Corners(), obstacles: true), scope);
            Assert.That(plan.Keep, Does.Contain(imported));
            var world = SpaceWorld.Prepare(doc, scope, curves: true);
            Assert.That(world.GeometryCost!.PlannedCount, Is.GreaterThanOrEqualTo(1));
        } finally { GeometryLedger.Closed(doc.GetDocumentKey()); doc.Close(false); File.Delete(path); }
    }

    [Test]
    public void ModifiedFamilyHasFullPlannedCost(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var familyDoc = RevitFamilyFixtureHarness.CreateFamilyDocument(uiApplication.Application, BuiltInCategory.OST_GenericModel, "Cost fixture");
        try {
            using (var tx = new Transaction(familyDoc, "Family block")) {
                tx.Start();
                using var plane = Plane.CreateByNormalAndOrigin(XYZ.BasisZ, XYZ.Zero);
                var sketch = SketchPlane.Create(familyDoc, plane);
                var profile = new CurveArray();
                XYZ[] corners = [XYZ.Zero, new(2, 0, 0), new(2, 2, 0), new(0, 2, 0)];
                for (var i = 0; i < 4; i++) profile.Append(Line.CreateBound(corners[i], corners[(i + 1) % 4]));
                var profiles = new CurveArrArray(); profiles.Append(profile);
                familyDoc.FamilyCreate.NewExtrusion(true, profiles, sketch, 2);
                tx.Commit();
            }
            var family = familyDoc.LoadFamily(doc);
            FamilyInstance first, second;
            using (var tx = new Transaction(doc, "Join family instances")) {
                tx.Start();
                var symbol = (FamilySymbol)doc.GetElement(family.GetFamilySymbolIds().First());
                symbol.Activate(); doc.Regenerate();
                first = doc.Create.NewFamilyInstance(XYZ.Zero, symbol, Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                second = doc.Create.NewFamilyInstance(new XYZ(1, 0, 0), symbol, Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                doc.Regenerate(); JoinGeometryUtils.JoinGeometry(doc, first, second); doc.Regenerate();
                tx.Commit();
            }
            Assert.That(first.HasModifiedGeometry() || second.HasModifiedGeometry(), Is.True);
            var source = SpaceWorld.SceneSources(doc).Partitions[0];
            var plan = ReachPlan.Empty(source) with { Keep = new[] { first.Id, second.Id } };
            var cost = new GeometryLedger.Read([plan]).Report();
            Assert.That(cost.PlannedCost, Is.EqualTo(2));
            Assert.That(cost.PerSource.Single().LoadOnlyCount, Is.Zero);
        } finally { familyDoc.Close(false); GeometryLedger.Closed(doc.GetDocumentKey()); doc.Close(false); }
    }

    /// <summary>A lower block, one 10 ft above it, and one far away; returns the lower block's id.</summary>
    private static long Blocks(Document doc, out long over, out long far) {
        long under;
        using var transaction = new Transaction(doc, "Region admission blocks");
        _ = transaction.Start();
        under = Shape(doc, 0, 0, 0).Id.Value();
        over = Shape(doc, 0, 0, 10).Id.Value();
        far = Shape(doc, 500, 500, 0).Id.Value();
        _ = transaction.Commit();
        return under;
    }

    private static DirectShape Shape(Document document, double x, double y, double z) {
        using var loop = new CurveLoop();
        var points = new[] { new XYZ(x, y, z), new XYZ(x + 1, y, z), new XYZ(x + 1, y + 1, z), new XYZ(x, y + 1, z) };
        for (var i = 0; i < points.Length; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
        using var body = GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, 1);
        var shape = DirectShape.CreateElement(document, new ElementId(BuiltInCategory.OST_GenericModel));
        shape.SetShape([body]);
        return shape;
    }
}
