using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Pe.Revit.DocumentData.AgentContext;

namespace Pe.Revit.Tests;

/// <summary>
///     D4 (hold 4a, projectA: rotated crop + annotation crop ON refused AspectDisagrees): the registration must place model points
///     where the exported PNG draws them. A plan with a crop rotated ~30° and two detail-line crosses; each cross's drawn centroid
///     must land within 2 px of its registered position. Annotation crop ON uses asymmetric offsets so a side or axis mix-up shows.
///     `[PE_VIEW_IMAGE_EXTENT]` prints the image size against the model crop and the annotation crop, the diagnosis evidence.
/// </summary>
[TestFixture]
public sealed class ViewImageRegistrationProofTests {
    private const int Scale = 96;
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [TestCase(false)]
    [TestCase(true)]
    public void Registered_model_points_land_on_their_drawn_pixels(bool annotationCrop) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(this._ui.Application);
        try {
            // Far from the template's origin annotations (elevation markers), so the crop holds only the two crosses.
            var center = new XYZ(1000, 1000, 0);
            XYZ[] marks = [center + new XYZ(-30, -8, 0), center + new XYZ(25, 12, 0)];
            ViewPlan view;
            using (var tx = new Transaction(doc, "Seed registration proof")) {
                _ = tx.Start();
                var level = Level.Create(doc, 0);
                var planType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
                view = ViewPlan.Create(doc, planType.Id, level.Id);
                view.ViewTemplateId = ElementId.InvalidElementId;
                view.Scale = Scale;
                foreach (var mark in marks)
                foreach (var arm in new[] { new XYZ(3, 0, 0), new XYZ(0, 3, 0) })
                    _ = doc.Create.NewDetailCurve(view, Line.CreateBound(mark - arm, mark + arm));
                var crop = view.CropBox;
                var toView = crop.Transform.Inverse;
                var c = toView.OfPoint(center);
                crop.Min = new XYZ(c.X - 60, c.Y - 40, crop.Min.Z);
                crop.Max = new XYZ(c.X + 60, c.Y + 40, crop.Max.Z);
                view.CropBox = crop;
                view.CropBoxActive = true;
                view.CropBoxVisible = false;
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            RotateCrop(doc, view, center, Math.PI / 6);
            using (var tx = new Transaction(doc, "Annotation crop")) {
                _ = tx.Start();
                _ = view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE).Set(annotationCrop ? 1 : 0);
                if (annotationCrop) {
                    var shape = view.GetCropRegionShapeManager();
                    // paper feet: 1", 2", 1.5", 0.5" -> 8, 16, 12, 4 model feet at 1/8" = 1'
                    shape.LeftAnnotationCropOffset = 1 / 12.0;
                    shape.RightAnnotationCropOffset = 2 / 12.0;
                    shape.BottomAnnotationCropOffset = 1.5 / 12.0;
                    shape.TopAnnotationCropOffset = 0.5 / 12.0;
                }
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var basis = view.CropBox.Transform.BasisX;
            Assert.That(Math.Abs(Math.Atan2(basis.Y, basis.X)) * 180 / Math.PI, Is.EqualTo(30).Within(0.5), "precondition: the crop is rotated");

            var image = RevitViewImageExporter.Export(doc, view, 1600);
            var (width, height, dark) = DarkPixels(image.FilePath);
            Console.WriteLine($"[PE_VIEW_IMAGE_EXTENT] annotationCrop={annotationCrop} image={width}x{height} " +
                              $"crop={Extent(view.CropBox.Min, view.CropBox.Max)} annotationCropShape={AnnotationShapeExtent(view)} " +
                              $"refusal={image.RegistrationRefusal} file={image.FilePath}");
            Assert.That(image.RegistrationRefusal, Is.Null, "a rotated crop registers with annotation crop on or off");
            var reg = image.Registration!;
            var blobs = Blobs(dark, width, height).OrderByDescending(b => b.Count).Take(2).Select(b => (b.X, b.Y)).ToList();
            Assert.That(blobs, Has.Count.EqualTo(2), "both crosses are drawn");
            foreach (var mark in marks) {
                var expected = Pixel(reg, mark);
                var drawn = blobs.OrderBy(b => Distance(b, expected)).First();
                Console.WriteLine($"[PE_VIEW_IMAGE_EXTENT] mark ({mark.X:F1},{mark.Y:F1}) registered ({expected.X:F1},{expected.Y:F1}) drawn ({drawn.X:F1},{drawn.Y:F1})");
                Assert.That(Distance(drawn, expected), Is.LessThanOrEqualTo(2), $"mark ({mark.X},{mark.Y})");
            }
        } finally { doc.Close(false); }
    }

