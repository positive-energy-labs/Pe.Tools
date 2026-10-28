using Pe.Revit.Global.Services.Host;
using Pe.Revit.Loader.Documents;
using Pe.Revit.Space;
using System.IO;

namespace Pe.Revit.Tests;

/// <summary>A group rollback can restore geometry with no changed ids; the production filter must admit it.</summary>
public sealed class SpaceRollbackEpochProofTests {
    [Test]
    public void ProductionTrackerAdvancesEpochAfterEmptyGroupRollback(UIApplication uiApplication) {
        using var tracker = new DocumentTracker(uiApplication);
        DocumentCacheMaintenance.Wire(tracker);
        SpaceWorld.Wire(tracker);
        var changedIds = -1;
        tracker.Changed += (_, change) => changedIds = change.GetAddedElementIds().Count
            + change.GetModifiedElementIds().Count + change.GetDeletedElementIds().Count;
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var directory = Path.Combine(Path.GetTempPath(), "pe-rollback-epoch-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try {
            DirectShape subject;
            using (var transaction = new Transaction(document, "Create rollback witness")) {
                transaction.Start();
                using var loop = new CurveLoop();
                var points = new[] { XYZ.Zero, XYZ.BasisX, new XYZ(1, 1, 0), XYZ.BasisY };
                for (var i = 0; i < points.Length; i++)
                    loop.Append(Line.CreateBound(points[i], points[(i + 1) % points.Length]));
                using var body = GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, 1);
                subject = DirectShape.CreateElement(document, new ElementId(BuiltInCategory.OST_GenericModel));
                subject.SetShape([body]);
                transaction.Commit();
            }
            document.SaveAs(Path.Combine(directory, "host.rvt"));
            var before = Read();
            using (var group = new TransactionGroup(document, "Restore geometry witness")) {
                group.Start();
                var epoch = SpaceWorld.Epoch(document);
                using (var transaction = new Transaction(document, "Move rollback witness")) {
                    transaction.Start();
                    ElementTransformUtils.MoveElement(document, subject.Id, new XYZ(10, 0, 0));
                    transaction.Commit();
                }
                Assert.That(SpaceWorld.Epoch(document), Is.GreaterThan(epoch));
                Assert.That(Read(), Is.Not.EqualTo(before));
                var movedEpoch = SpaceWorld.Epoch(document);
                group.RollBack();
                Assert.That(changedIds, Is.Zero, "Fixture must exercise Revit's empty rollback delta.");
                Assert.That(SpaceWorld.Epoch(document), Is.GreaterThan(movedEpoch),
                    "Dropping the empty rollback event leaves the moved capture's epoch current.");
            }
            Assert.That(Read(), Is.EqualTo(before), "The restored capture must contain the original native geometry.");
            Assert.That(document.IsModified, Is.False);

            byte[] Read() {
                using var output = new MemoryStream();
                Scene.Write(document, new SceneRequest([subject.Id.Value()], FocusOnly: true), output);
                return output.ToArray();
            }
        } finally {
            document.Close(false);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
