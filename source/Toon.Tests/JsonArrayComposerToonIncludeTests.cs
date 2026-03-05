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
                { "$include": "@local/_fragmentNames/frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]);

        var fields = (JArray)root["Fields"]!;
        Assert.Single(fields);
        Assert.Equal("json-only", fields[0]!["Name"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_ResolvesToon_WhenJsonMissing() {
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
                { "$include": "@local/_fragmentNames/frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]);

        var fields = (JArray)root["Fields"]!;
        Assert.Equal(2, fields.Count);
        Assert.Equal("W5BM024", fields[0]!["Type"]!.Value<string>());
        Assert.Equal("208V", fields[0]!["Value"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_ResolvesToon_WhenOnlyToonExists() {
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
                { "$include": "@local/_fragmentNames/frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]);

        var fields = (JArray)root["Fields"]!;
        Assert.Single(fields);
        Assert.Equal("only-toon", fields[0]!["Name"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_RejectsIncludeOutsideAllowedRoots() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "@local/notAllowed/frag" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]));
        Assert.Contains("Invalid '$include' path", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ExpandIncludes_RejectsBareLocalIncludePath() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "_fragmentNames/frag" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]));
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
                { "$include": "@local/_fragmentNames/frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(
            root,
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
                { "$include": "@local/_fragmentNames/b" }
              ]
            }
            """);
        File.WriteAllText(
            System.IO.Path.Combine(fragmentsDir, "b.json"),
            """
            {
              "Items": [
                { "$include": "@local/_fragmentNames/a" }
              ]
            }
            """);

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "@local/_fragmentNames/a" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]));
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
                { "$include": "@local/_fragmentNames/frag" },
                { "$include": "@local/_fragmentNames/frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]);

        var fields = (JArray)root["Fields"]!;
        Assert.Equal(2, fields.Count);
        Assert.Equal("reused", fields[0]!["Name"]!.Value<string>());
        Assert.Equal("reused", fields[1]!["Name"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_ResolvesGlobalPrefixedIncludes_WhenGlobalRootProvided() {
        using var sandbox = new TempDir();
        var settingsRoot = System.IO.Path.Combine(sandbox.Path, "CmdFFMigrator", "settings");
        _ = Directory.CreateDirectory(settingsRoot);

        var localFragmentsDir = System.IO.Path.Combine(settingsRoot, "_fragmentNames");
        _ = Directory.CreateDirectory(localFragmentsDir);
        File.WriteAllText(
            System.IO.Path.Combine(localFragmentsDir, "local.json"),
            """
            {
              "Items": [
                { "Name": "local-value" }
              ]
            }
            """);

        var globalFragmentsDir = System.IO.Path.Combine(sandbox.Path, "Global", "fragments", "_fragmentNames");
        _ = Directory.CreateDirectory(globalFragmentsDir);
        File.WriteAllText(
            System.IO.Path.Combine(globalFragmentsDir, "global-frag.json"),
            """
            {
              "Items": [
                { "Name": "global-value" }
              ]
            }
            """);

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "@local/_fragmentNames/local" },
                { "$include": "@global/_fragmentNames/global-frag" }
              ]
            }
            """);

        JsonArrayComposer.ExpandIncludes(
            root,
            settingsRoot,
            ["_fragmentNames"],
            globalFragmentsDirectory: System.IO.Path.Combine(sandbox.Path, "Global", "fragments")
        );

        var fields = (JArray)root["Fields"]!;
        Assert.Equal(2, fields.Count);
        Assert.Equal("local-value", fields[0]!["Name"]!.Value<string>());
        Assert.Equal("global-value", fields[1]!["Name"]!.Value<string>());
    }

    [Fact]
    public void ExpandIncludes_GlobalPrefixedIncludes_ThrowWhenGlobalRootMissing() {
        using var sandbox = new TempDir();
        var baseDir = sandbox.Path;
        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "@global/_fragmentNames/global-frag" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(root, baseDir, ["_fragmentNames"]));
        Assert.Contains("Invalid '$include' path", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ExpandIncludes_GlobalPrefixedIncludes_RequireAllowedRoot() {
        using var sandbox = new TempDir();
        var settingsRoot = System.IO.Path.Combine(sandbox.Path, "CmdFFMigrator", "settings");
        _ = Directory.CreateDirectory(settingsRoot);

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "@global/shared/global-frag" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(
                root,
                settingsRoot,
                ["_fragmentNames"],
                globalFragmentsDirectory: System.IO.Path.Combine(sandbox.Path, "Global", "fragments")
            ));
        Assert.Contains("Invalid '$include' path", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ExpandIncludes_GlobalPrefixedIncludes_RequireUnderscoredRoot() {
        using var sandbox = new TempDir();
        var settingsRoot = System.IO.Path.Combine(sandbox.Path, "CmdFFMigrator", "settings");
        _ = Directory.CreateDirectory(settingsRoot);

        var root = JObject.Parse(
            """
            {
              "Fields": [
                { "$include": "@global/fragmentNames/global-frag" }
              ]
            }
            """);

        var ex = Assert.Throws<JsonCompositionException>(() =>
            JsonArrayComposer.ExpandIncludes(
                root,
                settingsRoot,
                ["_fragmentNames"],
                globalFragmentsDirectory: System.IO.Path.Combine(sandbox.Path, "Global", "fragments")
            ));
        Assert.Contains("Invalid '$include' path", ex.Message, StringComparison.Ordinal);
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
