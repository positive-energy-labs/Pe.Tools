using Newtonsoft.Json.Linq;
using Pe.Global.Revit.Lib.Schedules.Filters;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Json.SchemaProcessors;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Core.Json;
using Pe.StorageRuntime.Revit.Validation;

namespace Pe.Tools.Tests;

public sealed class RenderSchemaPipelineTests : RevitTestBase {
    [Test]
    public async Task CreateRenderSchema_preserves_examples_for_provider_backed_fields() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(typeof(RenderSchemaTestSettings), CreateOptions());
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;
        var examples = providerBacked?["examples"] as JArray;

        await Assert.That(providerBacked).IsNotNull();
        await Assert.That(providerBacked!["x-options"]).IsNotNull();
        await Assert.That(examples).IsNotNull();
        await Assert.That(examples!.Values<string>()).Contains("A");
        await Assert.That(examples.Values<string>()).Contains("B");
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
    public async Task CreateRenderSchema_resolves_provider_examples_by_default() {
        CountingOptionsProvider.ExampleCallCount = 0;

        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(
            typeof(LightweightRenderSchemaTestSettings),
            CreateOptions()
        );
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;
        var examples = providerBacked?["examples"] as JArray;

        await Assert.That(providerBacked).IsNotNull();
        await Assert.That(examples).IsNotNull();
        await Assert.That(CountingOptionsProvider.ExampleCallCount).IsEqualTo(1);
        await Assert.That(examples!.Values<string>()).Contains("A");
        await Assert.That(examples.Values<string>()).Contains("B");
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

    [Test]
    public async Task CreateRenderSchema_emits_x_ui_table_metadata() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(
            typeof(TableRenderSchemaTestSettings),
            CreateOptions()
        );
        var root = JObject.Parse(schemaJson);
        var tableSchema = root["properties"]?["Rows"] as JObject;
        var ui = tableSchema?["x-ui"] as JObject;
        var behavior = ui?["behavior"] as JObject;
        var dynamicColumnOrder = behavior?["dynamicColumnOrder"] as JObject;

        await Assert.That(tableSchema).IsNotNull();
        await Assert.That(ui).IsNotNull();
        await Assert.That(ui!["renderer"]?.Value<string>()).IsEqualTo("table");
        await Assert.That(behavior).IsNotNull();
        await Assert.That(behavior!["fixedColumns"]?.Values<string>() ?? []).Contains("Parameter");
        await Assert.That(behavior["dynamicColumnsFromAdditionalProperties"]?.Value<bool>()).IsEqualTo(true);
        await Assert.That(behavior["missingValue"]?.Value<string>()).IsEqualTo("-");
        await Assert.That(dynamicColumnOrder).IsNotNull();
        await Assert.That(dynamicColumnOrder!["source"]?.Value<string>()).IsEqualTo("testOrder");
        await Assert.That(dynamicColumnOrder["values"]?.Values<string>() ?? []).Contains("Type A");
        await Assert.That(dynamicColumnOrder["values"]?.Values<string>() ?? []).Contains("Type B");
    }

    [Test]
    public async Task RequiredAware_serializer_omits_required_properties_when_they_match_defaults() {
        var settings = new RequiredDefaultsRootSettings();
        var json = RevitJsonFormatting.SerializeIndented(
            settings,
            RevitJsonFormatting.CreateRequiredAwareRevitIndentedSettings()
        );
        var root = JObject.Parse(json);

        await Assert.That(root["Filter"]).IsNull();
    }

    [Test]
    public async Task SchemaBacked_validator_accepts_sparse_authoring_json_when_defaults_fill_required_shape() {
        var validator = new SchemaBackedSettingsDocumentValidator(
            typeof(RequiredDefaultsRootSettings),
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
        );
        var documentId = new SettingsDocumentId("test", "profiles", "required-defaults.json");

        var validation = validator.Validate(documentId, "{}", null);

        await Assert.That(validation.IsValid).IsTrue();
    }

    [Test]
    public async Task CreateRenderSchema_serializes_string_enum_defaults_as_strings() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(
            typeof(PresetValidationRootSettings),
            CreateOptions()
        );
        var root = JObject.Parse(schemaJson);
        var filterTypeDefault = root["properties"]?["Model"]?["default"]?["FilterType"];

