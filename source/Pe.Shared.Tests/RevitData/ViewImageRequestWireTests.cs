using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>Wire-shape checks mirroring BridgeOp.JsonSettings for the capture request.</summary>
[TestFixture]
public sealed class ViewImageRequestWireTests {
    private static readonly JsonSerializerSettings BridgeSettings = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false,
                OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };

    [Test]
    public void Empty_payload_zeroes_ctor_defaults_so_the_service_must_normalize() {
        // Gotcha: BridgeOp's Newtonsoft settings do NOT honor record ctor defaults — omitted
        // numerics arrive as 0. GetRevitViewImageCore normalizes 0 → 1500px / 8% margin.
        var request = JsonConvert.DeserializeObject<RevitViewImageRequest>("{}", BridgeSettings)!;
        Assert.Multiple(() => {
            Assert.That(request.PixelSize, Is.EqualTo(0));
            Assert.That(request.MarginPercent, Is.EqualTo(0).Within(0.001));
            Assert.That(request.Target, Is.Null);
            Assert.That(request.Focus, Is.Null);
        });
    }

    [Test]
    public void Focus_and_target_round_trip() {
        var json = """{"target":{"id":9948},"focus":{"scopeBox":"Main House"},"pixelSize":300}""";
        var request = JsonConvert.DeserializeObject<RevitViewImageRequest>(json, BridgeSettings)!;
        Assert.Multiple(() => {
            Assert.That(request.Target?.Id, Is.EqualTo(9948));
            Assert.That(request.Focus?.ScopeBox, Is.EqualTo("Main House"));
            Assert.That(request.PixelSize, Is.EqualTo(300));
        });
    }

    [Test]
    public void Focus_element_ids_round_trip() {
        var json = """{"focus":{"elementIds":[1,2,3]}}""";
        var request = JsonConvert.DeserializeObject<RevitViewImageRequest>(json, BridgeSettings)!;
        Assert.That(request.Focus?.ElementIds, Is.EqualTo(new[] { 1L, 2L, 3L }));
    }
}
