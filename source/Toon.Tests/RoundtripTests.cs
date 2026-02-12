using Newtonsoft.Json.Linq;
using Xunit;

namespace Toon.Tests;

public class RoundtripTests
{
  [Theory]
  [InlineData("{\"id\":123,\"name\":\"Ada\",\"active\":true}")]
  [InlineData("{\"items\":[1,2,3],\"meta\":{\"owner\":\"ops\"}}")]
  [InlineData("{\"items\":[{\"type\":\"W5BM024\",\"value\":\"208V\"},{\"type\":\"W5BM036\",\"value\":\"208V\"}]}")]
  [InlineData("{\"items\":[{\"id\":1,\"name\":\"A\"},{\"id\":2,\"name\":\"B\"}],\"enabled\":false}")]
  [InlineData("{\"nested\":{\"arr\":[{\"k\":\"x\"},{\"k\":\"y\"}],\"ok\":true},\"n\":1.25}")]
  public void JsonEncodeDecode_IsSemanticallyStable(string json)
  {
    var toon = ToonTranspiler.EncodeJson(json);
    var decoded = ToonTranspiler.DecodeToJson(toon);
    Assert.True(JsonSemanticComparer.AreEquivalent(json, decoded), $"JSON mismatch.\nTOON:\n{toon}\nDecoded:\n{decoded}");
  }

  [Fact]
  public void Decoding_ToonWithTabularArray_ParsesCorrectly()
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

    Assert.Equal(3, values.Count);
    Assert.Equal("W5BM024", values[0]!["type"]!.Value<string>());
    Assert.Equal("208V", values[0]!["value"]!.Value<string>());
  }

  [Fact]
  public void Encoder_UsesTabular_WhenUniformObjectArray()
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
    Assert.Contains("values[2]{type,value}:", toon, StringComparison.Ordinal);
  }
}
