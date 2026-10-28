using Newtonsoft.Json;
using Pe.Revit.Space;

namespace Pe.Revit.Tests;

public sealed class SpaceScopedVerbProofTests {
    [Test]
    public void ScopedVerbsAnswerAsTheWholeModelAndReadOnlyTheirQuestion(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            long under, over;
            using (var transaction = new Transaction(doc, "Scoped verb shapes")) {
                _ = transaction.Start();
                under = Shape(doc, 0, 0, 0).Id.Value();
                over = Shape(doc, 0, 0, 10).Id.Value();
                _ = Shape(doc, 500, 500, 0);
                _ = transaction.Commit();
            }
            var whole = SpaceWorld.Prepare(doc);
            Assert.That(whole.Partitions[0].Prims.Length, Is.EqualTo(3));

            // A 1 x 0.5 ft profile 1 ft over the lower block: NEAR inside a 1.5 ft clearance.
            XYZ[] line = [new(-2, 0.5, 2.25), new(3, 0.5, 2.25)];
            var sweep = Verbs.Sweep(doc, line, 1, 0.5, 1.5);
            Assert.That(Json(sweep.Segments), Is.EqualTo(Json(Verbs.Sweep(whole, line, 1, 0.5, 1.5).Segments)));
            Assert.That(sweep.Segments.Single().Verdict, Is.EqualTo("NEAR"));
            Assert.That(sweep.Segments.Single().Nearest!.ElementId, Is.EqualTo(under));
            Assert.That(sweep.Stamp.Sources.Single().Elements, Is.EqualTo(1), "Only the lower block lies within the sweep's reach.");

            var at = new XYZ(0.5, 0.5, 5);
            var probe = Verbs.Probe(doc, at);
            Assert.That(Json(new[] { probe.Floor, probe.Ceiling }), Is.EqualTo(Json(new[] { Verbs.Probe(whole, at).Floor, Verbs.Probe(whole, at).Ceiling })));
            Assert.That((probe.Floor!.Handle.ElementId, probe.Ceiling!.Handle.ElementId), Is.EqualTo((under, over)));
            Assert.That(probe.Stamp.Sources.Single().Elements, Is.EqualTo(2), "The far block is never loaded.");

            var clip = new Aabb(-5, -5, 0, 5, 5, 0);
            var slice = Verbs.Slice(doc, 0.25, 0.75, xyClip: clip);
            Assert.That(Json(slice.Elements), Is.EqualTo(Json(Verbs.Slice(whole, 0.25, 0.75, xyClip: clip).Elements)));
            Assert.That(slice.Elements.Select(e => e.Handle.ElementId), Is.EqualTo(new[] { under }));

            var scoped = SpaceWorld.Prepare(doc, Verbs.ProbeScope(clip, 5));
            Assert.Throws<ArgumentException>(() => Verbs.Probe(scoped, new XYZ(500.5, 500.5, 5)),
                "A question outside the read scope must refuse, never answer from geometry it never loaded.");
            Assert.Throws<ArgumentException>(() => Verbs.Slice(scoped, 0.25, 0.75, new Filter(Kinds: [PrimKind.Curve2D]), clip),
                "A world read without CAD ribbons must refuse a Curve2D question.");
        } finally { doc.Close(false); }
    }

    private static string Json(object? value) => JsonConvert.SerializeObject(value);

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
