using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core.Json;
using Xunit;

namespace Toon.Tests;

public class JsonArrayComposerToonIncludeTests
{
  [Fact]
  public void ExpandIncludes_UsesJsonBeforeToon_WhenBothExist()
  {
    using var sandbox = new TempDir();
    var baseDir = sandbox.Path;
    var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragments");
    _ = Directory.CreateDirectory(fragmentsDir);

    File.WriteAllText(
        System.IO.Path.Combine(fragmentsDir, "frag.json"),
        """
            {
              "Items": [
                { "Name": "json-only" }
              ]
            }
            """);

    File.WriteAllText(
        System.IO.Path.Combine(fragmentsDir, "frag.toon"),
        """
            Items[1]{Name}:
              toon-only
            """);

    var root = JObject.Parse(
        """
            {
              "Fields": [
                { "$include": "_fragments/frag" }
              ]
            }
            """);

    using var scope = JsonArrayComposer.EnableToonIncludesScope(true);
    JsonArrayComposer.ExpandIncludes(root, baseDir);

    var fields = (JArray)root["Fields"]!;
    Assert.Single(fields);
    Assert.Equal("json-only", fields[0]!["Name"]!.Value<string>());
  }

  [Fact]
  public void ExpandIncludes_ResolvesToon_WhenJsonMissingAndScopeEnabled()
  {
    using var sandbox = new TempDir();
    var baseDir = sandbox.Path;
    var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragments");
    _ = Directory.CreateDirectory(fragmentsDir);

    File.WriteAllText(
        System.IO.Path.Combine(fragmentsDir, "frag.toon"),
        """
            Items[2]{Type,Value}:
              W5BM024,208V
              W5BM036,208V
            """);

    var root = JObject.Parse(
        """
            {
              "Fields": [
                { "$include": "_fragments/frag" }
              ]
            }
            """);

    using var scope = JsonArrayComposer.EnableToonIncludesScope(true);
    JsonArrayComposer.ExpandIncludes(root, baseDir);

    var fields = (JArray)root["Fields"]!;
    Assert.Equal(2, fields.Count);
    Assert.Equal("W5BM024", fields[0]!["Type"]!.Value<string>());
    Assert.Equal("208V", fields[0]!["Value"]!.Value<string>());
  }

  [Fact]
  public void ExpandIncludes_ToonMissingScope_ThrowsNotFoundUsingJsonPath()
  {
    using var sandbox = new TempDir();
    var baseDir = sandbox.Path;
    var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragments");
    _ = Directory.CreateDirectory(fragmentsDir);

    File.WriteAllText(
        System.IO.Path.Combine(fragmentsDir, "frag.toon"),
        """
            Items[1]{Name}:
              only-toon
            """);

    var root = JObject.Parse(
        """
            {
              "Fields": [
                { "$include": "_fragments/frag" }
              ]
            }
            """);

    var ex = Assert.Throws<JsonCompositionException>(() => JsonArrayComposer.ExpandIncludes(root, baseDir));
    Assert.Contains("Fragment file not found", ex.Message, StringComparison.Ordinal);
    Assert.Contains("_fragments", ex.Message, StringComparison.Ordinal);
  }

  private sealed class TempDir : IDisposable
  {
    public TempDir()
    {
      this.Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"toon-include-test-{Guid.NewGuid():N}");
      _ = Directory.CreateDirectory(this.Path);
    }

    public string Path { get; }

    public void Dispose()
    {
      try
      {
        Directory.Delete(this.Path, recursive: true);
      }
      catch
      {
        // ignore cleanup failures in tests
      }
    }
  }
}
