using Pe.Revit.Takeoff;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Takeoffs;

namespace Pe.Revit.Tests;

/// <summary>
///     D4 leg B item 2 (projectA): zones adopted in Pool House and Guest House lie outside those views' own crops, likely copied
///     there by Duplicate with Detailing. Adoption keeps them (ruling: adopt + flag) and says where each lies against the view's
///     model crop: a duplicated view cropped to 80 x 80 ft around one region owns a copy of the other region outside its crop.
/// </summary>
public sealed class TakeoffOwnerCropProofTests {
    private static List<double[]> Square(double x, double y, double size) =>
        [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];

    [Test]
    public void Adoption_flags_a_duplicated_region_outside_the_views_crop(UIApplication uiApplication) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            ViewPlan duplicate;
            using (var tx = new Transaction(doc, "Seed a view and its duplicate with detailing")) {
                _ = tx.Start();
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
                var source = ViewPlan.Create(doc, planType.Id, level.Id);
                source.Name = "Owner crop source";
                while (TakeoffCarriers.Preflight(doc, TakeoffCarrierStage.Materialization).MissingCarrierGuids.Count > 0)
                    TakeoffCarriers.InitializeNext(doc, TakeoffCarrierStage.Materialization);
                var type = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType)).FirstElementId();
                _ = FilledRegion.Create(doc, type, source.Id, Kernel.ToLoops(Square(40, 0, 20), [], 0));
                _ = FilledRegion.Create(doc, type, source.Id, Kernel.ToLoops(Square(-80, 0, 20), [], 0));
                duplicate = (ViewPlan)doc.GetElement(source.Duplicate(ViewDuplicateOption.WithDetailing));
                duplicate.Name = "Owner crop duplicate";
                var crop = duplicate.CropBox;
                var c = crop.Transform.Inverse.OfPoint(new XYZ(50, 10, 0));
                crop.Min = new XYZ(c.X - 40, c.Y - 40, crop.Min.Z);
                crop.Max = new XYZ(c.X + 40, c.Y + 40, crop.Max.Z);
                duplicate.CropBox = crop;
                duplicate.CropBoxActive = true;
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var owned = new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
                .Where(fr => fr.OwnerViewId == duplicate.Id).ToList();
            Assert.That(owned, Has.Count.EqualTo(2), "precondition: Duplicate with Detailing copies both regions into the duplicate");
            var inside = owned.Single(fr => fr.GetBoundaries()[0].First().GetEndPoint(0).X > 0);
            var outside = owned.Single(fr => fr.GetBoundaries()[0].First().GetEndPoint(0).X < 0);
            var candidates = TakeoffAtlas.CandidateRegions(doc, new TakeoffCandidatesRequest(duplicate.Name));
            Console.WriteLine($"[PE_OWNER_CROP] candidates in the view collector: {string.Join(", ", candidates.Select(r => $"{r.ElementId}={r.OwnerCrop}"))}");

            TakeoffAdoptResult result;
            using (var tx = new Transaction(doc, "Adopt both")) {
                _ = tx.Start();
                result = TakeoffAtlas.AdoptZones(doc, new TakeoffAdoptRequest(duplicate.Name, [
                    new TakeoffAdoptItem(inside.Id.Value(), "Inside", ""),
                    new TakeoffAdoptItem(outside.Id.Value(), "Outside", "")
                ]));
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            Console.WriteLine($"[PE_OWNER_CROP] adopted: {string.Join(", ", result.Adopted.Select(a => $"{a.ElementId}={a.OwnerCrop}"))}");
            Assert.Multiple(() => {
                Assert.That(result.Adopted, Has.Count.EqualTo(2), "adopt + flag: nothing is refused");
                Assert.That(result.Adopted.Single(a => a.ElementId == inside.Id.Value()).OwnerCrop, Is.EqualTo(RevitCropCoverage.Inside));
                Assert.That(result.Adopted.Single(a => a.ElementId == outside.Id.Value()).OwnerCrop, Is.EqualTo(RevitCropCoverage.Outside));
            });
        } finally { doc.Close(false); }
    }
}
