using Pe.Revit.Global.Services.Host;
using Pe.Revit.Space;
using Pe.Shared.HostContracts.Operations;
using System.IO;

namespace Pe.Revit.Tests;

/// <summary>
///     A Region is admission, never the read (spatial ledger, 2026-11-02): Sweep, Probe and a scene's focus keep their own
///     reach, and every geometry prepare is counted by the geometry budget before it loads anything.
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
    public void OversizedReadsAreRefusedBeforeAnyGeometryIsReadWithATypedRefusal(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var ceiling = GeometryBudget.Ceiling;
        try {
            Blocks(doc, out _, out _);
            var wholeModel = new Aabb(-1000, -1000, -1000, 1000, 1000, 1000);
            GeometryBudget.Ceiling = 2;
            var refusal = Assert.Throws<OverBudgetException>(() => SpaceWorld.Prepare(doc, wholeModel));
            Assert.That(refusal!.Count, Is.EqualTo(3), "Three blocks lie in the box; none was loaded to count them.");
            Assert.That(refusal.Cost, Is.EqualTo(3));
            Assert.That(refusal.Ceiling, Is.EqualTo(2));
            Assert.That(refusal.Message, Does.Contain("smaller box"));
            Assert.Throws<OverBudgetException>(() => Verbs.Census(doc, wholeModel), "A verb's own reach is counted too.");

            var typed = Assert.Throws<BridgeOperationException>(() => SpaceOps.Budgeted(() => SpaceWorld.Prepare(doc, wholeModel)));
            Assert.That(typed!.Issues.Single().Code, Is.EqualTo("OverBudget"));
            Assert.That(typed.Issues.Single().InstancePath, Is.EqualTo("$"));

            using var bytes = new MemoryStream();
            Assert.Throws<OverBudgetException>(() => Scene.Write(doc, new SceneRequest(Bounds: wholeModel, ContextRepresentation: SceneContextRepresentation.Meshes), bytes));

            GeometryBudget.Ceiling = 3;
            Assert.That(SpaceWorld.Prepare(doc, wholeModel).Partitions[0].Prims.Length, Is.EqualTo(3), "At the ceiling the read proceeds.");
        } finally {
            GeometryBudget.Ceiling = ceiling;
            doc.Close(false);
        }
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
                "The region does not replace the focus element's own 1 ft reach: the block 9 ft above it is not context.");

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
