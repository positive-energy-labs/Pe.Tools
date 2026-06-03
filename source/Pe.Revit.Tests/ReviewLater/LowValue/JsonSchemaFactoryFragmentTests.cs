// Quarantined: schema-fragment assertions look like low-level JSON shape pinning.
// Keep only if this protects a public authored-settings schema contract; otherwise delete or replace with a broader contract test.
using Newtonsoft.Json.Linq;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Revit.Tests;

[TestFixture]
[Explicit("Quarantined low-value schema shape test; review before treating as coverage.")]
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

    [Test]
    public void BuildAuthoringSchema_allows_include_directive_items_before_concrete_items() {
        var schema = JsonSchemaFactory.BuildAuthoringSchema(
            typeof(IncludableSchemaTestRoot),
            new JsonSchemaBuildOptions(SettingsRuntimeMode.HostOnly)
        );
        var root = JObject.Parse(schema.ToJson());

        var itemUnion = root["properties"]?["Items"]?["items"];
        var firstBranch = itemUnion?["anyOf"]?.First;

        Assert.That(firstBranch?["properties"]?["$include"], Is.Not.Null);
        Assert.That(firstBranch?["required"]?.Values<string>(), Does.Contain("$include"));
        Assert.That(firstBranch?["additionalProperties"]?.Value<bool>(), Is.False);
    }

    [Test]
    public void BuildAuthoringSchema_allows_include_directive_items_from_schema_definition_bindings() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new DefinitionBackedIncludableSchemaTestRootDefinition());

        var schema = JsonSchemaFactory.BuildAuthoringSchema(
            typeof(DefinitionBackedIncludableSchemaTestRoot),
            new JsonSchemaBuildOptions(SettingsRuntimeMode.HostOnly)
        );
        var root = JObject.Parse(schema.ToJson());

        var itemUnion = root["properties"]?["Items"]?["items"];
        var firstBranch = itemUnion?["anyOf"]?.First;

        Assert.That(firstBranch?["properties"]?["$include"], Is.Not.Null);
        Assert.That(firstBranch?["required"]?.Values<string>(), Does.Contain("$include"));
        Assert.That(firstBranch?["additionalProperties"]?.Value<bool>(), Is.False);
    }

    private sealed class FragmentSchemaTestItem {
        public string Name { get; init; } = string.Empty;
    }

    private sealed class IncludableSchemaTestRoot {
        [Includable(IncludableFragmentRoot.TestItems)]
        public List<FragmentSchemaTestItem> Items { get; init; } = [];
    }

    private sealed class DefinitionBackedIncludableSchemaTestRoot {
        public List<FragmentSchemaTestItem> Items { get; init; } = [];
    }

    private sealed class DefinitionBackedIncludableSchemaTestRootDefinition
        : SettingsSchemaDefinition<DefinitionBackedIncludableSchemaTestRoot> {
        public override void Configure(ISettingsSchemaBuilder<DefinitionBackedIncludableSchemaTestRoot> builder) =>
            builder.Property(item => item.Items, property => property.AllowIncludes(IncludableFragmentRoot.TestItems));
    }
}
