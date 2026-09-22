using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PortablePodConsumerTests {
    [Test]
    public void Shared_parameter_observation_lists_only_resources_actually_consumed() {
        const string usedId = "autodesk.parameter.aec:f7cb211b-b1b9-4c7b-9f72-63cc60f9797f-1.0.0";
        var definitions = new[] {
            new Pe.Revit.Global.Services.Aps.ParametersApi.Parameters.ParametersResult {
                Id = usedId, Name = "Used", SpecId = "autodesk.spec.aec:string.text-2.0.0"
            }
        };
        using var source = new FamilySharedParameterSource(null!, definitions,
            requiredResourceIds: [usedId, "unused-missing-resource"], requireDeclaration: true,
            observedParametersDigest: "current-collection");
        var authored = JObject.Parse("""{"parameters":{"Used":{"shared":true}}}""");
        var model = new FamilyModel { Parameters = authored["parameters"]!.ToObject<Dictionary<string, FamilyModelParameter>>()! };
        source.Resolve(model, authored);
        Assert.That(source.ObservedResourceIds, Is.EquivalentTo(new[] { usedId }));
    }

    [Test]
    public void Family_without_shared_parameters_does_not_resolve_unrelated_authorities() {
        using var source = new FamilySharedParameterSource(null!, requireDeclaration: true,
            declaredRequirements: [new("unrelated-a", "offline-a"), new("unrelated-b", "offline-b")]);
        var model = new FamilyModel { Parameters = [] };
        Assert.DoesNotThrow(() => source.Resolve(model, JObject.Parse("{\"parameters\":{}}")));
        Assert.That(source.ObservedParametersDigest, Is.Null);
    }

    [Test]
    public void Pod_shared_parameters_cannot_use_embedded_definitions_without_declared_APS_authority() {
        using var source = new FamilySharedParameterSource(null!, requireDeclaration: true);
        var authored = JObject.Parse("""{"parameters":{"Test":{"shared":true,"sharedGuid":"f7cb211b-b1b9-4c7b-9f72-63cc60f9797f","sharedSpecId":"autodesk.spec.aec:string.text-2.0.0"}}}""");
        var model = new FamilyModel { Parameters = authored["parameters"]!.ToObject<Dictionary<string, FamilyModelParameter>>()! };
        var error = Assert.Throws<InvalidOperationException>(() => source.Resolve(model, authored));
        Assert.That(error!.Message, Does.Contain("require an aps.parameters declaration"));
    }
}
