using System.IO.Compression;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.OverlayNG;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

public sealed class LiveCaptureTests {
    [TestCase("project-a/partition/live")]
    [TestCase("project-c/partition/live")]
    public void Captured_inputs_replay_with_real_probes_and_conserve_geometry(string fixture) {
        var directory = PrivateFixtures.Dir(fixture);
        JToken Load(string name) {
            using var file = File.OpenRead(Path.Combine(directory, name + ".json.gz"));
            using var gzip = new GZipStream(file, CompressionMode.Decompress);
            using var reader = new StreamReader(gzip);
            return JToken.Parse(reader.ReadToEnd());
        }
        var input = Load("partition-input").ToObject<PartitionInput>()!;
        var probes = (JArray)Load("probes");
        var expected = Load("answer");
        var cursor = 0;
        ProbeAnswer Probe(double x, double y) {
            Assert.That(cursor, Is.LessThan(probes.Count), "solver requested an uncaptured probe");
            var recorded = probes[cursor++];
            Assert.That(BitConverter.DoubleToInt64Bits(x), Is.EqualTo(BitConverter.DoubleToInt64Bits((double)recorded["x"]!)), "probe X changed; recapture real evidence");
            Assert.That(BitConverter.DoubleToInt64Bits(y), Is.EqualTo(BitConverter.DoubleToInt64Bits((double)recorded["y"]!)), "probe Y changed; recapture real evidence");
            return recorded["answer"]!.ToObject<ProbeAnswer>()!;
        }
        var answer = Solve.Run(input, Probe);
        Assert.That(cursor, Is.EqualTo(probes.Count), "solver skipped captured probes");
        Assert.That(JToken.DeepEquals(JToken.FromObject(answer.Rooms), expected["Rooms"]), Is.True, "replay differs from the recorded Revit answer");
        Assert.That(JToken.DeepEquals(JToken.FromObject(answer.Accounting), expected["Accounting"]), Is.True);
        var polygons = answer.Rooms.Select(room => Solve.GeometryOf(new[] { room.Loop }.Concat(room.Holes ?? []).ToArray())).ToArray();
        foreach (var polygon in polygons) Assert.That(polygon.IsValid, Is.True);
        for (var i = 0; i < polygons.Length; i++)
            for (var j = i + 1; j < polygons.Length; j++)
                Assert.That(polygons[i].Intersection(polygons[j]).Area, Is.LessThanOrEqualTo(1e-6), $"overlap {i}/{j}");
        var union = OverlayNGRobust.Union(polygons.Cast<Geometry>().ToList());
        var domain = Solve.GeometryOf(input.ZoneLoops);
        Assert.That(union.Difference(domain).Area, Is.LessThanOrEqualTo(1e-6), "emitted geometry spills the zone");
        Assert.That(domain.Difference(union).Area, Is.LessThanOrEqualTo(1e-6), "unaccounted gap");
        Assert.That(polygons.Sum(p => p.Area), Is.EqualTo(answer.Rooms.Sum(r => r.AreaSqft)).Within(1e-6), "serialized loops changed area");
        TestContext.Out.WriteLine(JsonConvert.SerializeObject(answer.Accounting));
    }
}
