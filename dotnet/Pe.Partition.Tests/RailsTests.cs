using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

public sealed class RailsTests {
    private static Handle H(string category, PrimKind kind = PrimKind.Solid, string? layer = null, long id = 1) =>
        new("doc", id, "u" + id, null, category, kind, layer);

    private static PartitionInput Input(params SliceElement[] elements) {
        var stamp = new Stamp("doc", 0, Stamp.HostInternalFt, DateTime.UnixEpoch, [], true, new Resolved([], [], [], [], []));
        var knee = new SliceAnswer(stamp, new Searched(0, 0, 0, 0, 0), elements, elements.Sum(e => e.Pieces.Count), 0);
        return new PartitionInput(knee, knee with { Elements = [] }, [], 0, Knobs.Default, [], "test", [], null);
    }

    private static Func<double, double, double[]> Rot(double degrees) => (x, y) => {
        var r = degrees * Math.PI / 180;
        return [(x * Math.Cos(r)) - (y * Math.Sin(r)), (x * Math.Sin(r)) + (y * Math.Cos(r))];
    };

    /// <summary>A vertical face projects to a degenerate 4-point ring, as Duryee's IFC wall pieces do.</summary>
    private static double[] Face(Func<double, double, double[]> f, double x0, double y0, double x1, double y1) =>
        [.. f(x0, y0), .. f(x1, y1), .. f(x1, y1), .. f(x0, y0)];

    private static double[] Box(Func<double, double, double[]> f, double x0, double y0, double x1, double y1) =>
        [.. f(x0, y0), .. f(x1, y0), .. f(x1, y1), .. f(x0, y1)];

    private static void Near(double[] actual, double[] expected, string what) {
        Assert.That(actual[0], Is.EqualTo(expected[0]).Within(0.06), what);
        Assert.That(actual[1], Is.EqualTo(expected[1]).Within(0.06), what);
    }

    private static void Along(Rail rail, Func<double, double, double[]> f, double x0, double y0, double x1, double y1) {
        var ends = new[] { f(x0, y0), f(x1, y1) };
        var fwd = Math.Abs(rail.A[0] - ends[0][0]) + Math.Abs(rail.A[1] - ends[0][1])
            < Math.Abs(rail.A[0] - ends[1][0]) + Math.Abs(rail.A[1] - ends[1][1]);
        Near(fwd ? rail.A : rail.B, ends[0], "rail start");
        Near(fwd ? rail.B : rail.A, ends[1], "rail end");
    }

    [TestCase(0)]
    [TestCase(27)]
    public void Straight_wall_faces_give_one_centerline_rail_with_their_spacing(double deg) {
        var f = Rot(deg);
        // Two long faces split into pieces with a float-noise offset, plus two end caps.
        var wall = new SliceElement(H("Walls"), [
            Face(f, 0, 0, 6, 0), Face(f, 6, 0.001, 12, 0.001), Face(f, 0, 0.5, 12, 0.5),
            Face(f, 0, 0, 0, 0.5), Face(f, 12, 0, 12, 0.5)]);
        var rails = Rails.From(Input(wall));
        Assert.That(rails, Has.Count.EqualTo(1));
        Assert.That(rails[0].ThicknessFt, Is.EqualTo(0.5).Within(0.002));
        Assert.That(rails[0].Source, Is.EqualTo(Rails.Wall));
        Assert.That(rails[0].Handle, Is.SameAs(wall.Handle));
        Along(rails[0], f, 0, 0.25, 12, 0.25);
    }

    [Test]
    public void Door_opening_in_a_wall_leaves_a_gap_between_two_rails() {
        var f = Rot(0);
        var wall = new SliceElement(H("Walls"), [
            Face(f, 0, 0, 4, 0), Face(f, 0, 0.4, 4, 0.4), Face(f, 7, 0, 12, 0), Face(f, 7, 0.4, 12, 0.4),
            Face(f, 4, 0, 4, 0.4), Face(f, 7, 0, 7, 0.4)]);
        var rails = Rails.From(Input(wall)).OrderBy(r => Math.Min(r.A[0], r.B[0])).ToList();
        Assert.That(rails, Has.Count.EqualTo(2));
        Along(rails[0], f, 0, 0.2, 4, 0.2);
        Along(rails[1], f, 7, 0.2, 12, 0.2);
    }

