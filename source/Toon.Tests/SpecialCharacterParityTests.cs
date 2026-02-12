using Xunit;

namespace Toon.Tests;

public class SpecialCharacterParityTests
{
  public static IEnumerable<object[]> JsonCases()
  {
    yield return [
        """
            {
              "text": "He said \"hello\" and left."
            }
            """
    ];
    yield return [
        """
            {
              "path": "C:\\\\Program Files\\\\Pe\\\\config.json"
            }
            """
    ];
    yield return [
        """
            {
              "csvLike": "a,b,c,d",
              "note": "contains,comma"
            }
            """
    ];
    yield return [
        """
            {
              "specials": "braces { } brackets [ ] colon : and pipe |"
            }
            """
    ];
    yield return [
        """
            {
              "spaces": "  keep leading and trailing  ",
              "tabbed": "a\tb\tc"
            }
            """
    ];
    yield return [
        """
            {
              "numericString": "05",
              "dashString": "-",
              "boolString": "true",
              "nullString": "null"
            }
            """
    ];
    yield return [
        """
            {
              "rows": [
                { "type": "A,1", "value": "x\\\"y", "path": "C:\\\\temp\\\\a,b.txt" },
                { "type": "B,2", "value": "quoted \\\"value\\\"", "path": "C:\\\\temp\\\\c,d.txt" }
              ]
            }
            """
    ];
  }

  [Theory]
  [MemberData(nameof(JsonCases))]
  public void SpecialCharacters_OurRoundtrip_IsStable(string json)
  {
    var toon = ToonTranspiler.EncodeJson(json);
    var decoded = ToonTranspiler.DecodeToJson(toon);
    Assert.True(JsonSemanticComparer.AreEquivalent(json, decoded), $"TOON:{Environment.NewLine}{toon}");
  }

  [Theory]
  [MemberData(nameof(JsonCases))]
  public void SpecialCharacters_ParityWithCli_BothDirections(string json)
  {
    var runner = ToonCliRunner.CreateOrThrow();

    var oursToon = ToonTranspiler.EncodeJson(json);
    var cliDecodedFromOurs = runner.DecodeToJson(oursToon);
    Assert.True(JsonSemanticComparer.AreEquivalent(json, cliDecodedFromOurs));

    var cliToon = runner.EncodeToToon(json);
    var oursDecodedFromCli = ToonTranspiler.DecodeToJson(cliToon);
    Assert.True(JsonSemanticComparer.AreEquivalent(json, oursDecodedFromCli));
  }
}
