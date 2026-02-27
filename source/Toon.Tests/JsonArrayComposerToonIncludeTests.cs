using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core.Json;
using Xunit;

namespace Toon.Tests;

public class JsonArrayComposerToonIncludeTests {
    [Fact]
    public void ExpandIncludes_UsesJsonBeforeToon_WhenBothExist() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;
        var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragmentNames");
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
                { "$include": "_fragmentNames/frag" }
              ]
            }
            """);

        using var scope = JsonArrayComposer.EnableToonIncludesScope(true);
        JsonArrayComposer.ExpandIncludes(root, baseDir, baseDir, ["_fragmentNames"]);

        var fields = (JArray)root["Fields"]!;
        Assert.Single(fields);
        Assert.Equal("json-only", fields[0]!["Name"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_ResolvesToon_WhenJsonMissingAndScopeEnabled() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;
        var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragmentNames");
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
                { "$include": "_fragmentNames/frag" }
              ]
            }
            """);

        using var scope = JsonArrayComposer.EnableToonIncludesScope(true);
        JsonArrayComposer.ExpandIncludes(root, baseDir, baseDir, ["_fragmentNames"]);

        var fields = (JArray)root["Fields"]!;
        Assert.Equal(2, fields.Count);
        Assert.Equal("W5BM024", fields[0]!["Type"]!.Value<string>());
        Assert.Equal("208V", fields[0]!["Value"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_ToonMissingScope_ThrowsNotFoundUsingJsonPath() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;
        var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragmentNames");
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
                { "$include": "_fragmentNames/frag" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(root, baseDir, baseDir, ["_fragmentNames"]));
        Assert.Contains("Fragment file not found", ex.Message, StringComparison.Ordinal);
        Assert.Contains("_fragmentNames", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ExpandIncludes_RejectsIncludeOutsideAllowedRoots() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "notAllowed/frag" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(root, baseDir, baseDir, ["_fragmentNames"]));
        Assert.Contains("Invalid '$include' path", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ExpandIncludes_ResolvesFromDesignatedRootForNestedProfiles() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;
        var profilesRoot = System.IO.Path.Combine(baseDir, "profiles", "_fragmentNames");
        _ = Directory.CreateDirectory(profilesRoot);

        File.WriteAllText(
            System.IO.Path.Combine(profilesRoot, "frag.json"),
            """
            {
              "Items": [
                { "Name": "prefixed" }
              ]
            }
            """);

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "_fragmentNames/frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(
            root,
            System.IO.Path.Combine(baseDir, "profiles", "MechEquip"),
            System.IO.Path.Combine(baseDir, "profiles"),
            ["_fragmentNames"]
        );

        var fields = (JArray)root["Fields"]!;
        Assert.Single(fields);
        Assert.Equal("prefixed", fields[0]!["Name"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_DetectsCircularIncludesAcrossNestedFragments() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;
        var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragmentNames");
        _ = Directory.CreateDirectory(fragmentsDir);

        File.WriteAllText(
            System.IO.Path.Combine(fragmentsDir, "a.json"),
            """
            {
              "Items": [
                { "$include": "_fragmentNames/b" }
              ]
            }
            """);
        File.WriteAllText(
            System.IO.Path.Combine(fragmentsDir, "b.json"),
            """
            {
              "Items": [
                { "$include": "_fragmentNames/a" }
              ]
            }
            """);

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "_fragmentNames/a" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(root, baseDir, baseDir, ["_fragmentNames"]));
        Assert.Contains("Circular fragment include detected", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ExpandIncludes_AllowsSiblingReuseOfSameFragment() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;
        var fragmentsDir = System.IO.Path.Combine(baseDir, "_fragmentNames");
        _ = Directory.CreateDirectory(fragmentsDir);

        File.WriteAllText(
            System.IO.Path.Combine(fragmentsDir, "frag.json"),
            """
            {
              "Items": [
                { "Name": "reused" }
              ]
            }
            """);

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "_fragmentNames/frag" },
                { "$include": "_fragmentNames/frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(root, baseDir, baseDir, ["_fragmentNames"]);

        var fields = (JArray)root["Fields"]!;
        Assert.Equal(2, fields.Count);
        Assert.Equal("reused", fields[0]!["Name"]!.Value<string>());
        Assert.Equal("reused", fields[1]!["Name"]!.Value<string>());
    }

    private sealed class TempDir : IDisposable {
        public TempDir() {
            this.Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"toon-include-test-{Guid.NewGuid():N}");
            _ = Directory.CreateDirectory(this.Path);
        }

        public string Path { get; }

        public void Dispose() {
            try {
                Directory.Delete(this.Path, recursive: true);
            } catch {
                // ignore cleanup failures in tests
            }
        }
    }
}
