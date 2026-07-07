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

    private sealed record ProbeTarget(string Id, string? Label = null);

    private sealed record ProbeRequest(
        string ModuleKey,
        ProbeTarget Target,
        string? Filter = null,
        bool IncludeHidden = false,
        int Depth = 2,
        IReadOnlyList<ProbeTarget>? ExtraTargets = null
    );

    [Test]
    public void Response_non_nullable_properties_are_required_and_nullable_ones_are_not() {
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
    public void Response_nested_definitions_get_required_too_and_names_are_camel_cased() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetResponseSchemaJson(typeof(ProbeContract)));

        var child = schema.SelectToken("$.definitions.ProbeChild") as JObject;
        Assert.That(child, Is.Not.Null);
        var childRequired = child!["required"]!.Select(token => (string)token!).ToArray();
        Assert.That(childRequired, Does.Contain("name"));
        Assert.That(childRequired, Does.Not.Contain("nickname"));
    }

    [Test]
    public void Request_requires_only_non_nullable_parameters_without_defaults() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(ProbeRequest)));

        var required = (schema["required"] ?? new JArray()).Select(token => (string)token!).ToArray();
        Assert.That(required, Does.Contain("moduleKey"));
        Assert.That(required, Does.Contain("target"));
        Assert.That(required, Does.Not.Contain("filter"));
        Assert.That(required, Does.Not.Contain("includeHidden"));
        Assert.That(required, Does.Not.Contain("depth"));
        Assert.That(required, Does.Not.Contain("extraTargets"));
    }

    [Test]
    public void Request_nested_definitions_follow_the_same_rule() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(ProbeRequest)));

        var target = schema.SelectToken("$.definitions.ProbeTarget") as JObject;
        Assert.That(target, Is.Not.Null);
        var targetRequired = (target!["required"] ?? new JArray()).Select(token => (string)token!).ToArray();
        Assert.That(targetRequired, Does.Contain("id"));
        Assert.That(targetRequired, Does.Not.Contain("label"));
    }

    [Test]
    public void Request_required_list_is_exactly_the_non_defaulted_parameters() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(ProbeTarget)));

        var required = (schema["required"] ?? new JArray()).Select(token => (string)token!).ToArray();
        Assert.That(required, Does.Contain("id"));
        Assert.That(required, Has.Length.EqualTo(1));
    }

    [Test]
    public void Request_schema_carries_x_options_and_descriptions_for_annotated_properties() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(LoadedFamiliesCatalogRequest)));

        var contains = schema.SelectToken("$.definitions.LoadedFamiliesFilter.properties.categoryNameContains") as JObject;
        Assert.That(contains, Is.Not.Null, "categoryNameContains property schema missing");
        var options = contains!["x-options"] as JObject;
        Assert.That(options, Is.Not.Null, "x-options annotation missing");
        Assert.That((string?)options!["key"], Is.EqualTo("category-names"));
        Assert.That((string?)options["mode"], Is.EqualTo("suggestion"));
        Assert.That((bool?)options["allowsCustomValue"], Is.True);
        Assert.That((string?)contains["description"], Does.Contain("substring"), "XML doc summary missing");
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
