using Newtonsoft.Json.Linq;

namespace Pe.Tools.Tests;

public sealed class RoundtripTests : RevitTestBase
{
  [Test]
  [Arguments("{\"id\":123,\"name\":\"Ada\",\"active\":true}")]
  [Arguments("{\"items\":[1,2,3],\"meta\":{\"owner\":\"ops\"}}")]
  [Arguments("{\"items\":[{\"type\":\"W5BM024\",\"value\":\"208V\"},{\"type\":\"W5BM036\",\"value\":\"208V\"}]}")]
  [Arguments("{\"items\":[{\"id\":1,\"name\":\"A\"},{\"id\":2,\"name\":\"B\"}],\"enabled\":false}")]
  [Arguments("{\"nested\":{\"arr\":[{\"k\":\"x\"},{\"k\":\"y\"}],\"ok\":true},\"n\":1.25}")]
  public async Task JsonEncodeDecode_IsSemanticallyStable(string json)
  {
    var toon = ToonTranspiler.EncodeJson(json);
    var decoded = ToonTranspiler.DecodeToJson(toon);

    await Assert.That(JsonSemanticComparer.AreEquivalent(json, decoded)).IsTrue();
  }

  [Test]
  public async Task Decoding_ToonWithTabularArray_ParsesCorrectly()
  {
    const string toon = """
                        values[3]{type,value}:
                          W5BM024,208V
                          W5BM036,208V
                          W5BM048,208V
                        """;

    var json = ToonTranspiler.DecodeToJson(toon);
    var token = JToken.Parse(json);
    var values = (JArray)token["values"]!;

    await Assert.That(values.Count).IsEqualTo(3);
    await Assert.That(values[0]!["type"]!.Value<string>()).IsEqualTo("W5BM024");
    await Assert.That(values[0]!["value"]!.Value<string>()).IsEqualTo("208V");
  }

  [Test]
  public async Task Encoder_UsesTabular_WhenUniformObjectArray()
  {
    const string json = """
                        {
                          "values": [
                            { "type": "W5BM024", "value": "208V" },
                            { "type": "W5BM036", "value": "208V" }
                          ]
                        }
                        """;

    var toon = ToonTranspiler.EncodeJson(json);

    await Assert.That(toon).Contains("values[2]{type,value}:").WithComparison(StringComparison.Ordinal);
  }
}
