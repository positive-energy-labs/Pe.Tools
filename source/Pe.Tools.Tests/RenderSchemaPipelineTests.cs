using Newtonsoft.Json.Linq;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Json.SchemaProcessors;

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
        public string ProviderBacked { get; init; } = string.Empty;

        [Includable(IncludableFragmentRoot.TestItems)]
        public List<string> Items { get; init; } = [];

        public bool Enabled { get; init; }
    }

    private sealed class RenderSchemaTestSettingsDefinition : SettingsSchemaDefinition<RenderSchemaTestSettings> {
        public override void Configure(ISettingsSchemaBuilder<RenderSchemaTestSettings> builder) {
            builder.Property(item => item.ProviderBacked, property => property.UseFieldOptions<TestOptionsProvider>());
        }
    }

    private sealed class RenderSchemaDatasetTestSettings {
        public string ProviderBacked { get; init; } = string.Empty;
    }

    private sealed class LightweightRenderSchemaTestSettings {
        public string ProviderBacked { get; init; } = string.Empty;
    }

    private sealed class RenderSchemaDatasetTestSettingsDefinition
        : SettingsSchemaDefinition<RenderSchemaDatasetTestSettings> {
        public override void Configure(ISettingsSchemaBuilder<RenderSchemaDatasetTestSettings> builder) {
            builder.Property(item => item.ProviderBacked, property => property.UseFieldOptions<TestDatasetOptionsProvider>());
        }
    }

    private sealed class LightweightRenderSchemaTestSettingsDefinition
        : SettingsSchemaDefinition<LightweightRenderSchemaTestSettings> {
        public override void Configure(ISettingsSchemaBuilder<LightweightRenderSchemaTestSettings> builder) {
            builder.Property(item => item.ProviderBacked, property => property.UseFieldOptions<CountingOptionsProvider>());
        }
    }

    private sealed class TestOptionsProvider : IFieldOptionsSource {
        public FieldOptionsDescriptor Describe() => new(
            nameof(TestOptionsProvider),
            SettingsOptionsResolverKind.Remote,
            null,
            SettingsOptionsMode.Suggestion,
            true,
            [],
            SettingsRuntimeCapabilityProfiles.LiveDocument
        );

        public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
            FieldOptionsExecutionContext context,
            CancellationToken cancellationToken = default
        ) => ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([
            new("A", "A", null),
            new("B", "B", null)
        ]);
    }

    private sealed class TestDatasetOptionsProvider : IFieldOptionsSource {
        public FieldOptionsDescriptor Describe() => new(
            nameof(TestDatasetOptionsProvider),
            SettingsOptionsResolverKind.Dataset,
            SettingsOptionsDatasetKind.ParameterCatalog,
            SettingsOptionsMode.Suggestion,
            true,
            [],
            SettingsRuntimeCapabilityProfiles.LiveDocument
        );

        public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
            FieldOptionsExecutionContext context,
            CancellationToken cancellationToken = default
        ) => ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([
            new("A", "A", null),
            new("B", "B", null)
        ]);
    }

    private sealed class CountingOptionsProvider : IFieldOptionsSource {
        public static int ExampleCallCount { get; set; }

        public FieldOptionsDescriptor Describe() => new(
            nameof(CountingOptionsProvider),
            SettingsOptionsResolverKind.Remote,
            null,
            SettingsOptionsMode.Suggestion,
            true,
            [],
            SettingsRuntimeCapabilityProfiles.LiveDocument
        );

        public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
            FieldOptionsExecutionContext context,
            CancellationToken cancellationToken = default
        ) {
            ExampleCallCount++;
            return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([
                new("A", "A", null),
                new("B", "B", null)
            ]);
        }
    }

    private sealed class RenderPresetSchemaTestSettings {
        [Presettable("preset-model")] public RenderPresetModel Model { get; init; } = new();
    }

    private sealed class RenderPresetModel {
        public bool Enabled { get; init; } = true;
    }

    private static JsonSchemaBuildOptions CreateOptions(bool resolveExamples = false) {
        EnsureDefinitionsRegistered();
        return new(SettingsRuntimeCapabilityProfiles.LiveDocument) {
            ResolveFieldOptionSamples = resolveExamples
        };
    }

    private static void EnsureDefinitionsRegistered() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new RenderSchemaTestSettingsDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new RenderSchemaDatasetTestSettingsDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new LightweightRenderSchemaTestSettingsDefinition());
    }
}
