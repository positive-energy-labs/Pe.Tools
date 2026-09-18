using Newtonsoft.Json.Linq;
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
            Measurement = new(key, "measurement-1", 0, 8, null)
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
        Assert.That(RegionMeasurements.Read(provenance with { Measurement = null }, key).State,
            Is.EqualTo("unmeasured"));
    }

    // Legacy carrier keys are old human dismissals: no migrator, no silent discard. Both rewrite shapes the native paths use
    // (remeasure's `with` and materialization-failure's Flags.Add) must hand them back untouched.
    [Test]
    public void RewriteKeepsLegacyAndUnknownCarrierKeysUntouched()
    {
        var resolutions = JToken.Parse("""[{"subject":"R01","flag":"orphaned-region","verb":"dismiss","at":"2026-08-01T00:00:00Z","runId":"run-1"}]""");
        var unknown = JToken.Parse("""{"Kept":{"MixedCase":[1,2.5,null]}}""");
        var blob = new JObject {
            ["version"] = 1, ["zoneGuid"] = Guid.NewGuid(), ["runId"] = "run-1", ["sourceRoomId"] = "R01", ["sourceSqft"] = 99,
            ["flags"] = new JArray("orphaned-region"), ["resolutions"] = resolutions.DeepClone(), ["futureKey"] = unknown.DeepClone(), ["LegacyPascal"] = "kept"
        }.ToString();

        var remeasured = JObject.Parse((RegionProvenance.FromJson(blob) with {
            Measurement = new("key", "measurement-2", 0, 9, null)
        }).ToJson());
        var failed = RegionProvenance.FromJson(blob);
        failed.Flags.Add("materialization-failure");
        var flagged = JObject.Parse(failed.ToJson());

        foreach (var rewritten in new[] { remeasured, flagged }) {
            Assert.That(JToken.DeepEquals(rewritten["resolutions"], resolutions), Is.True, rewritten.ToString());
            Assert.That(JToken.DeepEquals(rewritten["futureKey"], unknown), Is.True, rewritten.ToString());
            Assert.That(rewritten["LegacyPascal"]?.Value<string>(), Is.EqualTo("kept"), "the camelCase resolver must not rename extension keys");
        }
        Assert.That(remeasured["measurement"]?["runId"]?.Value<string>(), Is.EqualTo("measurement-2"));
        Assert.That(flagged["flags"]!.Values<string>(), Is.EqualTo(new[] { "orphaned-region", "materialization-failure" }));
    }
}