        await Assert.That(filterTypeDefault).IsNotNull();
        await Assert.That(filterTypeDefault!.Type).IsEqualTo(JTokenType.String);
        await Assert.That(filterTypeDefault.Value<string>()).IsEqualTo("Equal");
    }

    [Test]
    public async Task CreateRenderSchema_emits_string_enum_schema_without_system_text_json_annotations() {
        var schemaJson = JsonSchemaFactory.CreateEditorSchemaJson(
            typeof(ProfileWithFilterFamiliesSettings),
            CreateOptions()
        );
        var root = JObject.Parse(schemaJson);
        var scheduleFilterTypeSchema = root["definitions"]?["ScheduleFilterType"] as JObject;

        await Assert.That(scheduleFilterTypeSchema).IsNotNull();
        await Assert.That(scheduleFilterTypeSchema!["type"]?.Value<string>()).IsEqualTo("string");
        await Assert.That(scheduleFilterTypeSchema["enum"]?.Values<string>() ?? []).Contains("Equal");
    }

    [Test]
    public async Task SchemaBacked_validator_prefers_the_matching_one_of_branch_for_user_facing_errors() {
        var validator = new SchemaBackedSettingsDocumentValidator(
            typeof(PresetValidationRootSettings),
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
        );
        var documentId = new SettingsDocumentId("test", "profiles", "preset-validation.json");
        var rawContent = """
                         {
                           "Model": {
                             "FieldName": "My Field",
                             "FilterType": 2,
                             "Value": "ABC"
                           }
                         }
                         """;

        var validation = validator.Validate(documentId, rawContent, null);

        await Assert.That(validation.IsValid).IsFalse();
        await Assert.That(validation.Issues.Any(issue => issue.Path == "$.Model.$preset")).IsFalse();
        await Assert.That(validation.Issues.Any(issue =>
            issue.Path.StartsWith("$.Model.", StringComparison.Ordinal) &&
            issue.Code == "NoAdditionalPropertiesAllowed")).IsFalse();
        await Assert.That(validation.Issues.Any(issue => issue.Path == "$.Model.FilterType")).IsTrue();
    }

    [Test]
    public async Task SchemaBacked_validator_materializes_string_enum_defaults_for_nested_objects() {
        var validator = new SchemaBackedSettingsDocumentValidator(
            typeof(ProfileWithFilterFamiliesSettings),
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
        );
        var documentId = new SettingsDocumentId("test", "profiles", "filter-families-defaults.json");
        var rawContent = """
                         {
                           "FilterFamilies": {
                             "IncludeCategoriesEqualing": [],
                             "IncludeByCondition": {},
                             "IncludeNames": {
                               "Equaling": []
                             },
                             "ExcludeNames": {}
                           }
                         }
                         """;

        var validation = validator.Validate(documentId, rawContent, null);

        await Assert.That(validation.IsValid).IsTrue();
    }

    [Test]
    public async Task SynchronizeContentForSave_prunes_properties_that_match_schema_defaults() {
        var service = new SettingsDocumentSchemaSyncService(SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly);
        var schemaDirectory = Path.Combine(Path.GetTempPath(), "pe-tools-schema-sync-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(schemaDirectory);

        try {
            var rawContent = """
                             {
                               "Filter": {
                                 "Equaling": [],
                                 "Containing": []
                               }
                             }
                             """;
            var normalizedContent = service.SynchronizeContentForSave(
                typeof(RequiredDefaultsRootSettings),
                SettingsStorageModuleOptions.Empty,
                rawContent,
                Path.Combine(schemaDirectory, "required-defaults.json"),
                schemaDirectory
            );
            var root = JObject.Parse(normalizedContent);

            await Assert.That(root["Filter"]).IsNull();
            await Assert.That(root["$schema"]).IsNotNull();
        } finally {
            if (Directory.Exists(schemaDirectory))
                Directory.Delete(schemaDirectory, recursive: true);
        }
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

    private sealed class TableRenderSchemaTestSettings {
        public List<TableRenderSchemaRow> Rows { get; init; } = [];
    }

    private sealed class TableRenderSchemaRow {
        public string Parameter { get; init; } = string.Empty;
    }

    private sealed class RequiredDefaultsRootSettings {
        public required RequiredDefaultsFilterSettings Filter { get; init; } = new();
    }

    private sealed class RequiredDefaultsFilterSettings {
        public required List<string> Equaling { get; init; } = [];
        public required List<string> Containing { get; init; } = [];
    }

    private sealed class TableRenderSchemaTestSettingsDefinition
        : SettingsSchemaDefinition<TableRenderSchemaTestSettings> {
        public override void Configure(ISettingsSchemaBuilder<TableRenderSchemaTestSettings> builder) {
            builder.Property(item => item.Rows, property => property.Ui(ui => {
                ui.Renderer(SchemaUiRendererKeys.Table);
                ui.Behavior(behavior => {
                    behavior.FixedColumns<TableRenderSchemaRow>(row => row.Parameter);
                    behavior.DynamicColumnsFromAdditionalProperties();
                    behavior.MissingValue("-");
                    behavior.DynamicColumnOrder<TestColumnOrderSource>();
                });
            }));
        }
    }

    private sealed class TestColumnOrderSource : ISchemaUiDynamicColumnOrderSource {
        public string Key => "testOrder";

        public SettingsRuntimeCapabilities RequiredCapabilities =>
        SettingsRuntimeCapabilityProfiles.LiveDocument;

        public ValueTask<IReadOnlyList<string>> GetValuesAsync(
            FieldOptionsExecutionContext context,
            CancellationToken cancellationToken = default
        ) => ValueTask.FromResult<IReadOnlyList<string>>(["Type A", "Type B"]);
    }

    private sealed class PresetValidationRootSettings {
        [Presettable("preset-model")] public ScheduleFilterSpec Model { get; init; } = new();
    }

    private sealed class ProfileWithFilterFamiliesSettings {
        public Pe.FamilyFoundry.FilterFamiliesSettings FilterFamilies { get; init; } = new();
    }

    private static JsonSchemaBuildOptions CreateOptions(bool resolveExamples = true) {
        EnsureDefinitionsRegistered();
        return new(SettingsRuntimeCapabilityProfiles.LiveDocument) {
            ResolveFieldOptionSamples = resolveExamples
        };
    }

    private static void EnsureDefinitionsRegistered() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new RenderSchemaTestSettingsDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new RenderSchemaDatasetTestSettingsDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new LightweightRenderSchemaTestSettingsDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new TableRenderSchemaTestSettingsDefinition());
    }
}
