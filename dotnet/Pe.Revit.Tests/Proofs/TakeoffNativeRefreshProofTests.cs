using System.IO;
using Pe.Revit.Takeoff;
using Pe.Shared.RevitData.Takeoffs;

namespace Pe.Revit.Tests;

public sealed class TakeoffNativeRefreshProofTests
{
    private static List<double[]> Square(double x, double y, double size) =>
        [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];

    [Test]
    public void NativeEditRefreshAndRerunPreserveIdentityAndGeometry(UIApplication uiApplication)
    {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var scratch = Directory.CreateTempSubdirectory("pe-takeoff-refresh-");
        try
        {
            _ = RevitFamilyFixtureHarness.SaveDocumentCopy(doc, scratch.FullName, "refresh-proof");
            ViewPlan view;
            FilledRegion zone;
            string zoneUniqueId;
            using (var tx = new Transaction(doc, "Seed owned takeoff zone"))
            {
                tx.Start();
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
                view = ViewPlan.Create(doc, planType.Id, level.Id);
                view.Name = "Native refresh proof";
                var type = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType)).FirstElementId();
                zone = FilledRegion.Create(doc, type, view.Id, Kernel.ToLoops(Square(0, 0, 30), [], 0));
                zoneUniqueId = zone.UniqueId;
                var record = RoomsRegionRecord.Stage(doc);
                record.Regions.Add(zoneUniqueId, new(TakeoffRecords.RoleZoningRegion, new(), RegionProvenance.Default));
                ZoneMaterializer.Materialize(doc, view, record, 0, zoneUniqueId, "original",
                    [new RoomResult { Id = "R01", RawSqft = 100, LabelX = 10, LabelY = 10,
                        Polygon = Square(5, 5, 10) }], [], _ => { });
                record.Save(doc);
                tx.Commit();
            }
            // Keep both measurements on the same native operation path as the installed add-in.
            TakeoffLiveRegion Read() => TakeoffNativeFixtureRecorder.Invoke<TakeoffSnapshotResponse>(
                "GetTakeoffSnapshotCore", doc, new TakeoffReadRequest(ZoneUniqueIds: [zoneUniqueId]))
                .Snapshot.RegionsByZone[zoneUniqueId].Single();
            void Rerun(string runId) => _ = TakeoffNativeFixtureRecorder.Invoke<TakeoffPartitionResult>(
                "PartitionTakeoffCore", doc, new TakeoffPartitionRequest(zone.Id.Value(), view.UniqueId, "Zone", zoneUniqueId, runId));

            Rerun("measurement-1");
            var before = Read();
            Assert.That(before.Analysis!.State, Is.EqualTo("current"));
            using (var tx = new Transaction(doc, "Native edit with unchanged area"))
            {
                tx.Start();
                ElementTransformUtils.MoveElement(doc, before.ElementId.ToElementId(), new XYZ(1, 0, 0));
                view.Name = "Renamed proof view";
                tx.Commit();
            }
            var edited = Read();
            Assert.That(edited.UniqueId, Is.EqualTo(before.UniqueId));
            Assert.That(edited.Sqft, Is.EqualTo(before.Sqft));
            Assert.That(edited.Analysis!.State, Is.EqualTo("stale"));
            var geometry = TakeoffJson.Serialize(edited.Outer);
            Rerun("measurement-2");
            var after = Read();
            Assert.That(after.ElementId, Is.EqualTo(before.ElementId));
            Assert.That(after.UniqueId, Is.EqualTo(before.UniqueId));
            Assert.That(TakeoffJson.Serialize(after.Outer), Is.EqualTo(geometry));
            Assert.That(after.Analysis!.State, Is.EqualTo("current"));
            Assert.That(after.Analysis.RunId, Is.EqualTo("measurement-2"));
            Assert.That(RegionProvenance.FromJson(after.Blob).RunId, Is.EqualTo("original"));
        }
        finally {
            RevitFamilyFixtureHarness.CloseDocument(doc);
            scratch.Delete(true);
        }
    }
}
