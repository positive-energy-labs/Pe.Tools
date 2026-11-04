using Pe.Shared.StorageRuntime.Capabilities;
using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class BridgeOpSchemaGeneratorTests {
    // Use the same mutation contract the dispatch tests bind; these expected names are authored independently.
    [Test]
    public void Reviewed_cell_schema_requires_evidence_but_leaves_defaulted_options_optional() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(ScheduleCellApplyRequest)));
        Assert.That(schema["required"]!.Values<string>(),
            Is.EquivalentTo(new[] { "scheduleId", "scheduleUniqueId", "edits" }));
        Assert.That(schema.SelectToken("$.definitions.ScheduleCellEdit.required")!.Values<string>(),
            Is.EquivalentTo(new[] { "rowNumber", "columnNumber", "expectedBinding" }));
        Assert.That(schema.SelectToken("$.definitions.ParameterTarget.required")!.Values<string>(),
            Is.EquivalentTo(new[] { "elementId", "parameterId", "storageType", "isReadOnly", "hasValue", "rawValue" }));
    }

    [Test]
    public void Catalog_response_requires_nested_non_nullable_values_and_omits_nullable_metadata() {
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetResponseSchemaJson(typeof(LoadedFamiliesCatalogData)));
        Assert.That(schema["required"]!.Values<string>(), Is.EquivalentTo(new[] { "summary", "families", "issues" }));
        Assert.That(schema.SelectToken("$.definitions.LoadedFamilyCatalogEntry.required")!.Values<string>(),
            Is.EquivalentTo(new[] { "familyId", "familyUniqueId", "familyName", "typeCount", "placedInstanceCount", "types" }));
        Assert.That(schema.SelectToken("$.definitions.LoadedFamilyTypeEntry.required")!.Values<string>(),
            Is.EquivalentTo(new[] { "typeName" }));
    }

    [Test]
    public void Request_schema_carries_x_options_and_descriptions_for_annotated_properties() {
        BridgeOpSchemaGenerator.DescribeFieldOptions = key =>
            new SettingsValueDomainDescriptor(key, SettingsOptionsMode.Suggestion, true, [], SettingsRuntimeMode.HostOnly);
        var schema = JObject.Parse(BridgeOpSchemaGenerator.GetRequestSchemaJson(typeof(LoadedFamiliesCatalogRequest)));

        var contains = schema.SelectToken("$.definitions.LoadedFamiliesFilter.properties.categoryNameContains") as JObject;
        Assert.That(contains, Is.Not.Null, "categoryNameContains property schema missing");
        var options = contains!["x-options"] as JObject;
        Assert.That(options, Is.Not.Null, "x-options annotation missing");
        Assert.That((string?)options!["key"], Is.EqualTo("category-names"));
        Assert.That((string?)options["mode"], Is.EqualTo("Suggestion"));
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
