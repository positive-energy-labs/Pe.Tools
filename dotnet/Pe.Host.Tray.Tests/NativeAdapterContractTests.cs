using System.Text.Json;
using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class NativeAdapterContractTests {
    [TestCase("""{"type":"chrome-ready"}""")]
    [TestCase("""{"type":"panel-pin","pinned":true}""")]
    [TestCase("""{"type":"panel-hide","unpinnedOnly":false}""")]
    [TestCase("""{"type":"navigate-history","direction":"back"}""")]
    [TestCase("""{"type":"open-window","url":"http://127.0.0.1/open"}""")]
    [TestCase("""{"type":"notice-ready"}""")]
    [TestCase("""{"type":"notice-card","height":400}""")]
    [TestCase("""{"type":"notice-hide"}""")]
    [TestCase("""{"type":"notice-panel"}""")]
    public void RendererCommandsUseTheGeneratedContract(string json) {
        using var value = JsonDocument.Parse(json);
        Assert.That(NativeAdapterContract.Accepts("renderer", value.RootElement), Is.True);
    }

    [TestCase("""{"type":"chrome-ready","unexpected":true}""")]
    [TestCase("""{"type":"notice-card","height":-1}""")]
    [TestCase("""{"type":"notice-card","height":1.5}""")]
    [TestCase("""{"type":"navigate-history","direction":"sideways"}""")]
    public void RendererCommandsRefuseMalformedFields(string json) {
        using var value = JsonDocument.Parse(json);
        Assert.That(NativeAdapterContract.Accepts("renderer", value.RootElement), Is.False);
    }

    [Test]
    public void NativeNoticesAndNestedQuestionSchemasUseTheSameProjection() {
        using var value = JsonDocument.Parse("""{"type":"notice","notice":{"id":"n","revision":1,"title":"Question","body":"","act":{"kind":"question","threadId":"t","requestId":"r","message":"Which?","requestedSchema":{"type":"object","properties":{"x":{"type":"string"}}}}}}""");
        Assert.That(NativeAdapterContract.Accepts("native", value.RootElement), Is.True);
        using var malformed = JsonDocument.Parse("""{"id":"n","revision":1}""");
        Assert.That(NativeAdapterContract.Accepts("notice", malformed.RootElement), Is.False);
    }

    [Test]
    public void NativeSerializationRefusesAnUnknownMessage() =>
        Assert.Throws<InvalidOperationException>(() => NativeAdapterContract.SerializeNative(new { type = "unknown" }));

    [Test]
    public void JsonNumericAndStringRepresentationsDoNotChangeMessageMeaning() {
        using var value = JsonDocument.Parse("""{"type":"panel-\u0070in","pinned":false}""");
        Assert.That(NativeAdapterContract.Accepts("renderer", value.RootElement), Is.True);
    }
}
