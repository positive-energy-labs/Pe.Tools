using Pe.Revit.Space;

namespace Pe.Revit.Tests;

/// <summary>Native witnesses for PI-P1: an unread placement and absent surfaces never certify clearance.</summary>
public sealed class SpaceCoverageProofTests {
    [Test]
    public void Contained_profile_without_a_surface_witness_reports_unknown(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            using (var transaction = new Transaction(document, "Closed box around sweep")) {
                transaction.Start();
                Block(document, 0, 20);
                transaction.Commit();
            }
            var answer = Verbs.Sweep(document, [new XYZ(8, 10, 10), new XYZ(12, 10, 10)], 1, 1, 1);
            var segment = answer.Segments.Single();
            Assert.Multiple(() => {
                Assert.That(answer.Evidence.Acquisition.Single().Outcome, Is.EqualTo(AcquisitionOutcome.Acquired));
                Assert.That(answer.Evidence.Coverage, Is.Empty);
                Assert.That(segment.Verdict, Is.EqualTo("UNKNOWN"));
                Assert.That(segment.MinGapFt, Is.Null);
                Assert.That(segment.SurfaceObservation, Is.EqualTo("none-observed"));
                Assert.That(segment.ClearanceReason, Is.EqualTo("containment-unsupported"));
            });
            var witness = Verbs.Sweep(document, [new XYZ(-2, 10, 10), new XYZ(2, 10, 10)], 1, 1, 1).Segments.Single();
            Assert.That(witness.Nearest, Is.Not.Null);
            Assert.That(witness.MinGapFt, Is.Not.Null);
            Assert.That(witness.SurfaceObservation, Is.EqualTo("observed"));
        } finally { document.Close(false); }
    }

    [Test]
    public void Qualified_exclusion_keeps_both_link_placements_and_unread_sources(UIApplication uiApplication) {
        var path = Path.Combine(Path.GetTempPath(), "evidence-placement-" + Guid.NewGuid().ToString("N") + ".rvt");
        var source = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            using (var transaction = new Transaction(source, "Link obstacle")) {
                transaction.Start(); Block(source, 0, 2); transaction.Commit();
            }
            source.SaveAs(path);
        } finally { source.Close(false); }
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            DirectShape host;
            RevitLinkInstance first, second;
            ElementId type;
            using (var transaction = new Transaction(document, "Host and two transformed placements")) {
                transaction.Start();
                host = Block(document, 0, 2);
                using var options = new RevitLinkOptions(false);
                type = RevitLinkType.Create(document, ModelPathUtils.ConvertUserVisiblePathToModelPath(path), options).ElementId;
                first = RevitLinkInstance.Create(document, type);
                second = RevitLinkInstance.Create(document, type);
                ElementTransformUtils.MoveElement(document, second.Id, new XYZ(4, 0, 0));
                transaction.Commit();
            }
            var filter = new Filter(Exclusions: [new(document.GetDocumentKey(), new(document.GetDocumentKey(), null), host.UniqueId)]);
            var census = Verbs.Census(document, new Aabb(-1, -1, -1, 8, 4, 4), filter);
            Assert.That(census.Top.Select(t => t.Handle.LinkInstanceUniqueId), Is.EquivalentTo(new[] { first.UniqueId, second.UniqueId }));
            Assert.That(census.Evidence.Sources.Count, Is.EqualTo(3));
            Assert.That(census.Evidence.Resolved.Exclusions.Single().SubjectUniqueId, Is.EqualTo(host.UniqueId));
            ((RevitLinkType)document.GetElement(type)).Unload(null);
            var unread = Verbs.Census(document, new Aabb(-1, -1, -1, 8, 4, 4));
            var status = SpaceView.Status(document);
            Assert.That(unread.Evidence.Sources.Where(s => s.Availability != SceneSourceState.Loaded).Select(s => s.Placement.LinkUniqueId),
                Is.EquivalentTo(new[] { first.UniqueId, second.UniqueId }));
            Assert.That(unread.Evidence.Coverage.Count(g => g.Reason == CoverageReason.SourceUnread), Is.EqualTo(2));
            Assert.That(status.Evidence.SameSources(unread.Evidence), Is.True);
            Assert.That(status.Evidence.Resolved.AcquisitionRequested, Is.False);
        } finally {
            document.Close(false);
            if (File.Exists(path)) File.Delete(path);
        }
    }

    private static DirectShape Block(Document document, double x, double size) {
        using var loop = new CurveLoop();
        XYZ[] points = [new(x, 0, 0), new(x + size, 0, 0), new(x + size, size, 0), new(x, size, 0)];
        for (var i = 0; i < points.Length; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
        using var solid = GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, size);
        var shape = DirectShape.CreateElement(document, new ElementId(BuiltInCategory.OST_GenericModel));
        shape.SetShape([solid]);
        return shape;
    }
}
