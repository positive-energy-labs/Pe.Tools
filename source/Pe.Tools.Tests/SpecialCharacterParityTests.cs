namespace Pe.Tools.Tests;

public sealed class SpecialCharacterParityTests : RevitTestBase
{
  public static IEnumerable<string> JsonCases()
  {
    yield return """
                 {
                   "text": "He said \"hello\" and left."
                 }
                 """;
    yield return """
                 {
                   "path": "C:\\\\Program Files\\\\Pe\\\\config.json"
                 }
                 """;
    yield return """
                 {
                   "csvLike": "a,b,c,d",
                   "note": "contains,comma"
                 }
                 """;
    yield return """
                 {
                   "specials": "braces { } brackets [ ] colon : and pipe |"
                 }
                 """;
    yield return """
                 {
                   "spaces": "  keep leading and trailing  ",
                   "tabbed": "a\tb\tc"
                 }
                 """;
    yield return """
                 {
                   "numericString": "05",
                   "dashString": "-",
                   "boolString": "true",
                   "nullString": "null"
                 }
                 """;
    yield return """
                 {
                   "rows": [
                     { "type": "A,1", "value": "x\\\"y", "path": "C:\\\\temp\\\\a,b.txt" },
                     { "type": "B,2", "value": "quoted \\\"value\\\"", "path": "C:\\\\temp\\\\c,d.txt" }
                   ]
                 }
                 """;
  }

  [Test]
  [MethodDataSource(nameof(JsonCases))]
  public async Task SpecialCharacters_OurRoundtrip_IsStable(string json)
  {
    var toon = ToonTranspiler.EncodeJson(json);
    var decoded = ToonTranspiler.DecodeToJson(toon);

    await Assert.That(JsonSemanticComparer.AreEquivalent(json, decoded)).IsTrue();
  }

  [Test]
  [MethodDataSource(nameof(JsonCases))]
  public async Task SpecialCharacters_ParityWithCli_BothDirections(string json)
  {
    var runner = ToonCliRunner.CreateOrThrow();

    var oursToon = ToonTranspiler.EncodeJson(json);
    var cliDecodedFromOurs = runner.DecodeToJson(oursToon);
    await Assert.That(JsonSemanticComparer.AreEquivalent(json, cliDecodedFromOurs)).IsTrue();

    var cliToon = runner.EncodeToToon(json);
    var oursDecodedFromCli = ToonTranspiler.DecodeToJson(cliToon);
    await Assert.That(JsonSemanticComparer.AreEquivalent(json, oursDecodedFromCli)).IsTrue();
  }
}
