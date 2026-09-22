using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>Pixel-to-model registration from synthetic crop transforms (no Revit).</summary>
[TestFixture]
public sealed class ViewImageRegistrationTests {
    private static (RevitViewImageRegistration? Registration, RevitViewImageRegistrationRefusal? Refusal) Try(
        int width, int height, (double, double) min, (double, double) max, (double, double) origin, double degrees
    ) {
        var r = degrees * Math.PI / 180;
        return RevitViewImageRegistration.FromCrop(width, height, "sha", min, max, origin,
            (Math.Cos(r), Math.Sin(r)), (-Math.Sin(r), Math.Cos(r)));
    }

    private static RevitViewImageRegistration Register(
        int width, int height, (double, double) min, (double, double) max, (double, double) origin, double degrees
    ) {
        var (registration, refusal) = Try(width, height, min, max, origin, degrees);
        Assert.That(refusal, Is.Null);
        return registration!;
    }

    [Test]
    public void Unrotated_crop_maps_image_corners_to_crop_corners() {
        var reg = Register(2000, 1000, (0, 0), (100, 50), (10, 20), 0);
        Assert.Multiple(() => {
            Assert.That(reg.TopLeft, Is.EqualTo(new[] { 10d, 70d }).Within(1e-9));
            Assert.That(reg.TopRight, Is.EqualTo(new[] { 110d, 70d }).Within(1e-9));
            Assert.That(reg.BottomLeft, Is.EqualTo(new[] { 10d, 20d }).Within(1e-9));
            Assert.That((reg.Width, reg.Height, reg.ImageSha256), Is.EqualTo((2000, 1000, "sha")));
        });
    }

    [Test]
    public void Quarter_turn_crop_puts_top_edge_along_model_y() {
        var reg = Register(2000, 1000, (0, 0), (100, 50), (10, 20), 90);
        Assert.Multiple(() => {
            Assert.That(reg.TopLeft, Is.EqualTo(new[] { -40d, 20d }).Within(1e-9));
            Assert.That(reg.TopRight, Is.EqualTo(new[] { -40d, 120d }).Within(1e-9));
            Assert.That(reg.BottomLeft, Is.EqualTo(new[] { 10d, 20d }).Within(1e-9));
        });
    }

    [Test]
    public void Oblique_crop_keeps_edge_lengths_and_right_angle_where_min_max_would_not() {
        var reg = Register(1200, 900, (-30, 5), (30, 50), (400, -250), 30);
        double[] top = [reg.TopRight[0] - reg.TopLeft[0], reg.TopRight[1] - reg.TopLeft[1]];
        double[] side = [reg.BottomLeft[0] - reg.TopLeft[0], reg.BottomLeft[1] - reg.TopLeft[1]];
        Assert.Multiple(() => {
            Assert.That(Math.Sqrt(top[0] * top[0] + top[1] * top[1]), Is.EqualTo(60).Within(1e-9));
            Assert.That(Math.Sqrt(side[0] * side[0] + side[1] * side[1]), Is.EqualTo(45).Within(1e-9));
            Assert.That(top[0] * side[0] + top[1] * side[1], Is.EqualTo(0).Within(1e-9));
            Assert.That(Math.Atan2(top[1], top[0]) * 180 / Math.PI, Is.EqualTo(30).Within(1e-9));
            // bottom-left pixel corner = crop (min.X, min.Y) through the 30° transform
            var r = Math.PI / 6;
            Assert.That(reg.BottomLeft, Is.EqualTo(new[] {
                400 + -30 * Math.Cos(r) - 5 * Math.Sin(r), -250 + -30 * Math.Sin(r) + 5 * Math.Cos(r)
            }).Within(1e-9));
        });
    }

    private static IEnumerable<TestCaseData> Refusals() {
        yield return new TestCaseData(2000, 1100, 100d, RevitViewImageRegistrationRefusal.AspectDisagrees).SetName("An image taller than the crop's aspect is refused");
        yield return new TestCaseData(2000, 900, 100d, RevitViewImageRegistrationRefusal.AspectDisagrees).SetName("An image shorter than the crop's aspect is refused");
        yield return new TestCaseData(2000, 1000, 0d, RevitViewImageRegistrationRefusal.DegenerateCrop).SetName("A crop with no width is degenerate");
        yield return new TestCaseData(0, 1000, 100d, RevitViewImageRegistrationRefusal.DegenerateCrop).SetName("An image with no width is degenerate");
    }

    [TestCaseSource(nameof(Refusals))]
    public void Refuses_with_its_reason(int width, int height, double cropWidth, RevitViewImageRegistrationRefusal reason) {
        var (registration, refusal) = Try(width, height, (0, 0), (cropWidth, 50), (0, 0), 0);
        Assert.Multiple(() => {
            Assert.That(registration, Is.Null);
            Assert.That(refusal, Is.EqualTo(reason));
        });
    }

    [Test]
    public void A_one_pixel_rounding_difference_still_registers() => Register(2000, 1001, (0, 0), (100, 50), (0, 0), 0);



    private static RevitCropCoverage Cover(double[][] points, (double, double) min, (double, double) max, (double, double) origin, double degrees) {
        var r = degrees * Math.PI / 180;
        return RevitViewImageRegistration.Coverage(points, min, max, origin, (Math.Cos(r), Math.Sin(r)), (-Math.Sin(r), Math.Cos(r)));
    }

    private static double[][] Box(double x0, double y0, double x1, double y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

    /// <summary>
    ///     D4 leg B item 2: project-a Pool House (0 deg crop x 382.6..466.7, y 785.6..869.5) owns zones C/D, yet all six zones lie in
    ///     x 232.6..438.2, y 570.9..726.2. A region its own view's crop does not contain can never draw under that view's image.
    /// </summary>
    [Test]
    public void A_region_below_the_Pool_House_crop_is_outside_it() =>
        Assert.That(Cover(Box(232.6, 570.9, 438.2, 726.2), (382.646, 785.610), (466.682, 869.451), (0, 0), 0), Is.EqualTo(RevitCropCoverage.Outside));

    [Test]
    public void Coverage_is_read_in_the_crop_frame_not_the_model_box() {
        // 45 deg crop 100 x 50 at origin (500, 800): the model point (500 - 20h, 800) is crop-local (-10, 10), left of its x = 0 edge.
        var h = Math.Sqrt(0.5);
        Assert.Multiple(() => {
            Assert.That(Cover([[500 + 10 * h - 10 * h, 800 + 10 * h + 10 * h]], (0, 0), (100, 50), (500, 800), 45), Is.EqualTo(RevitCropCoverage.Inside));
            Assert.That(Cover([[500 - 20 * h, 800]], (0, 0), (100, 50), (500, 800), 45), Is.EqualTo(RevitCropCoverage.Outside));
            Assert.That(Cover(Box(232.6, 570.9, 438.2, 726.2), (0, 0), (100, 50), (500, 800), 45), Is.EqualTo(RevitCropCoverage.Outside));
            Assert.That(Cover([[500 + 10 * h, 800 + 10 * h], [500 - 50, 800 + 50]], (0, 0), (100, 50), (500, 800), 45), Is.EqualTo(RevitCropCoverage.Crossing));
        });
    }
}