    [Test]
    public void Bent_wall_gives_one_rail_per_leg() {
        var f = Rot(12);
        var wall = new SliceElement(H("Walls"), [
            Face(f, 0, 0, 10, 0), Face(f, 0, 0.5, 9.5, 0.5), Face(f, 10, 0, 10, 8), Face(f, 9.5, 0.5, 9.5, 8)]);
        var rails = Rails.From(Input(wall));
        Assert.That(rails, Has.Count.EqualTo(2));
        Assert.That(rails.All(r => Math.Abs(r.ThicknessFt - 0.5) < 0.002), Is.True);
        var legs = rails.Select(r => Math.Sqrt(Math.Pow(r.B[0] - r.A[0], 2) + Math.Pow(r.B[1] - r.A[1], 2))).OrderBy(l => l).ToList();
        Assert.That(legs[0], Is.EqualTo(7.5).Within(0.11), "vertical leg over its paired overlap");
        Assert.That(legs[1], Is.EqualTo(9.5).Within(0.11), "horizontal leg over its paired overlap");
    }

    [Test]
    public void Solid_cut_piece_is_its_own_two_faces() {
        var rails = Rails.From(Input(new SliceElement(H("Walls"), [Box(Rot(0), 0, 0, 8, 0.33)])));
        Assert.That(rails, Has.Count.EqualTo(1));
        Assert.That(rails[0].ThicknessFt, Is.EqualTo(0.33).Within(1e-9));
    }

    [Test]
    public void Millwork_generic_models_framing_and_door_layers_never_become_rails() {
        var f = Rot(0);
        Box2 Two(double x0, double y0, double x1, double y1) => new(Face(f, x0, y0, x1, y0), Face(f, x0, y1, x1, y1));
        var counter = Two(0, 0, 8, 2);
        var rails = Rails.From(Input(
            new SliceElement(H("Generic Models", id: 2), [counter.A, counter.B, Box(f, 0, 3, 8, 3.5)]),
            new SliceElement(H("Structural Framing", id: 3), [Box(f, 0, 5, 8, 5.48)]),
            new SliceElement(H("Columns", id: 4), [Box(f, 20, 0, 20.4, 3)]),
            new SliceElement(H("plan.dwg", PrimKind.Curve2D, "A_DOOR", 5), [Face(f, 0, 9, 3, 9), Face(f, 0, 9.2, 3, 9.2)]),
            new SliceElement(H("plan.dwg", PrimKind.Curve2D, "A_STAR", 6), [Face(f, 0, 12, 3, 12), Face(f, 0, 12.6, 3, 12.6)])));
        Assert.That(rails, Is.Empty);
    }

    [Test]
    public void Stud_rows_become_framing_rails_split_at_openings_and_dropped_on_walls() {
        var f = Rot(33);
        var id = 10L;
        // A 2x6 stud cut: 0.125 ft along the wall, 0.46 ft deep across it.
        SliceElement Stud(string category, double x, double y) => new(H(category, id: id++), [Box(f, x - 0.0625, y - 0.23, x + 0.0625, y + 0.23)]);
        IEnumerable<SliceElement> Row(string category, double y, params double[] xs) => xs.Select(x => Stud(category, x, y));
        var sixteen = Enumerable.Range(0, 7).Select(k => k * 4 / 3.0).ToArray();
        var input = Input([
            .. Row("Structural Framing", 0, [.. sixteen, 11, 11 + (4 / 3.0), 11 + (8 / 3.0)]), // 3 ft door gap
            .. Row("Structural Framing", 10, 0, 2, 4, 6), // 24 in on centre
            .. Row("Structural Framing", 20, 0, 0.1), // jamb pack
            .. Row("Generic Models", 30, sixteen), // stud-shaped millwork
            .. Row("Structural Framing", 40, sixteen), // on a modeled wall
            new SliceElement(H("Walls", id: 1), [Face(f, -1, 39.77, 10, 39.77), Face(f, -1, 40.23, 10, 40.23)])]);
        Assert.That(Rails.From(input with { Knobs = input.Knobs with { FramingRails = false } }).Count(r => r.Source == Rails.Framing), Is.Zero, "off");
        var framing = Rails.From(input)
            .Where(r => r.Source == Rails.Framing).OrderBy(r => Rot(-33)(r.A[0], r.A[1])[1]).ThenBy(r => Math.Min(Rot(-33)(r.A[0], r.A[1])[0], Rot(-33)(r.B[0], r.B[1])[0])).ToList();
        Assert.That(framing, Has.Count.EqualTo(3));
        Along(framing[0], f, -0.0625, 0, 8.0625, 0);
        Along(framing[1], f, 10.9375, 0, 13.6667 + 0.0625, 0);
        Along(framing[2], f, -0.0625, 10, 6.0625, 10);
        Assert.That(framing.All(r => Math.Abs(r.ThicknessFt - 0.46) < 0.002), Is.True, "thickness is the stud depth");
        Assert.That(Newtonsoft.Json.JsonConvert.DeserializeObject<Knobs>("{\"CloseFt\":0.75}")!.FramingRails, Is.True, "a capture without the knob");
    }

