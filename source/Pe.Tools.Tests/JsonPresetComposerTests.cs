using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core.Json;
using System.ComponentModel.DataAnnotations;

namespace Pe.Tools.Tests;

public sealed class JsonPresetComposerTests : RevitTestBase
{
    [Test]
    public async Task ExpandPresets_RejectsInlineOverridesWhenPresetIsPresent()
    {
        using var sandbox = new TempDir();
        var presetsDir = Path.Combine(sandbox.Path, "_filter-aps-params");
        _ = Directory.CreateDirectory(presetsDir);
        File.WriteAllText(
            Path.Combine(presetsDir, "base.json"),
            """
            {
              "Enabled": true,
              "IncludeNames": {
                "Equaling": ["PE_G_Dim_Height1"],
                "StartingWith": ["PE_G___"]
              },
              "ExcludeNames": {
                "Equaling": ["PE_G___Fluid"]
              }
            }
            """
        );

        var root = JObject.Parse(
            """
            {
              "FilterApsParams": {
                "$preset": "@local/_filter-aps-params/base",
                "Enabled": false,
                "IncludeNames": {
                  "Equaling": ["PE_G_Dim_Width1"]
                }
              }
            }
            """
        );

        var exception = (await Assert.That(() => JsonPresetComposer.ExpandPresets(root, sandbox.Path, ["_filter-aps-params"]))
            .Throws<JsonCompositionException>())!;
        await Assert.That(exception.Message)
            .Contains("Preset composition does not support inline overrides")
            .WithComparison(StringComparison.Ordinal);
    }

    [Test]
    public async Task ExpandPresets_ReplacesEntireObject_WhenPresetOnlyIsUsed()
    {
        using var sandbox = new TempDir();
        var presetsDir = Path.Combine(sandbox.Path, "_filter-aps-params");
        _ = Directory.CreateDirectory(presetsDir);
        File.WriteAllText(
            Path.Combine(presetsDir, "base.json"),
            """
            {
              "Enabled": true,
              "IncludeNames": {
                "Equaling": ["PE_G_Dim_Height1"],
                "StartingWith": ["PE_G___"]
              },
              "ExcludeNames": {
                "Equaling": ["PE_G___Fluid"]
              }
            }
            """
        );

        var root = JObject.Parse(
            """
            {
              "FilterApsParams": {
                "$preset": "@local/_filter-aps-params/base"
              }
            }
            """
        );

        _ = JsonPresetComposer.ExpandPresets(root, sandbox.Path, ["_filter-aps-params"]);

        var filter = (JObject)root["FilterApsParams"]!;
        await Assert.That(filter["Enabled"]!.Value<bool>()).IsTrue();
        await Assert.That(filter["IncludeNames"]!["Equaling"]![0]!.Value<string>()).IsEqualTo("PE_G_Dim_Height1");
        await Assert.That(filter["IncludeNames"]!["StartingWith"]![0]!.Value<string>()).IsEqualTo("PE_G___");
    }

    [Test]
    public async Task ExpandPresets_RejectsBareLocalPath()
    {
        using var sandbox = new TempDir();
        var root = JObject.Parse(
            """
            {
              "FilterApsParams": {
                "$preset": "_filter-aps-params/base"
              }
            }
            """
        );

        var exception = (await Assert.That(() => JsonPresetComposer.ExpandPresets(root, sandbox.Path, ["_filter-aps-params"]))
            .Throws<JsonCompositionException>())!;
        await Assert.That(exception.Message).Contains("Invalid '$preset' path").WithComparison(StringComparison.Ordinal);
    }

    [Test]
    public async Task ExpandPresets_DetectsCircularPresetIncludes()
    {
        using var sandbox = new TempDir();
        var presetsDir = Path.Combine(sandbox.Path, "_filter-aps-params");
        _ = Directory.CreateDirectory(presetsDir);

        File.WriteAllText(
            Path.Combine(presetsDir, "a.json"),
            """
            {
              "$preset": "@local/_filter-aps-params/b"
            }
            """
        );
        File.WriteAllText(
            Path.Combine(presetsDir, "b.json"),
            """
            {
              "$preset": "@local/_filter-aps-params/a"
            }
            """
        );

        var root = JObject.Parse(
            """
            {
              "FilterApsParams": {
                "$preset": "@local/_filter-aps-params/a"
              }
            }
            """
        );

        var exception = (await Assert.That(() => JsonPresetComposer.ExpandPresets(root, sandbox.Path, ["_filter-aps-params"]))
            .Throws<JsonCompositionException>())!;
        await Assert.That(exception.Message)
            .Contains("Circular preset include detected")
            .WithComparison(StringComparison.Ordinal);
    }

    [Test]
    public async Task ComposableJson_ValidatesRequiredFieldsAfterPresetExpansion()
    {
        using var sandbox = new TempDir();
        var settingsPath = Path.Combine(sandbox.Path, "settings.json");
        var presetsDir = Path.Combine(sandbox.Path, "_preset-model");
        _ = Directory.CreateDirectory(presetsDir);

        File.WriteAllText(
            Path.Combine(presetsDir, "missing-required.json"),
            """
            {
              "Enabled": true
            }
            """
        );
        File.WriteAllText(
            settingsPath,
            """
            {
              "Model": {
                "$preset": "@local/_preset-model/missing-required"
              }
            }
            """
        );

        var json = new ComposableJson<PresetContainer>(settingsPath, sandbox.Path, JsonBehavior.Settings);
        _ = await Assert.That(json.Read).Throws<JsonValidationException>();
    }

    private sealed class PresetContainer
    {
        [Required]
        [Presettable("preset-model")]
        public PresetModel Model { get; init; } = new();
    }

    private sealed class PresetModel
    {
        [Required]
        public string RequiredName { get; init; } = string.Empty;
        public bool Enabled { get; init; } = true;
    }

    private sealed class TempDir : IDisposable
    {
        public TempDir()
        {
            this.Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"preset-composer-test-{Guid.NewGuid():N}");
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
