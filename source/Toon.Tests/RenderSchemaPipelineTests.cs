using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Xunit;

namespace Toon.Tests;

public class RenderSchemaPipelineTests {
    [Fact]
    public void CreateRenderSchema_removes_examples_for_provider_backed_fields() {
        var schemaJson = JsonSchemaFactory.CreateRenderSchemaJson(typeof(RenderSchemaTestSettings), out _);
        var root = JObject.Parse(schemaJson);
        var providerBacked = root["properties"]?["ProviderBacked"] as JObject;

        Assert.NotNull(providerBacked);
        Assert.NotNull(providerBacked!["x-provider"]);
        Assert.Null(providerBacked["examples"]);
    }

    [Fact]
    public void CreateRenderSchema_preserves_includable_item_union_for_frontend_schema_engines() {
        var schemaJson = JsonSchemaFactory.CreateRenderSchemaJson(typeof(RenderSchemaTestSettings), out _);
        var root = JObject.Parse(schemaJson);
        var itemsSchema = root["properties"]?["Items"]?["items"] as JObject;

        Assert.NotNull(itemsSchema);
        Assert.NotNull(itemsSchema!["oneOf"]);
    }

    [Fact]
    public void CreateRenderSchema_injects_defaults_from_default_instance_values() {
        var schemaJson = JsonSchemaFactory.CreateRenderSchemaJson(typeof(RenderSchemaTestSettings), out _);
        var root = JObject.Parse(schemaJson);
        var enabledSchema = root["properties"]?["Enabled"] as JObject;
        var providerBackedSchema = root["properties"]?["ProviderBacked"] as JObject;
        var itemsSchema = root["properties"]?["Items"] as JObject;

        Assert.NotNull(enabledSchema);
        Assert.NotNull(providerBackedSchema);
        Assert.NotNull(itemsSchema);
        Assert.Equal(false, enabledSchema!["default"]?.Value<bool>());
        Assert.Equal(string.Empty, providerBackedSchema!["default"]?.Value<string>());
        Assert.True(itemsSchema!["default"] is JArray);
    }

    [Fact]
    public void CreateFragmentSchema_can_be_finalized_and_transformed_for_rendering() {
        var fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(typeof(RenderSchemaTestSettings), out var processor);
        processor.Finalize(fragmentSchema);

        var json = RenderSchemaTransformer.TransformFragmentToJson(fragmentSchema, typeof(RenderSchemaTestSettings));
        var root = JObject.Parse(json);
        var itemsSchema = root["properties"]?["Items"] as JObject;

        Assert.NotNull(itemsSchema);
        Assert.Equal("array", itemsSchema!["type"]?.Value<string>());
        Assert.True(itemsSchema["default"] is JArray);
    }

    private class RenderSchemaTestSettings {
        [SchemaExamples(typeof(TestOptionsProvider))]
        public string ProviderBacked { get; init; } = string.Empty;

        [Includable("test-items")]
        public List<string> Items { get; init; } = [];

        public bool Enabled { get; init; }
    }

    private class TestOptionsProvider : IOptionsProvider {
        public IEnumerable<string> GetExamples() => ["A", "B"];
    }
}
