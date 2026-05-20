using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class SchemaDefinitionValueDomainTests {
    private const string DomainKey = "schema-definition-value-domain-test";

    [OneTimeSetUp]
    public void RegisterTestSchemaDefinition() {
        SettingsValueDomainRegistry.Shared.Register(DomainKey,
            static () => new SchemaDefinitionValueDomainTestDomain());
        SettingsSchemaDefinitionRegistry.Shared.Register(new SchemaDefinitionValueDomainTestDefinition());
    }

    [Test]
    public void UseValueDomain_preserves_domain_dependencies_and_merges_builder_dependencies() {
        var registered = SettingsSchemaDefinitionRegistry.Shared.TryGet(
            typeof(SchemaDefinitionValueDomainTestSettings),
            out var definition
        );

        Assert.That(registered, Is.True);
        Assert.That(
            definition.Bindings.TryGetValue(nameof(SchemaDefinitionValueDomainTestSettings.Parameter),
                out var binding),
            Is.True);
        Assert.That(binding.ValueDomain, Is.Not.Null);

        Assert.That(
            binding.ValueDomain!.DependsOn,
            Is.EquivalentTo(
                new[] {
                    new SettingsOptionsDependency(
                        ValueDomainContextKeys.SelectedFamilyNames,
                        SettingsOptionsDependencyScope.Context
                    ),
                    new SettingsOptionsDependency(
                        ValueDomainContextKeys.CategoryName,
                        SettingsOptionsDependencyScope.Sibling
                    )
                }
            )
        );
    }

    [Test]
    public void UseValueDomain_registers_domain_so_schema_generation_can_emit_examples() {
        var schema = JsonSchemaFactory.BuildAuthoringSchema(
            typeof(SchemaDefinitionValueDomainTestSettings),
            new JsonSchemaBuildOptions(SettingsRuntimeMode.LiveDocument)
        );
        var root = JObject.Parse(schema.ToJson());
        var parameterSchema = (JObject?)root["properties"]?["parameter"];

        Assert.That(parameterSchema, Is.Not.Null);

        var options = parameterSchema!["x-options"];
        Assert.That(options?["key"]?.Value<string>(), Is.EqualTo(DomainKey));
        Assert.That(options?["resolver"]?.Value<string>(), Is.EqualTo("Remote"));
        Assert.That(options?["mode"]?.Value<string>(), Is.EqualTo("Suggestion"));
        Assert.That(options?["allowsCustomValue"]?.Value<bool>(), Is.True);

        var dependsOn = options?["dependsOn"]?.ToObject<List<SettingsOptionsDependency>>();
        Assert.That(dependsOn, Is.Not.Null);
        Assert.That(
            dependsOn!,
            Is.EquivalentTo(
                new[] {
                    new SettingsOptionsDependency(
                        ValueDomainContextKeys.SelectedFamilyNames,
                        SettingsOptionsDependencyScope.Context
                    ),
                    new SettingsOptionsDependency(
                        ValueDomainContextKeys.CategoryName,
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

    private sealed class SchemaDefinitionValueDomainTestDefinition
        : SettingsSchemaDefinition<SchemaDefinitionValueDomainTestSettings> {
        public override void Configure(ISettingsSchemaBuilder<SchemaDefinitionValueDomainTestSettings> builder) =>
            builder.Property(item => item.Parameter, property => {
                property.UseValueDomain(DomainKey);
                property.DependsOnSibling(ValueDomainContextKeys.CategoryName);
            });
    }

    private sealed class SchemaDefinitionValueDomainTestDomain : ISettingsValueDomain {
        public SettingsValueDomainDescriptor Describe() => new(
            DomainKey,
            SettingsOptionsResolverKind.Remote,
            SettingsOptionsMode.Suggestion,
            true,
            [new SettingsOptionsDependency(ValueDomainContextKeys.SelectedFamilyNames, SettingsOptionsDependencyScope.Context)],
            SettingsRuntimeMode.LiveDocument
        );

        public ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
            ValueDomainExecutionContext context,
            CancellationToken cancellationToken = default
        ) => new(
            (IReadOnlyList<ValueDomainOptionItem>) [
                new ValueDomainOptionItem("Beta", "Beta", null),
                new ValueDomainOptionItem("Alpha", "Alpha", null)
            ]
        );
    }

    private sealed class SchemaDefinitionValueDomainTestSettings {
        [JsonProperty("parameter")] public string Parameter { get; init; } = string.Empty;
    }
}
