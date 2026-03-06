namespace Pe.Tools.Tests;

public sealed class StrictDecodeTests : RevitTestBase
{
  [Test]
  public async Task Decode_ThrowsOnArrayCountMismatch_WhenStrict()
  {
    const string toon = """
                        items[2]:
                          - one
                        """;

    var exception = (await Assert.That(() => ToonTranspiler.DecodeToJson(toon))
      .Throws<ToonParseException>())!;

    await Assert.That(exception.Message).Contains("Array length mismatch").WithComparison(StringComparison.Ordinal);
  }

  [Test]
  public async Task Decode_AllowsArrayCountMismatch_WhenNotStrict()
  {
    const string toon = """
                        items[2]:
                          - one
                        """;

    var json = ToonTranspiler.DecodeToJson(toon, new ToonOptions { StrictDecoding = false });

    await Assert.That(json).Contains("\"items\"").WithComparison(StringComparison.Ordinal);
  }

  [Test]
  public async Task Decode_ThrowsOnInvalidIndent_WhenStrict()
  {
    const string toon = """
                        user:
                           name: Ada
                        """;

    var exception = (await Assert.That(() => ToonTranspiler.DecodeToJson(toon))
      .Throws<ToonParseException>())!;

    await Assert.That(exception.Message).Contains("Indentation must align").WithComparison(StringComparison.Ordinal);
  }

  [Test]
  public async Task Decode_ThrowsOnTabIndent_WhenStrict()
  {
    const string toon = "user:\n\tname: Ada";

    var exception = (await Assert.That(() => ToonTranspiler.DecodeToJson(toon))
      .Throws<ToonParseException>())!;

    await Assert.That(exception.Message)
      .Contains("Tabs are not allowed in indentation in strict mode")
      .WithComparison(StringComparison.Ordinal);
  }
}
