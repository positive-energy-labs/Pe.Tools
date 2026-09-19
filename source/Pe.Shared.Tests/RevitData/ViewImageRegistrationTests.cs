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

    /// <summary>Annotation crop ON: the PNG covers the crop grown by each side's offset (model feet) along the crop's own axes.</summary>
    [Test]
    public void Annotation_margins_grow_the_registered_extent_along_the_rotated_crop_axes() {
        var r = Math.PI / 6;
        (double X, double Y) bx = (Math.Cos(r), Math.Sin(r)), by = (-Math.Sin(r), Math.Cos(r));
        // crop 100 x 50 grown by left 8, right 16, bottom 12, top 4 -> 124 x 66
        var (reg, refusal) = RevitViewImageRegistration.FromCrop(1240, 660, "sha", (0, 0), (100, 50), (5, 7), bx, by, (8, 16, 12, 4));
        Assert.That(refusal, Is.Null);
        double[] Model(double x, double y) => [5 + x * bx.X + y * by.X, 7 + x * bx.Y + y * by.Y];
        Assert.Multiple(() => {
            Assert.That(reg!.TopLeft, Is.EqualTo(Model(-8, 54)).Within(1e-9));
            Assert.That(reg.TopRight, Is.EqualTo(Model(116, 54)).Within(1e-9));
            Assert.That(reg.BottomLeft, Is.EqualTo(Model(-8, -12)).Within(1e-9));
        });
    }

    /// <summary>project-a hold 4a: a 249.75 x 110.25 ft crop at 1/8" = 1' with the default 1" annotation offsets (8 ft each side).</summary>
    [Test]
    public void The_annotation_crop_image_registers_and_a_bare_crop_aspect_is_still_refused() {
        (double, double) min = (564.2501485889034, 173.4850035129855), max = (813.9975703951018, 283.73270099436263);
        const double w = 813.9975703951018 - 564.2501485889034 + 16, h = 283.73270099436263 - 173.4850035129855 + 16;
        var height = (int)Math.Round(2000 * h / w);
        Assert.Multiple(() => {
            Assert.That(RevitViewImageRegistration.FromCrop(2000, height, "sha", min, max, (0, 0), (0.7071, 0.7071), (-0.7071, 0.7071), (8, 8, 8, 8)).Refusal, Is.Null);
            Assert.That(RevitViewImageRegistration.FromCrop(2000, height, "sha", min, max, (0, 0), (0.7071, 0.7071), (-0.7071, 0.7071)).Refusal,
                Is.EqualTo(RevitViewImageRegistrationRefusal.AspectDisagrees), "without the margins, today's code refuses the annotation-crop image");
        });
    }
}
