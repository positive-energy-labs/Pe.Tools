using Newtonsoft.Json.Linq;
using Pe.Revit.SettingsRuntime.Core.Json;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class JsonSchemaFactoryFragmentTests {
    [Test]
    public void BuildFragmentSchema_keeps_schema_property_on_wrapper_and_item_objects() {
        var schema = JsonSchemaFactory.BuildFragmentSchema(
            typeof(FragmentSchemaTestItem),
            new JsonSchemaBuildOptions(SettingsRuntimeMode.HostOnly)
        );
        var root = JObject.Parse(schema.ToJson());

        Assert.That(root["properties"]?["$schema"], Is.Not.Null);
        Assert.That(root["properties"]?["Items"]?["items"]?["properties"]?["$schema"], Is.Not.Null);
    }

    private sealed class FragmentSchemaTestItem {
        public string Name { get; init; } = string.Empty;
    }
}