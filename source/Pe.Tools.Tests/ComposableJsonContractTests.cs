using Newtonsoft.Json.Linq;
using Pe.StorageRuntime;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.PolyFill;
using Pe.StorageRuntime.Revit.Core.Json;
using System.ComponentModel.DataAnnotations;
using RuntimeJsonValidationException = Pe.StorageRuntime.Revit.Core.Json.JsonValidationException;

namespace Pe.Tools.Tests;

public sealed class ComposableJsonContractTests : RevitTestBase {
    [Test]
    public async Task Write_ReturnsFilePath() {
        using var sandbox = new TempDir();
        var filePath = Path.Combine(sandbox.Path, "output.json");
        var json = new ComposableJson<TestData>(filePath, sandbox.Path, JsonBehavior.Output);

        var result = json.Write(new TestData { Name = "ok" });

        await Assert.That(result).IsEqualTo(filePath);
        await Assert.That(File.Exists(filePath)).IsTrue();
    }

    [Test]
    public async Task Read_RejectsIncludeOutsideIncludableProperty() {
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
        _ = await Assert.That(json.Read).Throws<RuntimeJsonValidationException>();
    }

    [Test]
    public async Task Read_RejectsPresetOutsidePresettableProperty() {
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
        _ = await Assert.That(json.Read).Throws<RuntimeJsonValidationException>();
    }

    [Test]
    public async Task Read_ReinjectsSchemaToCentralizedGlobalPath_ForNestedProfileFile() {
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
        var expectedSchemaPath =
            SettingsPathing.ResolveCentralizedProfileSchemaPath(profilesRoot, typeof(IncludeScopedSettings));
        await Assert.That(updatedRoot["$schema"]?.Value<string>())
            .IsEqualTo(GetExpectedSchemaReference(settingsPath, expectedSchemaPath));
        await Assert.That(File.Exists(expectedSchemaPath)).IsTrue();
        await Assert.That(File.Exists(Path.Combine(profileDirectory, "schema.json"))).IsFalse();
        await Assert.That(File.Exists(Path.Combine(profilesRoot, "schema.json"))).IsFalse();
    }

    [Test]
    public async Task Read_State_IgnoresStaleSchemaValidationAndRewritesWithoutSchema() {
        using var sandbox = new TempDir();
        var statePath = Path.Combine(sandbox.Path, "settings.json");
        File.WriteAllText(
            statePath,
            """
            {
              "$schema": "./schema.json"
            }
            """
        );

        var json = new ComposableJson<StateContract>(statePath, sandbox.Path, JsonBehavior.State);
        var result = json.Read();

        await Assert.That(result.RequiredName).IsEqualTo(string.Empty);

        var persisted = JObject.Parse(File.ReadAllText(statePath));
        await Assert.That(persisted.Property("$schema")).IsNull();
    }

    [Test]
    public async Task Write_DoesNotRewriteCentralSchema_WhenSchemaIsUnchanged() {
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

        await Assert.That(secondWriteUtc).IsEqualTo(firstWriteUtc);
    }

    private static string GetExpectedSchemaReference(string targetFilePath, string schemaPath) {
        var targetDirectory = Path.GetDirectoryName(targetFilePath)!;
        var relativePath = BclExtensions.GetRelativePath(targetDirectory, schemaPath).Replace("\\", "/");
        return relativePath.StartsWith("./", StringComparison.Ordinal) ||
               relativePath.StartsWith("../", StringComparison.Ordinal)
            ? relativePath
            : $"./{relativePath}";
    }

    private sealed class TestData {
        public string Name { get; set; } = string.Empty;
    }

    private sealed class IncludeScopedSettings {
        [Includable("allowed-items")] public List<IncludeItem> AllowedItems { get; init; } = [];

        public List<IncludeItem> DisallowedItems { get; init; } = [];
    }

    private sealed class IncludeItem {
        [Required] public string Name { get; init; } = string.Empty;
    }

    private sealed class PresetScopedSettings {
        [Presettable("allowed-model")] public PresetModel AllowedModel { get; init; } = new();

        public PresetModel DisallowedModel { get; init; } = new();
    }

    private sealed class PresetModel {
        [Required] public string RequiredName { get; init; } = string.Empty;
    }

    private sealed class StateContract {
        [Required] public string RequiredName { get; init; } = string.Empty;
    }

    private sealed class TempDir : IDisposable {
        public TempDir() {
            this.Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(),
                $"composable-json-contract-{Guid.NewGuid():N}");
            _ = Directory.CreateDirectory(this.Path);
        }

        public string Path { get; }

        public void Dispose() {
            try {
                Directory.Delete(this.Path, true);
            } catch {
                // ignore cleanup failures in tests
            }
        }
    }
}
