using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Space;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class WireDateTimeTests {
    /// <summary>
    ///     Gate c80e644a, /ops: <c>revit.detail.space-status</c> builds no world, so its
    ///     <see cref="SpatialEvidence.ObservedAt" /> is <c>default(DateTime)</c>, whose kind is Unspecified. The
    ///     catalog declares every <see cref="DateTime" /> as JSON Schema <c>date-time</c> (RFC 3339,
    ///     an offset is required), so the wire spelling must carry one or every client refuses the answer.
    /// </summary>
    [Test]
    public void An_unbuilt_stamp_leaves_the_bridge_as_the_date_time_its_schema_declares() {
        var stamp = new SpatialEvidence("doc", 0, default, SpatialEvidence.HostInternalFt, new Resolved([], [], [], [], []), [], [], []);
        var wire = JsonConvert.DeserializeObject<JObject>(
            JsonConvert.SerializeObject(stamp, SdkOperations.Json),
            new JsonSerializerSettings { DateParseHandling = DateParseHandling.None })!;
        Assert.That((string?)wire["observedAt"], Is.EqualTo("0001-01-01T00:00:00Z"));
        // A built world's time is already UTC and keeps its instant.
        var built = new DateTime(2026, 11, 6, 0, 42, 21, DateTimeKind.Utc);
        Assert.That(JsonConvert.SerializeObject(stamp with { ObservedAt = built }, SdkOperations.Json),
            Does.Contain("\"observedAt\":\"2026-11-06T00:42:21Z\""));
    }
}
