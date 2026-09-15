using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public class RegionMeasurementsTests
{
    private static List<double[]> Square(double x, double y, double size) =>
        [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];

    [Test]
    public void SameAreaEditInvalidatesMeasurementsAndRemeasurePreservesOriginalEvidence()
    {
        List<List<double[]>> loops = [Square(0, 0, 10), Square(2, 2, 1)];
        var key = RegionMeasurements.GeometryKey(0, [loops]);
        var provenance = new RegionProvenance(1, Guid.NewGuid(), "original", "R01", 99) {
            Measurement = new(key, "measurement-1", 0, 8, null),
            Resolutions = [new("R01", "flag", "accept", "now", "measurement-1")]
        };
        Assert.That(RegionMeasurements.Read(provenance, key).State, Is.EqualTo("current"));
        List<List<double[]>> reordered = [loops[1].AsEnumerable().Reverse().ToList(),
            loops[0].Skip(2).Concat(loops[0].Take(2)).ToList()];
        Assert.That(RegionMeasurements.GeometryKey(0, [reordered]), Is.EqualTo(key));

        List<List<double[]>> edited = [Square(0, 0, 10), Square(5, 5, 1)];
        var editedKey = RegionMeasurements.GeometryKey(0, [edited]);
        var stale = RegionMeasurements.Read(provenance, editedKey);
        Assert.That(stale.State, Is.EqualTo("stale"));
        Assert.That(stale.CeilingZ, Is.Null);
        Assert.That(RegionMeasurements.GeometryKey(1, [loops]), Is.Not.EqualTo(key));
        var renewed = RegionProvenance.FromJson((provenance with {
            Measurement = new(editedKey, "measurement-2", 0, 9, null)
        }).ToJson());
        Assert.That(RegionMeasurements.Read(renewed, editedKey).CeilingZ, Is.EqualTo(9));
        Assert.That(renewed.RunId, Is.EqualTo("original"));
        Assert.That(renewed.Resolutions.Single().RunId, Is.EqualTo("measurement-1"));
        Assert.That(RegionMeasurements.Read(provenance with { Measurement = null }, key).State,
            Is.EqualTo("unmeasured"));
    }
}
