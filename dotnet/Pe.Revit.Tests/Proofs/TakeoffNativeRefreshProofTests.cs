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
        try
        {
            ViewPlan view;
            FilledRegion zone;
            Guid zoneGuid;
            using (var tx = new Transaction(doc, "Seed owned takeoff zone"))
            {
                tx.Start();
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
                view = ViewPlan.Create(doc, planType.Id, level.Id);
                view.Name = "Native refresh proof";
                while (TakeoffCarriers.Preflight(doc, TakeoffCarrierStage.Materialization).MissingCarrierGuids.Count > 0)
                    TakeoffCarriers.InitializeNext(doc, TakeoffCarrierStage.Materialization);
                var type = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType)).FirstElementId();
                zone = FilledRegion.Create(doc, type, view.Id, [Kernel.ToLoop(Square(0, 0, 30), 0)]);
                zoneGuid = Guid.NewGuid();
                TakeoffCarriers.WriteIdentity(zone, TakeoffCarriers.RoleZoningRegion, zoneGuid);
                TakeoffCarriers.WriteProvenance(zone,
                    TakeoffJson.Serialize(new TakeoffZoneProvenance(1, view.Name, "Zone", "")));
                ZoneMaterializer.Materialize(doc, view, 0, zoneGuid, "original",
                    [new RoomResult { Id = "R01", RawSqft = 100, LabelX = 10, LabelY = 10,
                        Polygon = Square(5, 5, 10) }], [], _ => { });
                tx.Commit();
            }
            Pe.Revit.Space.SpaceWorld.Prepare(doc);
            using (var tx = new Transaction(doc, "Measure native baseline"))
            {
                tx.Start();
                RegionMeasurements.Measure(doc, view, zoneGuid, "measurement-1");
                tx.Commit();
            }
            var before = TakeoffAtlas.Snapshot(doc).RegionsByZone[zoneGuid.ToString("D")].Single();
            Assert.That(before.Analysis!.State, Is.EqualTo("current"));
            using (var tx = new Transaction(doc, "Native edit with unchanged area"))
            {
                tx.Start();
                ElementTransformUtils.MoveElement(doc, before.ElementId.ToElementId(), new XYZ(1, 0, 0));
                view.Name = "Renamed proof view";
                tx.Commit();
            }
            var edited = TakeoffAtlas.Snapshot(doc).RegionsByZone[zoneGuid.ToString("D")].Single();
            Assert.That(edited.Guid, Is.EqualTo(before.Guid));
            Assert.That(edited.Sqft, Is.EqualTo(before.Sqft));
            Assert.That(edited.Analysis!.State, Is.EqualTo("stale"));
            var geometry = TakeoffJson.Serialize(edited.Outer);
            using (var tx = new Transaction(doc, "Rerun without overwriting native geometry"))
            {
                tx.Start();
                TakeoffAtlas.Partition(doc, new(zone.Id.Value(), view.Name, "Zone", zoneGuid, "measurement-2"));
                tx.Commit();
            }
            var after = TakeoffAtlas.Snapshot(doc).RegionsByZone[zoneGuid.ToString("D")].Single();
            Assert.That(after.ElementId, Is.EqualTo(before.ElementId));
            Assert.That(after.Guid, Is.EqualTo(before.Guid));
            Assert.That(TakeoffJson.Serialize(after.Outer), Is.EqualTo(geometry));
            Assert.That(after.Analysis!.State, Is.EqualTo("current"));
            Assert.That(after.Analysis.RunId, Is.EqualTo("measurement-2"));
            Assert.That(RegionProvenance.FromJson(after.Blob).RunId, Is.EqualTo("original"));
        }
        finally { doc.Close(false); }
    }
}
