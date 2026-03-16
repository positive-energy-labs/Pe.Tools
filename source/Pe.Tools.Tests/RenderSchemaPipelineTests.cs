using Newtonsoft.Json.Linq;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.SchemaProcessors;
using Pe.StorageRuntime.Revit.Core.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProcessors;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

namespace Pe.Tools.Tests;

public sealed class RenderSchemaPipelineTests : RevitTestBase {
    [Test]
    public async Task CreateRenderSchema_removes_examples_for_provider_backed_fields() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(typeof(RenderSchemaTestSettings), CreateOptions());
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;

        await Assert.That(providerBacked).IsNotNull();
        await Assert.That(providerBacked!["x-options"]).IsNotNull();
        await Assert.That(providerBacked["examples"]).IsNull();
    }

    [Test]
    public async Task CreateRenderSchema_emits_single_field_options_descriptor() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(typeof(RenderSchemaTestSettings), CreateOptions());
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;
        var source = providerBacked?["x-options"] as JObject;

        await Assert.That(providerBacked).IsNotNull();
        await Assert.That(source).IsNotNull();
        await Assert.That(source!["key"]?.Value<string>()).IsEqualTo(nameof(TestOptionsProvider));
        await Assert.That(source["resolver"]?.Value<string>()).IsEqualTo("Remote");
        await Assert.That(source["dataset"]?.Value<string>()).IsNull();
    }

    [Test]
    public async Task CreateRenderSchema_emits_dataset_hint_for_dataset_backed_provider() {
        var schemaJson =
            JsonSchemaFactory.CreateEditorSchemaJson(typeof(RenderSchemaDatasetTestSettings), CreateOptions());
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;
        var source = providerBacked?["x-options"] as JObject;

        await Assert.That(providerBacked).IsNotNull();
        await Assert.That(source).IsNotNull();
        await Assert.That(source!["key"]?.Value<string>()).IsEqualTo(nameof(TestDatasetOptionsProvider));
        await Assert.That(source["resolver"]?.Value<string>()).IsEqualTo("Dataset");
        await Assert.That(source["dataset"]?.Value<string>()).IsEqualTo("ParameterCatalog");
    }

    [Test]
    public async Task CreateRenderSchema_preserves_includable_item_union_for_frontend_schema_engines() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(typeof(RenderSchemaTestSettings), CreateOptions());
        var root = JObject.Parse(schemaJson);
        var itemsSchema = root["properties"]?["Items"]?["items"] as JObject;

        await Assert.That(itemsSchema).IsNotNull();
        await Assert.That(itemsSchema!["oneOf"]).IsNotNull();
    }

    [Test]
    public async Task CreateRenderSchema_injects_defaults_from_default_instance_values() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(typeof(RenderSchemaTestSettings), CreateOptions());
        var root = JObject.Parse(schemaJson);
        var enabledSchema = root["properties"]?["Enabled"] as JObject;
        var providerBackedSchema = root["properties"]?["ProviderBacked"] as JObject;
        var itemsSchema = root["properties"]?["Items"] as JObject;

        await Assert.That(enabledSchema).IsNotNull();
        await Assert.That(providerBackedSchema).IsNotNull();
        await Assert.That(itemsSchema).IsNotNull();
        await Assert.That(enabledSchema!["default"]?.Value<bool>()).IsEqualTo(false);
        await Assert.That(providerBackedSchema!["default"]?.Value<string>()).IsEqualTo(string.Empty);
        await Assert.That(itemsSchema!["default"] is JArray).IsTrue();
    }

    [Test]
    public async Task Lightweight_render_schema_skips_provider_example_resolution_but_keeps_field_option_metadata() {
        CountingOptionsProvider.ExampleCallCount = 0;

        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(
            typeof(LightweightRenderSchemaTestSettings),
            CreateOptions(false)
        );
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;

        await Assert.That(providerBacked).IsNotNull();
        await Assert.That(providerBacked!["x-options"]).IsNotNull();
        await Assert.That(CountingOptionsProvider.ExampleCallCount).IsEqualTo(0);
    }

    [Test]
    public async Task CreateFragmentSchema_can_be_finalized_and_transformed_for_rendering() {
        var fragmentSchema = JsonSchemaFactory.BuildFragmentSchema(typeof(RenderSchemaTestSettings), CreateOptions());

        var json = EditorSchemaTransformer.TransformFragmentToEditorJson(fragmentSchema);
        var root = JObject.Parse(json);
        var itemsSchema = root["properties"]?["Items"] as JObject;

        await Assert.That(itemsSchema).IsNotNull();
        await Assert.That(itemsSchema!["type"]?.Value<string>()).IsEqualTo("array");
        await Assert.That(itemsSchema["default"] is JArray).IsTrue();
    }

    [Test]
    public async Task CreateRenderSchema_AllowsPresetProperty_ForPresettableObjects() {
        var schemaJson =
            JsonSchemaFactory.CreateEditorSchemaJson(typeof(RenderPresetSchemaTestSettings), CreateOptions());
        var root = JObject.Parse(schemaJson);
        var modelSchema = root["properties"]?["Model"] as JObject;
        var oneOf = modelSchema?["oneOf"] as JArray;
        var presetBranch = oneOf?.OfType<JObject>()
            .FirstOrDefault(branch => branch["properties"]?["$preset"] != null);
        var presetSchema = presetBranch?["properties"]?["$preset"] as JObject;

        await Assert.That(modelSchema).IsNotNull();
        await Assert.That(oneOf).IsNotNull();
        await Assert.That(presetSchema).IsNotNull();
        await Assert.That(presetSchema!["type"]?.Value<string>()).IsEqualTo("string");
        await Assert.That(presetBranch?["required"]?.Values<string>() ?? []).Contains("$preset");
    }

    private sealed class RenderSchemaTestSettings {
        [SchemaExamples(typeof(TestOptionsProvider))]
        public string ProviderBacked { get; init; } = string.Empty;

        [Includable(IncludableFragmentRoot.TestItems)]
        public List<string> Items { get; init; } = [];

        public bool Enabled { get; init; }
    }

    private sealed class TestOptionsProvider : IOptionsProvider {
        public IEnumerable<string> GetExamples(SettingsProviderContext context) => ["A", "B"];
    }

    private sealed class RenderSchemaDatasetTestSettings {
        [SchemaExamples(typeof(TestDatasetOptionsProvider))]
        public string ProviderBacked { get; init; } = string.Empty;
    }

    private sealed class LightweightRenderSchemaTestSettings {
        [SchemaExamples(typeof(CountingOptionsProvider))]
        public string ProviderBacked { get; init; } = string.Empty;
    }

    private sealed class TestDatasetOptionsProvider : IOptionsProvider, IFieldOptionsClientHintProvider {
        public SettingsOptionsResolverKind Resolver => SettingsOptionsResolverKind.Dataset;
        public SettingsOptionsDatasetKind? Dataset => SettingsOptionsDatasetKind.ParameterCatalog;
        public IEnumerable<string> GetExamples(SettingsProviderContext context) => ["A", "B"];
    }

    private sealed class CountingOptionsProvider : IOptionsProvider {
        public static int ExampleCallCount { get; set; }

        public IEnumerable<string> GetExamples(SettingsProviderContext context) {
            ExampleCallCount++;
            return ["A", "B"];
        }
    }

    private sealed class RenderPresetSchemaTestSettings {
        [Presettable("preset-model")] public RenderPresetModel Model { get; init; } = new();
    }

    private sealed class RenderPresetModel {
        public bool Enabled { get; init; } = true;
    }

    private static JsonSchemaBuildOptions CreateOptions(bool resolveExamples = false) =>
        new(new SettingsProviderContext(SettingsCapabilityTier.LiveRevitDocument)) {
            ResolveExamples = resolveExamples
        };
}
