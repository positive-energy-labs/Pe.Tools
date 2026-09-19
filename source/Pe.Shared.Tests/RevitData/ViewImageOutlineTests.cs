using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     A plain ExportImage (FitToPage) of a cropped plan covers View.Outline (paper) x Scale in the crop box's own frame, not the crop.
///     PROVEN[session, projectA, e696ff6], `probe-lines.txt` of the project-a probe hold: the four views below, their recorded numbers verbatim.
/// </summary>
[TestFixture]
public sealed class ViewImageOutlineTests {
    public sealed record ProjectAView(
        string Name, int PngWidth, int PngHeight, double Scale,
        (double X, double Y) OutlineMin, (double X, double Y) OutlineMax,
        (double X, double Y) CropMin, (double X, double Y) CropMax,
        (double X, double Y) Origin, (double X, double Y) BasisX, (double X, double Y) BasisY) {
        public override string ToString() => this.Name;
    }

    private static readonly ProjectAView LowerLevel = new("Lower Level (45°, 1:192)", 1500, 682, 192,
        (2.93880, 0.88572), (4.23957, 1.47777), (564.250, 173.485), (813.998, 283.733), (0, 0), (0.7071, 0.7071), (-0.7071, 0.7071));
    private static readonly ProjectAView PoolHouse = new("Pool House (0°)", 1500, 2171, 96,
        (3.54587, -2.53140), (11.55172, 9.05678), (382.646, 785.610), (466.682, 869.451), (0, 0), (1, 0), (0, 1));
    private static readonly ProjectAView Gatehouse = new("Gatehouse (10.684°)", 1500, 1507, 96,
        (3.02151, -3.95294), (12.83512, 5.90932), (808.874, 139.938), (885.020, 231.254), (0, 0), (0.9827, 0.1854), (-0.1854, 0.9827));
    private static readonly ProjectAView GuestHouse = new("Guest House (45°)", 1500, 780, 96,
        (5.16604, 8.19984), (6.45771, 8.87171), (495.940, 787.184), (619.940, 851.684), (746.002, -153.816), (0.7071, 0.7071), (-0.7071, 0.7071));

    private static IEnumerable<ProjectAView> Views() => [LowerLevel, PoolHouse, Gatehouse, GuestHouse];

    private static (RevitViewImagePixelRect? Rect, RevitViewImageRegistrationRefusal? Refusal) Cut(ProjectAView v) =>
        RevitViewImageRegistration.CropPixels(v.PngWidth, v.PngHeight, v.OutlineMin, v.OutlineMax, v.Scale, v.CropMin, v.CropMax);

    [TestCaseSource(nameof(Views))]
    public void The_outline_predicts_each_plain_export_and_places_the_crop_in_it(ProjectAView view) {
        var (rect, refusal) = Cut(view);
        Assert.That(refusal, Is.Null, "the plain PNG's aspect is the outline's, within the gate");
        // The cut is exactly the crop: it registers against the crop box, which the plain PNG (except Guest House's) does not.
        var (registration, cropRefusal) = RevitViewImageRegistration.FromCrop(rect!.Width, rect.Height, "sha", view.CropMin, view.CropMax,
            view.Origin, view.BasisX, view.BasisY);
        Assert.That(cropRefusal, Is.Null);
        Assert.That(registration, Is.Not.Null);
    }

    [TestCase("Lower Level (45°, 1:192)")]
    [TestCase("Pool House (0°)")]
    [TestCase("Gatehouse (10.684°)")]
    public void The_crop_box_alone_does_not_predict_the_plain_export(string name) {
        var v = Views().Single(view => view.Name == name);
        Assert.That(RevitViewImageRegistration.FromCrop(v.PngWidth, v.PngHeight, "sha", v.CropMin, v.CropMax, v.Origin, v.BasisX, v.BasisY).Refusal,
            Is.EqualTo(RevitViewImageRegistrationRefusal.AspectDisagrees), "the precondition: registering the whole PNG against the crop is wrong here");
    }

    [Test]
    public void Crop_pixel_rectangles_follow_from_the_outline() {
        Assert.Multiple(() => {
            Assert.That(Cut(LowerLevel).Rect, Is.EqualTo(new RevitViewImagePixelRect(0, 0, 1500, 661)), "y past the crop on the bottom only");
            Assert.That(Cut(PoolHouse).Rect, Is.EqualTo(new RevitViewImagePixelRect(82, 0, 164, 164)), "11% of the outline's width");
            Assert.That(Cut(Gatehouse).Rect, Is.EqualTo(new RevitViewImagePixelRect(826, 535, 121, 145)));
            Assert.That(Cut(GuestHouse).Rect, Is.EqualTo(new RevitViewImagePixelRect(0, 0, 1500, 780)), "outline == crop");
        });
    }

    // Guest House: outline x 96 == CropBox Min..Max, so its registration is the crop's corners through the transform, the product quad of the hold.
    [Test]
    public void Guest_House_registers_to_its_crop_box_corners_through_the_transform() {
        var rect = Cut(GuestHouse).Rect!;
        var reg = RevitViewImageRegistration.FromCrop(rect.Width, rect.Height, "sha", GuestHouse.CropMin, GuestHouse.CropMax,
            GuestHouse.Origin, GuestHouse.BasisX, GuestHouse.BasisY).Registration!;
        Assert.Multiple(() => {
            Assert.That(reg.TopLeft, Is.EqualTo(new[] { 494.453, 799.098 }).Within(0.01));
            Assert.That(reg.TopRight, Is.EqualTo(new[] { 582.134, 886.779 }).Within(0.01));
            Assert.That(reg.BottomLeft, Is.EqualTo(new[] { 540.061, 753.490 }).Within(0.01));
        });
    }

    [Test]
    public void An_export_that_is_not_the_outlines_aspect_or_misses_the_crop_is_refused_by_name() {
        Assert.Multiple(() => {
            Assert.That(RevitViewImageRegistration.CropPixels(1500, 900, PoolHouse.OutlineMin, PoolHouse.OutlineMax, PoolHouse.Scale, PoolHouse.CropMin, PoolHouse.CropMax).Refusal,
                Is.EqualTo(RevitViewImageRegistrationRefusal.AspectDisagrees));
            Assert.That(RevitViewImageRegistration.CropPixels(1500, 2171, PoolHouse.OutlineMin, PoolHouse.OutlineMax, PoolHouse.Scale, (1200, 0), (1300, 100)).Refusal,
                Is.EqualTo(RevitViewImageRegistrationRefusal.CropOutsideImage));
        });
    }

    // The requested width is the crop's: a crop that is a small part of the outline exports wider, up to the 8000 px cap.
    [Test]
    public void The_export_width_gives_the_crop_the_requested_pixels_up_to_the_cap() {
        Assert.Multiple(() => {
            Assert.That(RevitViewImageRegistration.ExportWidth(1500, GuestHouse.OutlineMin, GuestHouse.OutlineMax, GuestHouse.Scale, GuestHouse.CropMin, GuestHouse.CropMax), Is.EqualTo(1500));
            Assert.That(RevitViewImageRegistration.ExportWidth(1500, Gatehouse.OutlineMin, Gatehouse.OutlineMax, Gatehouse.Scale, Gatehouse.CropMin, Gatehouse.CropMax), Is.EqualTo(8000));
            Assert.That(RevitViewImageRegistration.ExportWidth(600, LowerLevel.OutlineMin, LowerLevel.OutlineMax, LowerLevel.Scale, LowerLevel.CropMin, LowerLevel.CropMax), Is.EqualTo(600));
        });
    }
}
