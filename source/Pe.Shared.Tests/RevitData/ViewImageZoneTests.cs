using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     The recorded project-a zones (filled regions, facts of `project-a-20260919`) through the staged formula: product PNG cut by
///     <see cref="RevitViewImageRegistration.CropPixels" />, registered by <see cref="RevitViewImageRegistration.FromCrop" />.
///     A zone inside its view's crop must draw where the registration places it; one outside must map outside the cut.
///     Edges-on-ink alone does not discriminate here (half the cut is zone fill; edges shifted 15 px still score 80-100%),
///     so the zone's own fill must also fit best at zero shift.
/// </summary>
[TestFixture]
public sealed class ViewImageZoneTests {
    private static readonly string Dir = Path.Combine(Path.GetDirectoryName(Pe.Shared.Tests.FamilyModelContractTests.FixtureDir)!, "ViewImageFacts", "project-a-20260919");
    // Client drawings: gitignored like Old_Template.rvt; fetch from Pe.Tools/.artifacts/fixtures/view-image-facts/project-a-20260919/.
    private static readonly bool Present = File.Exists(Path.Combine(Dir, "facts.json"));
    private static readonly Lazy<JObject> LazyFacts = new(() => JObject.Parse(File.ReadAllText(Path.Combine(Dir, "facts.json"))));
    private static JObject Facts {
        get {
            if (!Present) Assert.Ignore($"project-a view-image fixture absent (gitignored client drawings): copy it to {Dir}");
            return LazyFacts.Value;
        }
    }

    private static (double X, double Y) Xy(JToken t) => ((double)t[0]!, (double)t[1]!);
    private static JObject View(long id) => (JObject)Facts["views"]!.Single(v => (long)v["id"]! == id);
    // Absent fixture: one case that ignores by name rather than silently running none.
    public static IEnumerable<long> Views => Present ? LazyFacts.Value["views"]!.Select(v => (long)v["id"]!) : [0L];
    public static IEnumerable<long> Zones => Present ? LazyFacts.Value["regions"]!.Select(r => (long)r["id"]!) : [0L];

    private sealed record Cut(RevitViewImagePixelRect Rect, RevitViewImageRegistration Registration, byte[] Bgra);