    /// <summary>Rotate the crop region element; the crop element is the one that appears when the crop box is shown.</summary>
    private static void RotateCrop(Document doc, View view, XYZ center, double angle) {
        ICollection<ElementId> hidden;
        using (var tx = new Transaction(doc, "Find crop element")) {
            _ = tx.Start();
            hidden = new FilteredElementCollector(doc, view.Id).ToElementIds();
            view.CropBoxVisible = true;
            _ = tx.Commit();
        }
        var shown = new FilteredElementCollector(doc, view.Id).ToElementIds().Except(hidden).ToList();
        var crops = shown.Where(id => doc.GetElement(id).Category?.BuiltInCategory == BuiltInCategory.OST_CropBoundary).ToList();
        Assert.That(crops, Has.Count.EqualTo(1), $"one crop element appears with the crop shown; appeared: {string.Join(", ", shown.Select(id => $"{id.Value()} {doc.GetElement(id).Category?.Name}"))}");
        var cropId = crops[0];
        using var rotate = new Transaction(doc, "Rotate crop");
        _ = rotate.Start();
        ElementTransformUtils.RotateElement(doc, cropId, Line.CreateBound(center, center + XYZ.BasisZ), angle);
        view.CropBoxVisible = false;
        Assert.That(rotate.Commit(), Is.EqualTo(TransactionStatus.Committed));
    }

    private static string Extent(XYZ min, XYZ max) => $"{max.X - min.X:F2}x{max.Y - min.Y:F2}";

    /// <summary>The annotation crop rectangle in the crop's own frame, if Revit reports one.</summary>
    private static string AnnotationShapeExtent(View view) {
        try {
            var toCrop = view.CropBox.Transform.Inverse;
            var points = view.GetCropRegionShapeManager().GetAnnotationCropShape().Select(c => toCrop.OfPoint(c.GetEndPoint(0))).ToList();
            return $"{points.Max(p => p.X) - points.Min(p => p.X):F2}x{points.Max(p => p.Y) - points.Min(p => p.Y):F2}";
        } catch (Exception e) { return $"none ({e.GetType().Name})"; }
    }

    private static (int Width, int Height, bool[] Dark) DarkPixels(string path) {
        BitmapSource frame;
        using (var stream = File.OpenRead(path))
            frame = new FormatConvertedBitmap(BitmapDecoder.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0], PixelFormats.Bgra32, null, 0);
        int w = frame.PixelWidth, h = frame.PixelHeight;
        var bytes = new byte[w * h * 4];
        frame.CopyPixels(bytes, w * 4, 0);
        var dark = new bool[w * h];
        for (var i = 0; i < w * h; i++) dark[i] = bytes[i * 4 + 3] > 128 && bytes[i * 4] + bytes[i * 4 + 1] + bytes[i * 4 + 2] < 3 * 128;
        return (w, h, dark);
    }

    /// <summary>8-connected components of dark pixels: size and centroid (pixel centers at +0.5).</summary>
    private static List<(int Count, double X, double Y)> Blobs(bool[] dark, int w, int h) {
        var seen = new bool[dark.Length];
        var blobs = new List<(int, double, double)>();
        for (var start = 0; start < dark.Length; start++) {
            if (!dark[start] || seen[start]) continue;
            var blob = new List<int>();
            var stack = new Stack<int>([start]);
            seen[start] = true;
            while (stack.Count > 0) {
                var i = stack.Pop();
                blob.Add(i);
                int x = i % w, y = i / w;
                for (var dy = -1; dy <= 1; dy++)
                for (var dx = -1; dx <= 1; dx++) {
                    int nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    var n = ny * w + nx;
                    if (dark[n] && !seen[n]) { seen[n] = true; stack.Push(n); }
                }
            }
            blobs.Add((blob.Count, blob.Average(i => i % w) + 0.5, blob.Average(i => i / w) + 0.5));
        }
        return blobs;
    }

    /// <summary>Pixel (x right, y down, pixel centers at +0.5) of a model point, through the registered corners.</summary>
    private static (double X, double Y) Pixel(RevitViewImageRegistration reg, XYZ p) {
        double ux = reg.TopRight[0] - reg.TopLeft[0], uy = reg.TopRight[1] - reg.TopLeft[1];
        double vx = reg.BottomLeft[0] - reg.TopLeft[0], vy = reg.BottomLeft[1] - reg.TopLeft[1];
        double px = p.X - reg.TopLeft[0], py = p.Y - reg.TopLeft[1];
        return ((px * ux + py * uy) / (ux * ux + uy * uy) * reg.Width, (px * vx + py * vy) / (vx * vx + vy * vy) * reg.Height);
    }

    private static double Distance((double X, double Y) a, (double X, double Y) b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
}
