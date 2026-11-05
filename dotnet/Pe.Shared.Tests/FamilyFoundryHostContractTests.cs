using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class FamilyFoundryHostContractTests {
    [Test]
    public void Plan_wire_keeps_null_before_and_after_values() {
        var data = new FamilyFoundryPlanData(
            [new FamilyFoundryFamilyPlanData(12, "PE Box", "ABCDEF0123456789",
                [new FamilyFoundryChangeData("parameters", "Width", "Add", null, null, null)], [], [], [])], []);

        var json = JsonConvert.SerializeObject(data, new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CamelCasePropertyNamesContractResolver()
        });

        Assert.That(json, Does.Contain("\"before\":null").And.Contain("\"after\":null"));
    }

    [Test]
    public void Capture_issues_are_not_authored_family_state() {
        var model = new FamilyModel {
            CaptureIssues = [new("FamilyEditWarning", Pe.Shared.RevitData.RevitDataIssueSeverity.Warning,
                "transient element 6150368")]
        };

        Assert.That(FamilyModelJson.Serialize(model), Does.Not.Contain("FamilyEditWarning").And.Not.Contain("6150368"));
    }
}
