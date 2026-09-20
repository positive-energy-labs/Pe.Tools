using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class FamilyFoundryHostContractTests {
    [Test]
    public void Plan_contract_round_trips_changes_run_effects_and_refusals() {
        var data = new FamilyFoundryPlanData(
            [new FamilyFoundryFamilyPlanData(12, "PE Box", "ABCDEF0123456789",
                [new FamilyFoundryChangeData("parameters", "PE_M_Equip_Tag", "Rename", "Tag", "Tag", "PE_M_Equip_Tag")],
                ["run.sort"],
                [],
                [new("FamilyEditWarning", Pe.Shared.RevitData.RevitDataIssueSeverity.Warning, "observed")])],
            [new FamilyFoundryDiagnostic("FamilyNotFound", "$.familyId", "Element id 9 is not a loaded family.")]);

        var back = JsonConvert.DeserializeObject<FamilyFoundryPlanData>(JsonConvert.SerializeObject(data))!;
        Assert.Multiple(() => {
            Assert.That(back.Families[0].Changes[0].MappedFrom, Is.EqualTo("Tag"));
            Assert.That(back.Families[0].Changes[0].Before, Is.EqualTo("Tag"));
            Assert.That(back.Families[0].Changes[0].After, Is.EqualTo("PE_M_Equip_Tag"));
            Assert.That(back.Families[0].RunEffects, Is.EqualTo(new[] { "run.sort" }));
            Assert.That(back.Families[0].Warnings[0].Code, Is.EqualTo("FamilyEditWarning"));
            Assert.That(back.Diagnostics[0].Code, Is.EqualTo("FamilyNotFound"));
        });
    }

    [Test]
    public void Apply_contract_round_trips_receipts_with_residue() {
        var data = new FamilyFoundryApplyData(
            [new FamilyFoundryApplyReceipt(12, "PE Box", true, false, null, "ABCDEF0123456789",
                [new FamilyFoundryChangeData("types.cell", "Wide/Width", "Update", null, "2in", "")], [], "out/PE Box")],
            []);

        var back = JsonConvert.DeserializeObject<FamilyFoundryApplyData>(JsonConvert.SerializeObject(data))!;
        Assert.Multiple(() => {
            Assert.That(back.Receipts[0].Converged, Is.False);
            Assert.That(back.Receipts[0].Residue[0].Key, Is.EqualTo("Wide/Width"));
            Assert.That(back.Receipts[0].Residue[0].After, Is.EqualTo(""));
        });
    }

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
    public void Families_capture_contract_round_trips_model_json_and_coverage() {
        var data = new FamiliesCaptureData(
            [new FamilyFoundryFamilyModelData(12, "PE Box", true, "{}", new Dictionary<string, string> { ["parameters"] = "Read" }, 0,
                [new("FamilyEditWarning", Pe.Shared.RevitData.RevitDataIssueSeverity.Warning, "observed")], null)],
            []);

        var back = JsonConvert.DeserializeObject<FamiliesCaptureData>(JsonConvert.SerializeObject(data))!;
        Assert.That(back.Families[0].Coverage["parameters"], Is.EqualTo("Read"));
        Assert.That(back.Families[0].Issues[0].Severity, Is.EqualTo(Pe.Shared.RevitData.RevitDataIssueSeverity.Warning));
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
