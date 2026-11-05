using System.IO.Compression;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.OverlayNG;
using Newtonsoft.Json;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

public sealed class ClippingTests {
    [Test]
    public void ProjectC_level2_clipping_keeps_area_without_mixed_dimension_overlay_failure() {
        using var file = File.OpenRead(Path.Combine(PrivateFixtures.Dir("project-c/partition/level2"), "partition-input.json.gz"));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip);
        var input = JsonConvert.DeserializeObject<PartitionInput>(reader.ReadToEnd())!;
        var answer = Solve.RunRails(input, (_, _) => new ProbeAnswer(input.Knee.Stamp, input.Knee.Searched, null, null, 0, 0));
        Assert.That(answer.Rooms, Is.Not.Empty);
        var polygons = answer.Rooms.Select(r => Solve.GeometryOf(new[] { r.Loop }.Concat(r.Holes ?? []).ToArray())).ToArray();
        Assert.That(polygons.All(p => p.IsValid), Is.True);
        for (var i = 0; i < polygons.Length; i++)
            for (var j = i + 1; j < polygons.Length; j++)
                Assert.That(polygons[i].Intersection(polygons[j]).Area, Is.LessThanOrEqualTo(1e-6));
        var union = OverlayNGRobust.Union(polygons.Cast<Geometry>().ToList());
        var zone = Solve.GeometryOf(input.ZoneLoops);
        Assert.That(union.Difference(zone).Area, Is.LessThanOrEqualTo(1e-6), "spill");
        Assert.That(zone.Difference(union).Area, Is.LessThanOrEqualTo(1e-6), "gap");
    }
}
