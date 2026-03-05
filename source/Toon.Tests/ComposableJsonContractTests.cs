using Newtonsoft.Json.Linq;
using Pe.Global.PolyFill;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core;
using System.ComponentModel.DataAnnotations;
using Xunit;

namespace Toon.Tests;

public class ComposableJsonContractTests {
    [Fact]
    public void Write_ReturnsFilePath() {
        using var sandbox = new TempDir();
        var filePath = Path.Combine(sandbox.Path, "output.json");
        var json = new ComposableJson<TestData>(filePath, sandbox.Path, JsonBehavior.Output);

        var result = json.Write(new TestData { Name = "ok" });

        Assert.Equal(filePath, result);
        Assert.True(File.Exists(filePath));
    }

    [Fact]
    public void Read_RejectsIncludeOutsideIncludableProperty() {
        using var sandbox = new TempDir();
        var settingsPath = Path.Combine(sandbox.Path, "settings.json");
        var fragmentRoot = Path.Combine(sandbox.Path, "_allowed-items");
        _ = Directory.CreateDirectory(fragmentRoot);
        File.WriteAllText(
            Path.Combine(fragmentRoot, "item-a.json"),
            """
            {
              "Items": [
                { "Name": "from-fragment" }
              ]
            }
            """
        );
        File.WriteAllText(
            settingsPath,
            """
            {
              "$schema": "./schema.json",
              "DisallowedItems": [
                { "$include": "@local/_allowed-items/item-a" }
              ]
            }
            """
        );

        var json = new ComposableJson<IncludeScopedSettings>(settingsPath, sandbox.Path, JsonBehavior.Settings);
        var exception = Assert.Throws<JsonValidationException>(json.Read);
        Assert.NotNull(exception);
    }

    [Fact]
    public void Read_AllowsIncludeOnIncludableProperty() {
        using var sandbox = new TempDir();
        var settingsPath = Path.Combine(sandbox.Path, "settings.json");
        var fragmentRoot = Path.Combine(sandbox.Path, "_allowed-items");
        _ = Directory.CreateDirectory(fragmentRoot);
        File.WriteAllText(
            Path.Combine(fragmentRoot, "item-a.json"),
            """
            {
              "Items": [
                { "Name": "from-fragment" }
              ]
            }
            """
        );
        File.WriteAllText(
            settingsPath,
            """
            {
              "$schema": "./schema.json",
              "AllowedItems": [
                { "$include": "@local/_allowed-items/item-a" }
              ]
            }
            """
        );

        var json = new ComposableJson<IncludeScopedSettings>(settingsPath, sandbox.Path, JsonBehavior.Settings);
        var result = json.Read();

        var includedItem = Assert.Single(result.AllowedItems);
        Assert.Equal("from-fragment", includedItem.Name);
    }

    [Fact]
    public void Read_RejectsPresetOutsidePresettableProperty() {
        using var sandbox = new TempDir();
        var settingsPath = Path.Combine(sandbox.Path, "settings.json");
        var presetRoot = Path.Combine(sandbox.Path, "_allowed-model");
        _ = Directory.CreateDirectory(presetRoot);
        File.WriteAllText(
            Path.Combine(presetRoot, "base.json"),
            """
            {
              "RequiredName": "preset-model"
            }
            """
        );
        File.WriteAllText(
            settingsPath,
            """
            {
              "$schema": "./schema.json",
              "DisallowedModel": {
                "$preset": "@local/_allowed-model/base"
              }
            }
            """
        );

        var json = new ComposableJson<PresetScopedSettings>(settingsPath, sandbox.Path, JsonBehavior.Settings);
        var exception = Assert.Throws<JsonValidationException>(json.Read);
        Assert.NotNull(exception);
    }

    [Fact]
    public void Read_AllowsPresetOnPresettableProperty() {
        using var sandbox = new TempDir();
        var settingsPath = Path.Combine(sandbox.Path, "settings.json");
        var presetRoot = Path.Combine(sandbox.Path, "_allowed-model");
        _ = Directory.CreateDirectory(presetRoot);
        File.WriteAllText(
            Path.Combine(presetRoot, "base.json"),
            """
            {
              "RequiredName": "preset-model"
            }
            """
        );
        File.WriteAllText(
            settingsPath,
            """
            {
              "$schema": "./schema.json",
              "AllowedModel": {
                "$preset": "@local/_allowed-model/base"
              }
            }
            """
        );

        var json = new ComposableJson<PresetScopedSettings>(settingsPath, sandbox.Path, JsonBehavior.Settings);
        var result = json.Read();

        Assert.Equal("preset-model", result.AllowedModel.RequiredName);
    }

