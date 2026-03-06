using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Tools.Tests;

public sealed class RenderSchemaPipelineTests : RevitTestBase
{
    [Test]
    public async Task CreateRenderSchema_removes_examples_for_provider_backed_fields()
    {
        var schemaJson = JsonSchemaFactory.CreateRenderSchemaJson(typeof(RenderSchemaTestSettings), out _);
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;

        await Assert.That(providerBacked).IsNotNull();
        await Assert.That(providerBacked!["x-provider"]).IsNotNull();
        await Assert.That(providerBacked["examples"]).IsNull();
    }

    [Test]
    public async Task CreateRenderSchema_preserves_includable_item_union_for_frontend_schema_engines()
    {
        var schemaJson = JsonSchemaFactory.CreateRenderSchemaJson(typeof(RenderSchemaTestSettings), out _);
        var root = JObject.Parse(schemaJson);
        var itemsSchema = root["properties"]?["Items"]?["items"] as JObject;

        await Assert.That(itemsSchema).IsNotNull();
        await Assert.That(itemsSchema!["oneOf"]).IsNotNull();
    }

    [Test]
    public async Task CreateRenderSchema_injects_defaults_from_default_instance_values()
    {
        var schemaJson = JsonSchemaFactory.CreateRenderSchemaJson(typeof(RenderSchemaTestSettings), out _);
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
    public async Task CreateFragmentSchema_can_be_finalized_and_transformed_for_rendering()
    {
        var fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(typeof(RenderSchemaTestSettings), out var processor);
        processor.Finalize(fragmentSchema);

        var json = RenderSchemaTransformer.TransformFragmentToJson(fragmentSchema, typeof(RenderSchemaTestSettings));
        var root = JObject.Parse(json);
        var itemsSchema = root["properties"]?["Items"] as JObject;

        await Assert.That(itemsSchema).IsNotNull();
        await Assert.That(itemsSchema!["type"]?.Value<string>()).IsEqualTo("array");
        await Assert.That(itemsSchema["default"] is JArray).IsTrue();
    }

    [Test]
    public async Task CreateRenderSchema_AllowsPresetProperty_ForPresettableObjects()
    {
        var schemaJson = JsonSchemaFactory.CreateRenderSchemaJson(typeof(RenderPresetSchemaTestSettings), out _);
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

    private sealed class RenderSchemaTestSettings
    {
        [SchemaExamples(typeof(TestOptionsProvider))]
        public string ProviderBacked { get; init; } = string.Empty;

        [Includable(IncludableFragmentRoot.TestItems)]
        public List<string> Items { get; init; } = [];

        public bool Enabled { get; init; }
    }

    private sealed class TestOptionsProvider : IOptionsProvider
    {
        public IEnumerable<string> GetExamples() => ["A", "B"];
    }

    private sealed class RenderPresetSchemaTestSettings
    {
        [Presettable("preset-model")]
        public RenderPresetModel Model { get; init; } = new();
    }

    private sealed class RenderPresetModel
    {
        public bool Enabled { get; init; } = true;
    }
}
