using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.SettingsRuntime.Core.Json;
using Pe.Revit.SettingsRuntime.Core.Json.FieldOptions;
using Pe.Revit.SettingsRuntime.Core.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Core.Json.SchemaProviders;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class SchemaDefinitionFieldOptionsTests {
    [OneTimeSetUp]
    public void RegisterTestSchemaDefinition() =>
        SettingsSchemaDefinitionRegistry.Shared.Register(new SchemaDefinitionFieldOptionsTestDefinition());

    [Test]
    public void UseFieldOptions_preserves_provider_dependencies_and_merges_builder_dependencies() {
        var registered = SettingsSchemaDefinitionRegistry.Shared.TryGet(
            typeof(SchemaDefinitionFieldOptionsTestSettings),
            out var definition
        );

        Assert.That(registered, Is.True);
        Assert.That(
            definition.Bindings.TryGetValue(nameof(SchemaDefinitionFieldOptionsTestSettings.Parameter),
                out var binding),
            Is.True);
        Assert.That(binding.FieldOptions, Is.Not.Null);

        Assert.That(
            binding.FieldOptions!.DependsOn,
            Is.EquivalentTo(
                new[] {
                    new FieldOptionsDependency(
                        OptionContextKeys.SelectedFamilyNames,
                        SettingsOptionsDependencyScope.Context
                    ),
                    new FieldOptionsDependency(
                        OptionContextKeys.CategoryName,
                        SettingsOptionsDependencyScope.Sibling
                    )
                }
            )
        );
    }

    [Test]
    public void UseFieldOptions_registers_provider_so_schema_generation_can_emit_examples() {
        var schema = JsonSchemaFactory.BuildAuthoringSchema(
            typeof(SchemaDefinitionFieldOptionsTestSettings),
            new JsonSchemaBuildOptions(SettingsRuntimeMode.LiveDocument)
        );
        var root = JObject.Parse(schema.ToJson());
        var parameterSchema = (JObject?)root["properties"]?["parameter"];

        Assert.That(parameterSchema, Is.Not.Null);

        var dependsOn = parameterSchema!["x-options"]?["dependsOn"]?.ToObject<List<SettingsOptionsDependency>>();
        Assert.That(dependsOn, Is.Not.Null);
        Assert.That(
            dependsOn!,
            Is.EquivalentTo(
                new[] {
                    new SettingsOptionsDependency(
                        OptionContextKeys.SelectedFamilyNames,
                        SettingsOptionsDependencyScope.Context
                    ),
                    new SettingsOptionsDependency(
                        OptionContextKeys.CategoryName,
                        SettingsOptionsDependencyScope.Sibling
                    )
                }
            )
        );
        Assert.That(parameterSchema["examples"], Is.Null);

        var exampleDefinitionRef = parameterSchema["allOf"]?.Children<JObject>()
            .Select(candidate => candidate["$ref"]?.Value<string>())
            .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
        Assert.That(exampleDefinitionRef, Is.Not.Null.And.StartWith("#/definitions/"));

        var definitionName = exampleDefinitionRef!["#/definitions/".Length..];
        var examples = root["definitions"]?[definitionName]?["examples"]?.ToObject<List<string>>();

        Assert.That(examples, Is.Not.Null);
        Assert.That(examples, Is.EquivalentTo(new[] { "Alpha", "Beta" }));
    }

    private sealed class SchemaDefinitionFieldOptionsTestDefinition
        : SettingsSchemaDefinition<SchemaDefinitionFieldOptionsTestSettings> {
        public override void Configure(ISettingsSchemaBuilder<SchemaDefinitionFieldOptionsTestSettings> builder) =>
            builder.Property(item => item.Parameter, property => {
                property.UseFieldOptions<SchemaDefinitionFieldOptionsTestProvider>();
                property.DependsOnSibling(OptionContextKeys.CategoryName);
            });
    }

    private sealed class SchemaDefinitionFieldOptionsTestProvider : IFieldOptionsSource {
        public FieldOptionsDescriptor Describe() => new(
            "SchemaDefinitionFieldOptionsTestProvider",
            SettingsOptionsResolverKind.Remote,
            SettingsOptionsMode.Suggestion,
            true,
            [new FieldOptionsDependency(OptionContextKeys.SelectedFamilyNames, SettingsOptionsDependencyScope.Context)],
            SettingsRuntimeMode.LiveDocument
        );

        public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
            FieldOptionsExecutionContext context,
            CancellationToken cancellationToken = default
        ) => new(
            (IReadOnlyList<FieldOptionItem>) [
                new FieldOptionItem("Beta", "Beta", null),
                new FieldOptionItem("Alpha", "Alpha", null)
            ]
        );
    }

    private sealed class SchemaDefinitionFieldOptionsTestSettings {
        [JsonProperty("parameter")] public string Parameter { get; init; } = string.Empty;
    }
}