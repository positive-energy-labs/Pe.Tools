using System.IO.Compression;
using System.Reflection;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.OverlayNG;
using Newtonsoft.Json;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

public sealed class BoundaryShapeTests {
    private static T Load<T>(string fixture, string name) {
        using var file = File.OpenRead(Path.Combine(TestContext.CurrentContext.TestDirectory, "fixtures", fixture, name + ".json.gz"));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip);
        return JsonConvert.DeserializeObject<T>(reader.ReadToEnd())!;
    }

    private static Geometry[] Regularize(Geometry[] shapes, PartitionInput input) => (Geometry[])typeof(Solve).Assembly
        .GetType("Pe.Revit.Partition.BoundaryShape")!.GetMethod("Regularize", BindingFlags.Static | BindingFlags.NonPublic)!
        .Invoke(null, new object[] { shapes, input })!;

    [TestCase(0)]
    [TestCase(27)]
    public void Supported_corner_is_orthogonal_in_its_local_wing_and_hole_is_fixed(double degrees) {
        var captured = Load<PartitionInput>("project-a-live", "partition-input");
        double[] Rotate(double[] xy) => Enumerable.Range(0, xy.Length / 2).SelectMany(i => new[] {
            xy[2*i] * Math.Cos(degrees*Math.PI/180) - xy[2*i+1] * Math.Sin(degrees*Math.PI/180),
            xy[2*i] * Math.Sin(degrees*Math.PI/180) + xy[2*i+1] * Math.Cos(degrees*Math.PI/180)
        }).ToArray();
        var zone = Rotate([0,0, 20,0, 20,20, 0,20]);
        var hole = Rotate([2,2, 3,2, 3,3, 2,3]);
        var before = new[] {
            Solve.GeometryOf([Rotate([0,0, 10,0, 10.04,4, 9.95,8, 10.05,10.05, 14,9.95, 16,10.04, 20,10, 20,20, 0,20]), hole]),
            Solve.GeometryOf([Rotate([10,0, 20,0, 20,10, 16,10.04, 14,9.95, 10.05,10.05, 9.95,8, 10.04,4])])
        };
        var knee = captured.Knee with { Elements = [new SliceElement(captured.Knee.Elements[0].Handle,
            [Rotate([9.9,0, 10.1,0, 10.1,10, 9.9,10]), Rotate([10,9.9, 20,9.9, 20,10.1, 10,10.1])])] };
        var input = captured with { Knee = knee, Header = knee with { Elements = [] }, ZoneLoops = [zone, hole] };
        var after = Regularize(before, input);
        Validate(after, input);
        Assert.That(after.Sum(g => g.NumPoints), Is.LessThan(before.Sum(g => g.NumPoints)));
        var expected = Rotate([10,10]);
        Assert.That(after.All(g => g.Coordinates.Any(c => c.Distance(new Coordinate(expected[0], expected[1])) < 1e-8)), Is.True,
            "both rooms must share the fitted local orthogonal corner");
        Assert.That(((Polygon)after[0]).GetInteriorRingN(0).EqualsExact(((Polygon)before[0]).GetInteriorRingN(0)), Is.True);
        var unsupported = Regularize(before, input with { Knee = knee with { Elements = [] } });
        Assert.That(unsupported.Zip(before).All(pair => pair.First.EqualsExact(pair.Second)), Is.True, "no wall support must leave shapes alone");
    }

    [TestCase("project-a-live")]
    [TestCase("project-c-live")]
    public void Saved_geometry_regularizes_without_replaying_moved_probes(string fixture) {
        var input = Load<PartitionInput>(fixture, "partition-input");
        // Keep the unregularized control fixed as live probe fixtures are recaptured.
        var saved = Load<PartitionAnswer>(fixture, fixture == "project-a-live" ? "shape-before" : "answer");
        var before = saved.Rooms.Select(Polygon).ToArray();
        var indices = Enumerable.Range(0, before.Length).Where(i => saved.Rooms[i].Proposal is null
            && saved.Rooms[i].Disposition != Disposition.Excluded && saved.Rooms[i].Reason != "native-overlap").ToArray();
        var fitted = Regularize(indices.Select(i => before[i]).ToArray(), input);
        var after = before.ToArray();
        for (var i = 0; i < indices.Length; i++) after[indices[i]] = fitted[i];
        Validate(after, input);
        for (var i = 0; i < before.Length; i++) {
            Assert.That(after[i].Covers(before[i].InteriorPoint), Is.True, $"room {i} lost its old label");
            Assert.That(before[i].Intersection(after[i]).Area / Math.Max(before[i].Area, after[i].Area), Is.GreaterThanOrEqualTo(0.95));
            Assert.That(((Polygon)after[i]).NumInteriorRings, Is.EqualTo(((Polygon)before[i]).NumInteriorRings));
            var reach = input.Knobs.CloseFt + input.Knobs.InkHalfWidthFt;
            Assert.That(before[i].Boundary.Buffer(reach).Covers(after[i].Boundary), Is.True, "boundary exceeded wall reach");
            Assert.That(after[i].Boundary.Buffer(reach).Covers(before[i].Boundary), Is.True, "boundary exceeded wall reach");
            for (var j = i + 1; j < before.Length; j++)
                Assert.That(after[i].Boundary.Intersection(after[j].Boundary).Length > 1e-6,
                    Is.EqualTo(before[i].Boundary.Intersection(before[j].Boundary).Length > 1e-6), $"adjacency {i}/{j} changed");
        }
        var oldUnion = OverlayNGRobust.Union(before);
        var newUnion = OverlayNGRobust.Union(after);
        Assert.That(oldUnion.Boundary.SymmetricDifference(newUnion.Boundary).Length, Is.LessThanOrEqualTo(1e-6), "exterior or hole boundary moved");
        Assert.That(after.Sum(p => p.NumPoints), Is.LessThanOrEqualTo(before.Sum(p => p.NumPoints)));
        if (fixture == "project-a-live") {
            Assert.That(after.Sum(p => p.NumPoints), Is.LessThan(0.98 * before.Sum(p => p.NumPoints)), "regularization did not remove corners");
            Assert.That(after.Sum(p => Corners((Polygon)p)), Is.GreaterThan(before.Sum(p => Corners((Polygon)p))), "local orthogonality did not improve");
        }
        Write(fixture + "-stage", before, after);
    }

    [TestCase("project-a-live")]
    [TestCase("project-c-live")]
    public void Full_solve_geometry_has_coverage_without_invented_floor_or_ceiling_hits(string fixture) {
        var input = Load<PartitionInput>(fixture, "partition-input");
        // Geometry witness only. No captured hit is reassigned and no height is fabricated.
        // Dispositions from this run are deliberately neither asserted nor exported.
        var answer = Solve.Run(input, (_, _) => new ProbeAnswer(input.Knee.Stamp, input.Knee.Searched, null, null, 0, 0));
        var after = answer.Rooms.Select(Polygon).ToArray();
        var before = Load<PartitionAnswer>(fixture, "answer").Rooms.Select(Polygon).ToArray();
        Assert.That(after.Length, Is.EqualTo(before.Length), "shaping must preserve the existing region set");
        Validate(after, input);
        var matches = before.Select(p => Array.FindIndex(after, q => q.Covers(p.InteriorPoint))).ToArray();
        Assert.That(matches, Has.All.GreaterThanOrEqualTo(0), "identified room label lost");
        Assert.That(matches.Distinct().Count(), Is.EqualTo(before.Length), "identified regions merged");
        Write(fixture + "-solve", before, after, answer.Rooms.Select(r => new[] { r.LabelX, r.LabelY }).ToArray());
    }

    private static Geometry Polygon(Room room) => Solve.GeometryOf(new[] { room.Loop }.Concat(room.Holes ?? []).ToArray());

    private static void Validate(Geometry[] polygons, PartitionInput input) {
        Assert.That(polygons.All(p => p.IsValid), Is.True);
        for (var i = 0; i < polygons.Length; i++)
            for (var j = i + 1; j < polygons.Length; j++)
                Assert.That(polygons[i].Intersection(polygons[j]).Area, Is.LessThanOrEqualTo(1e-6));
        var union = OverlayNGRobust.Union(polygons);
        var zone = Solve.GeometryOf(input.ZoneLoops);
        Assert.That(union.Difference(zone).Area, Is.LessThanOrEqualTo(1e-6), "spill");
        Assert.That(zone.Difference(union).Area, Is.LessThanOrEqualTo(1e-6), "gap");
    }

    private static void Write(string name, Geometry[] before, Geometry[] after, double[][]? labels = null) {
        var directory = Environment.GetEnvironmentVariable("PARTITION_SHAPE_EVIDENCE");
        object Metrics(Geometry[] polygons) => new { rooms = polygons.Length, vertices = polygons.Sum(p => p.NumPoints),
            rightCorners = polygons.Sum(p => Corners((Polygon)p)) };
        TestContext.Out.WriteLine($"{name}: {JsonConvert.SerializeObject(Metrics(before))} -> {JsonConvert.SerializeObject(Metrics(after))}");
        if (directory is null) return;
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, name + ".json"), JsonConvert.SerializeObject(new {
            before = Metrics(before), after = Metrics(after),
            beforeWkt = before.Select(p => p.AsText()), afterWkt = after.Select(p => p.AsText()),
            labels = labels ?? after.Select(p => new[] { p.InteriorPoint.X, p.InteriorPoint.Y }).ToArray(),
            labelSource = labels is null ? "stage geometry" : "Solve.Run room labels",
            evidence = "offline geometry only; moved labels require fresh Revit probes"
        }));
    }

    private static int Corners(Polygon polygon) {
        var points = polygon.ExteriorRing.Coordinates.SkipLast(1).ToArray();
        return Enumerable.Range(0, points.Length).Count(i => {
            var a = points[(i + points.Length - 1) % points.Length];
            var b = points[i];
            var c = points[(i + 1) % points.Length];
            var dot = (a.X-b.X)*(c.X-b.X) + (a.Y-b.Y)*(c.Y-b.Y);
            return Math.Abs(dot / (a.Distance(b)*c.Distance(b))) < Math.Sin(Math.PI / 90);
        });
    }
}