    [Fact]
    public void Read_DoesNotRewriteFragmentWhenSchemaContentIsUnchanged() {
        using var sandbox = new TempDir();
        var settingsPath = Path.Combine(sandbox.Path, "settings.json");
        var fragmentRoot = Path.Combine(sandbox.Path, "_allowed-items");
        _ = Directory.CreateDirectory(fragmentRoot);
        var fragmentPath = Path.Combine(fragmentRoot, "item-a.json");
        File.WriteAllText(
            fragmentPath,
            """
            {
              "Items": [
                { "Name": "from-fragment" }
              ]
            }
            """
        );
        File.WriteAllText(
            settingsPath,
            """
            {
              "AllowedItems": [
                { "$include": "@local/_allowed-items/item-a" }
              ]
            }
            """
        );

        var json = new ComposableJson<IncludeScopedSettings>(settingsPath, sandbox.Path, JsonBehavior.Settings);
        _ = json.Read();
        var firstContent = File.ReadAllText(fragmentPath);
        var firstWriteUtc = File.GetLastWriteTimeUtc(fragmentPath);

        Thread.Sleep(1100);

        _ = json.Read();
        var secondContent = File.ReadAllText(fragmentPath);
        var secondWriteUtc = File.GetLastWriteTimeUtc(fragmentPath);

        Assert.Equal(firstContent, secondContent);
        Assert.Equal(firstWriteUtc, secondWriteUtc);
        Assert.False(File.Exists(Path.Combine(fragmentRoot, "fragment.schema.json")));
        var fragmentSchemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            sandbox.Path,
            SettingsPathing.DirectiveScope.Local,
            isPresetDirective: false,
            rootSegment: "_allowed-items"
        );
        Assert.True(File.Exists(fragmentSchemaPath));
    }

    [Fact]
    public void Read_ReinjectsSchemaToCentralizedGlobalPath_ForNestedProfileFile() {
        using var sandbox = new TempDir();
        var profilesRoot = Path.Combine(sandbox.Path, "CmdFFMigrator", "settings", "profiles");
        var profileDirectory = Path.Combine(profilesRoot, "MechEquip");
        _ = Directory.CreateDirectory(profileDirectory);
        var settingsPath = Path.Combine(profileDirectory, "settings.json");
        File.WriteAllText(
            settingsPath,
            """
            {
              "$schema": "./schema.json",
              "AllowedItems": []
            }
            """
        );

        var json = new ComposableJson<IncludeScopedSettings>(settingsPath, profilesRoot, JsonBehavior.Settings);
        _ = json.Read();

        var updatedRoot = JObject.Parse(File.ReadAllText(settingsPath));
        var expectedSchemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(profilesRoot, typeof(IncludeScopedSettings));
        Assert.Equal(GetExpectedSchemaReference(settingsPath, expectedSchemaPath), updatedRoot["$schema"]?.Value<string>());
        Assert.True(File.Exists(expectedSchemaPath));
        Assert.False(File.Exists(Path.Combine(profileDirectory, "schema.json")));
        Assert.False(File.Exists(Path.Combine(profilesRoot, "schema.json")));
    }

    [Fact]
    public void Read_IgnoresInvalidAuthoringSchemaReference_DuringRuntimeValidation() {
        using var sandbox = new TempDir();
        var profilesRoot = Path.Combine(sandbox.Path, "CmdFFMigrator", "settings", "profiles");
        _ = Directory.CreateDirectory(profilesRoot);
        var settingsPath = Path.Combine(profilesRoot, "settings.json");
        File.WriteAllText(
            settingsPath,
            """
            {
              "$schema": "./does-not-exist.schema.json",
              "AllowedItems": []
            }
            """
        );

        var json = new ComposableJson<IncludeScopedSettings>(settingsPath, profilesRoot, JsonBehavior.Settings);
        var result = json.Read();

        Assert.Empty(result.AllowedItems);
        var updatedRoot = JObject.Parse(File.ReadAllText(settingsPath));
        var expectedSchemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(profilesRoot, typeof(IncludeScopedSettings));
        Assert.Equal(GetExpectedSchemaReference(settingsPath, expectedSchemaPath), updatedRoot["$schema"]?.Value<string>());
    }

    [Fact]
    public void Write_DoesNotRewriteCentralSchema_WhenSchemaIsUnchanged() {
        using var sandbox = new TempDir();
        var profilesRoot = Path.Combine(sandbox.Path, "CmdFFMigrator", "settings", "profiles");
        _ = Directory.CreateDirectory(profilesRoot);
        var settingsPath = Path.Combine(profilesRoot, "settings.json");

        var json = new ComposableJson<TestData>(settingsPath, profilesRoot, JsonBehavior.Settings);
        _ = json.Write(new TestData { Name = "stable" });

        var schemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(profilesRoot, typeof(TestData));
        var firstWriteUtc = File.GetLastWriteTimeUtc(schemaPath);

        Thread.Sleep(1100);

        _ = json.Write(new TestData { Name = "stable" });
        var secondWriteUtc = File.GetLastWriteTimeUtc(schemaPath);

        Assert.Equal(firstWriteUtc, secondWriteUtc);
    }

    private sealed class TestData {
        public string Name { get; set; } = string.Empty;
    }

    private sealed class IncludeScopedSettings {
        [Includable("allowed-items")]
        public List<IncludeItem> AllowedItems { get; init; } = [];
        public List<IncludeItem> DisallowedItems { get; init; } = [];
    }

    private sealed class IncludeItem {
        [Required]
        public string Name { get; init; } = string.Empty;
    }

    private sealed class PresetScopedSettings {
        [Presettable("allowed-model")]
        public PresetModel AllowedModel { get; init; } = new();
        public PresetModel DisallowedModel { get; init; } = new();
    }

    private sealed class PresetModel {
        [Required]
        public string RequiredName { get; init; } = string.Empty;
    }

    private sealed class TempDir : IDisposable {
        public TempDir() {
            this.Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"composable-json-contract-{Guid.NewGuid():N}");
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

    private static string GetExpectedSchemaReference(string targetFilePath, string schemaPath) {
        var targetDirectory = Path.GetDirectoryName(targetFilePath)!;
        var relativePath = BclExtensions.GetRelativePath(targetDirectory, schemaPath).Replace("\\", "/");
        return relativePath.StartsWith("./", StringComparison.Ordinal) || relativePath.StartsWith("../", StringComparison.Ordinal)
            ? relativePath
            : $"./{relativePath}";
    }
}