    private sealed record Box2(double[] A, double[] B);

    /// <summary>
    ///     Falsifier dump, not a gate: writes each capture's rails as JSON for the W1 render. Needs
    ///     <c>PE_RAILS_OUT</c>; Duryee needs <c>PE_RAILS_DURYEE</c> (a whole-level input JSON).
    /// </summary>
    [Explicit]
    [TestCase("duryee-level1")]
    [TestCase("project-a-live")]
    public void Dump_rails(string name) {
        var outDir = Environment.GetEnvironmentVariable("PE_RAILS_OUT") ?? throw new AssertionException("PE_RAILS_OUT is unset");
        string json;
        if (name == "duryee-level1") {
            json = File.ReadAllText(Environment.GetEnvironmentVariable("PE_RAILS_DURYEE") ?? throw new AssertionException("PE_RAILS_DURYEE is unset"));
        } else {
            using var file = File.OpenRead(Path.Combine(PrivateFixtures.Dir("project-a/partition/live"), "partition-input.json.gz"));
            using var gzip = new System.IO.Compression.GZipStream(file, System.IO.Compression.CompressionMode.Decompress);
            json = new StreamReader(gzip).ReadToEnd();
        }
        var input = Newtonsoft.Json.JsonConvert.DeserializeObject<PartitionInput>(json)!;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var rails = Rails.From(input);
        TestContext.Out.WriteLine($"{name}: {rails.Count} rails in {sw.ElapsedMilliseconds} ms");
        Directory.CreateDirectory(outDir);
        File.WriteAllText(Path.Combine(outDir, name + "-rails.json"), Newtonsoft.Json.JsonConvert.SerializeObject(rails));
    }

    [TestCase(0)]
    [TestCase(33)]
    public void Dwg_wall_line_pair_gives_a_midline_rail_and_a_lone_line_gives_none(double deg) {
        var f = Rot(deg);
        var layer = H("plan.dwg", PrimKind.Curve2D, "A_WALL_1", 7);
        // Two lines drawn in pieces, one lone line far off, and hatch pieces too short to be faces.
        var rails = Rails.From(Input(new SliceElement(layer, [
            Face(f, 0, 0, 5, 0), Face(f, 5, 0, 10, 0), Face(f, 0, 0.45, 10, 0.45),
            Face(f, 0, 20, 10, 20),
            Face(f, 2, 0.05, 2.1, 0.4), Face(f, 2.2, 0.05, 2.3, 0.4)])));
        Assert.That(rails, Has.Count.EqualTo(1));
        Assert.That(rails[0].Source, Is.EqualTo(Rails.Dwg));
        Assert.That(rails[0].ThicknessFt, Is.EqualTo(0.45).Within(1e-6));
        Along(rails[0], f, 0, 0.225, 10, 0.225);
    }

    [Test]
    public void Layered_three_line_wall_is_one_rail_and_a_room_scale_pair_is_refused() {
        var f = Rot(0);
        var layer = H("plan.dwg", PrimKind.Curve2D, "A_WALL_7", 8);
        var rails = Rails.From(Input(new SliceElement(layer, [
            Face(f, 0, 0, 10, 0), Face(f, 0, 0.3, 10, 0.3), Face(f, 0, 0.5, 10, 0.5),
            Face(f, 0, 12, 10, 12), Face(f, 0, 14, 10, 14)])));
        Assert.That(rails, Has.Count.EqualTo(1));
        Assert.That(rails[0].ThicknessFt, Is.EqualTo(0.5).Within(1e-9));
        Along(rails[0], f, 0, 0.25, 10, 0.25);
    }
}
