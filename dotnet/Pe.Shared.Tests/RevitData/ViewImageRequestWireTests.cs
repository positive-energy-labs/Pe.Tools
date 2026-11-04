using Newtonsoft.Json;
using System.Reflection;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>Wire-shape checks mirroring Op request serialization for the capture request.</summary>
[TestFixture]
public sealed class ViewImageRequestWireTests {
    // Exercise the dispatch authority, including its constructor-default resolver.
    private static JsonSerializerSettings BridgeSettings => (JsonSerializerSettings)typeof(Op)
        .GetField("JsonSettings", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;

    [Test]
    public void Omitted_defaults_and_explicit_zero_remain_distinct_at_dispatch() {
        var request = JsonConvert.DeserializeObject<RevitViewImageRequest>("{}", BridgeSettings)!;
        Assert.Multiple(() => {
            Assert.That(request.PixelSize, Is.EqualTo(1500));
            Assert.That(request.MarginPercent, Is.EqualTo(8));
            Assert.That(request.Target, Is.Null);
            Assert.That(request.Focus, Is.Null);
        });
        var explicitZero = JsonConvert.DeserializeObject<RevitViewImageRequest>(
            """{"pixelSize":0,"marginPercent":0}""", BridgeSettings)!;
        Assert.That((explicitZero.PixelSize, explicitZero.MarginPercent), Is.EqualTo((0, 0d)));
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

    [Test]
    public void Image_url_names_the_registered_sha_and_is_absent_without_registration() {
        var sha = new string('a', 64);
        var handle = new RevitAgentContextHandle(RevitAgentContextHandleKind.View, "doc", 1, "u", "L1");
        var registered = new RevitViewImageData(handle, "C:/t/view.png", 3, 10, 10,
            Registration: new RevitViewImageRegistration(10, 10, sha, [0, 1], [1, 1], [0, 0]));
        var refused = new RevitViewImageData(handle, "C:/t/sheet.png", 3, 10, 10,
            RegistrationRefusal: RevitViewImageRegistrationRefusal.NoCrop);
        Assert.Multiple(() => {
            Assert.That(JsonConvert.SerializeObject(registered, BridgeSettings),
                Does.Contain($"\"imageUrl\":\"/captures/{sha}.png\""));
            Assert.That(JsonConvert.SerializeObject(refused, BridgeSettings), Does.Not.Contain("imageUrl"));
        });
    }
}
