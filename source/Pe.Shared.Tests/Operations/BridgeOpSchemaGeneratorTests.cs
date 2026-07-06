using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class BridgeOpSchemaGeneratorTests {
    private sealed record ProbeChild(string Name, string? Nickname);

    private sealed record ProbeContract(
        string Title,
        string? Subtitle,
        int Count,
        IReadOnlyList<string> Tags,
        ProbeChild Child,
        ProbeChild? OptionalChild
    );

    [Test]
    public void Non_nullable_properties_are_required_and_nullable_ones_are_not() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetResponseSchemaJson(typeof(ProbeContract)));

        var required = schema["required"]!.Select(token => (string)token!).ToArray();
        Assert.That(required, Does.Contain("title"));
        Assert.That(required, Does.Contain("count"));
        Assert.That(required, Does.Contain("tags"));
        Assert.That(required, Does.Contain("child"));
        Assert.That(required, Does.Not.Contain("subtitle"));
        Assert.That(required, Does.Not.Contain("optionalChild"));
    }

    [Test]
    public void Nested_definitions_get_required_too_and_names_are_camel_cased() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetResponseSchemaJson(typeof(ProbeContract)));

        var child = schema.SelectToken("$.definitions.ProbeChild") as JObject;
        Assert.That(child, Is.Not.Null);
        var childRequired = child!["required"]!.Select(token => (string)token!).ToArray();
        Assert.That(childRequired, Does.Contain("name"));
        Assert.That(childRequired, Does.Not.Contain("nickname"));
    }

    [Test]
    public void Request_schemas_mark_nothing_required() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(ProbeContract)));
        Assert.That(schema["required"], Is.Null);
    }

    [Test]
    public void Real_matrix_contract_marks_families_required() {
        var schema = JObject.Parse(
            BridgeOpSchemaGenerator.GetResponseSchemaJson(typeof(LoadedFamiliesMatrixData))
        );

        var required = (schema["required"] ?? new JArray()).Select(token => (string)token!).ToArray();
        Assert.That(required, Does.Contain("families"));
    }
}