    private static Cut CutOf(JObject view) {
        var product = view["exports"]!.Single(e => (string)e["name"]! == "product");
        var crop = view["cropBox"]!;
        var t = crop["transform"]!;
        BitmapSource png;
        using (var stream = File.OpenRead(Path.Combine(Dir, (string)product["file"]!)))
            png = new FormatConvertedBitmap(BitmapDecoder.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0], PixelFormats.Bgra32, null, 0);
        Assert.That((png.PixelWidth, png.PixelHeight), Is.EqualTo(((int)product["width"]!, (int)product["height"]!)));
        var (rect, refusal) = RevitViewImageRegistration.CropPixels(png.PixelWidth, png.PixelHeight, Xy(view["outline"]!["min"]!), Xy(view["outline"]!["max"]!),
            (double)view["scale"]!, Xy(crop["min"]!), Xy(crop["max"]!));
        Assert.That(refusal, Is.Null, "the product PNG's size is the outline's prediction (the gate)");
        var (registration, cropRefusal) = RevitViewImageRegistration.FromCrop(rect!.Width, rect.Height, "sha", Xy(crop["min"]!), Xy(crop["max"]!),
            Xy(t["origin"]!), Xy(t["basisX"]!), Xy(t["basisY"]!));
        Assert.That(cropRefusal, Is.Null);
        var bgra = new byte[rect.Width * rect.Height * 4];
        png.CopyPixels(new Int32Rect(rect.Left, rect.Top, rect.Width, rect.Height), bgra, rect.Width * 4, 0);
        return new Cut(rect, registration!, bgra);
    }

    // Model XY -> cut-image pixel, read back through the registration's corners (not the crop math that made them).
    private static (double U, double V) Pixel(RevitViewImageRegistration r, (double X, double Y) p) {
        double ux = r.TopRight[0] - r.TopLeft[0], uy = r.TopRight[1] - r.TopLeft[1], vx = r.BottomLeft[0] - r.TopLeft[0], vy = r.BottomLeft[1] - r.TopLeft[1];
        double dx = p.X - r.TopLeft[0], dy = p.Y - r.TopLeft[1];
        return ((dx * ux + dy * uy) / (ux * ux + uy * uy) * r.Width, (dx * vx + dy * vy) / (vx * vx + vy * vy) * r.Height);
    }

    [TestCaseSource(nameof(Views))]
    public void The_product_export_passes_the_gate_and_cuts_to_the_crop(long viewId) {
        var cut = CutOf(View(viewId));
        Console.WriteLine($"[PE_ZONE] view={viewId} cut={cut.Rect}");
    }

    [TestCaseSource(nameof(Zones))]
    public void A_zone_draws_where_the_registration_places_it_or_maps_outside_the_cut(long zoneId) {
        var zone = Facts["regions"]!.Single(r => (long)r["id"]! == zoneId);
        var view = View((long)zone["ownerViewId"]!);
        var crop = view["cropBox"]!;
        var t = crop["transform"]!;
        var loops = zone["loops"]!.Select(l => l.Select(Xy).ToList()).ToList();
        var coverage = RevitViewImageRegistration.Coverage(loops.SelectMany(l => l).Select(p => new[] { p.X, p.Y }),
            Xy(crop["min"]!), Xy(crop["max"]!), Xy(t["origin"]!), Xy(t["basisX"]!), Xy(t["basisY"]!));
        var cut = CutOf(view);
        var reg = cut.Registration;
        var pixels = loops.Select(l => l.Select(p => Pixel(reg, p)).ToList()).ToList();
        Console.WriteLine($"[PE_ZONE] zone={zoneId} view={(string)view["name"]} coverage={coverage} cut={reg.Width}x{reg.Height} " +
                          $"px=({pixels.SelectMany(l => l).Min(p => p.U):F0}..{pixels.SelectMany(l => l).Max(p => p.U):F0}, {pixels.SelectMany(l => l).Min(p => p.V):F0}..{pixels.SelectMany(l => l).Max(p => p.V):F0})");
        Assert.That(coverage, Is.Not.EqualTo(RevitCropCoverage.Crossing), "the fixture has no crossing zone");
        if (coverage == RevitCropCoverage.Outside) {
            Assert.That(pixels.SelectMany(l => l).Where(p => p.U >= 0 && p.U <= reg.Width && p.V >= 0 && p.V <= reg.Height), Is.Empty,
                "a zone outside its view's crop must not be placed inside the cut image");
            return;
        }

        bool Ink(int x, int y) {
            var i = (y * reg.Width + x) * 4;
            return Math.Min(cut.Bgra[i], Math.Min(cut.Bgra[i + 1], cut.Bgra[i + 2])) < 235;
        }

        int samples = 0, onInk = 0;
        foreach (var loop in pixels)
            for (var e = 0; e < loop.Count; e++) {
                var (a, b) = (loop[e], loop[(e + 1) % loop.Count]);
                var steps = Math.Max(1, (int)Math.Sqrt((b.U - a.U) * (b.U - a.U) + (b.V - a.V) * (b.V - a.V)));
                for (var s = 0; s <= steps; s++) {
                    int u = (int)(a.U + (b.U - a.U) * s / steps), v = (int)(a.V + (b.V - a.V) * s / steps);
                    samples++;
                    var hit = false;
                    for (var dy = -3; dy <= 3 && !hit; dy++)
                        for (var dx = -3; dx <= 3 && !hit; dx++)
                            hit = u + dx >= 0 && u + dx < reg.Width && v + dy >= 0 && v + dy < reg.Height && Ink(u + dx, v + dy);
                    if (hit) onInk++;
                }
            }

        var (bestDx, bestDy, bestIou, zeroIou) = FillFit(pixels[0], cut.Bgra, reg.Width, reg.Height);
        Console.WriteLine($"[PE_ZONE] zone={zoneId} edgesOnInk={onInk}/{samples} ({100.0 * onInk / samples:F1}%) fillIoU@0={zeroIou:F4} best=({bestDx},{bestDy}) {bestIou:F4}");
        Assert.Multiple(() => {
            Assert.That((double)onInk / samples, Is.GreaterThanOrEqualTo(0.9), "zone edges sit on ink within 3 px");
            Assert.That((Math.Abs(bestDx), Math.Abs(bestDy)), Is.EqualTo((0, 0)), "the zone's own fill fits best exactly where the registration places it");
        });
    }

    // The zone's fill colour is the mode inside its outer loop; the shift (±4 px) whose mask best overlaps that colour is the residual offset.
    private static (int Dx, int Dy, double Best, double Zero) FillFit(List<(double U, double V)> poly, byte[] bgra, int w, int h) {
        var mask = new bool[w * h];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++) {
                double px = x + 0.5, py = y + 0.5;
                var inside = false;
                for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++)
                    if (poly[i].V > py != poly[j].V > py && px < (poly[j].U - poly[i].U) * (py - poly[i].V) / (poly[j].V - poly[i].V) + poly[i].U)
                        inside = !inside;
                mask[y * w + x] = inside;
            }
        var fill = Enumerable.Range(0, w * h).Where(i => mask[i]).GroupBy(i => BitConverter.ToInt32(bgra, i * 4)).MaxBy(g => g.Count())!.Key;
        var colour = Enumerable.Range(0, w * h).Select(i => BitConverter.ToInt32(bgra, i * 4) == fill).ToArray();
        var colourCount = colour.Count(c => c);
        var maskCount = mask.Count(m => m);
        (int, int, double, double) best = (0, 0, -1, 0);
        for (var dy = -4; dy <= 4; dy++)
            for (var dx = -4; dx <= 4; dx++) {
                var both = 0;
                for (var y = Math.Max(0, dy); y < Math.Min(h, h + dy); y++)
                    for (var x = Math.Max(0, dx); x < Math.Min(w, w + dx); x++)
                        if (mask[(y - dy) * w + x - dx] && colour[y * w + x]) both++;
                var iou = (double)both / (maskCount + colourCount - both);
                if (dx == 0 && dy == 0) best.Item4 = iou;
                if (iou > best.Item3) best = (dx, dy, iou, best.Item4);
            }
        return best;
    }
}
