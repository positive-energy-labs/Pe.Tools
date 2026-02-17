using Xunit;

namespace Toon.Tests;

public class StrictDecodeTests {
  [Fact]
  public void Decode_ThrowsOnArrayCountMismatch_WhenStrict() {
    const string toon = """
                            items[2]:
                              - one
                            """;

    var ex = Assert.Throws<ToonParseException>(() => ToonTranspiler.DecodeToJson(toon));
    Assert.Contains("Array length mismatch", ex.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void Decode_AllowsArrayCountMismatch_WhenNotStrict() {
    const string toon = """
                            items[2]:
                              - one
                            """;

    var json = ToonTranspiler.DecodeToJson(toon, new ToonOptions { StrictDecoding = false });
    Assert.Contains("\"items\"", json, StringComparison.Ordinal);
  }

  [Fact]
  public void Decode_ThrowsOnInvalidIndent_WhenStrict() {
    const string toon = """
                            user:
                               name: Ada
                            """;

    var ex = Assert.Throws<ToonParseException>(() => ToonTranspiler.DecodeToJson(toon));
    Assert.Contains("Indentation must align", ex.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void Decode_ThrowsOnTabIndent_WhenStrict() {
    const string toon = "user:\n\tname: Ada";

    var ex = Assert.Throws<ToonParseException>(() => ToonTranspiler.DecodeToJson(toon));
    Assert.Contains("Tabs are not allowed in indentation in strict mode", ex.Message, StringComparison.Ordinal);
  }
}
