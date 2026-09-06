using Newtonsoft.Json;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class FamilyFoundryHostContractTests {
    [Test]
    public void Plan_contract_round_trips_changes_run_effects_and_refusals() {
        var data = new FamilyFoundryPlanData(
            [new FamilyFoundryFamilyPlanData(12, "PE Box", "ABCDEF0123456789",
                [new FamilyFoundryChangeData("parameters", "PE_M_Equip_Tag", "Rename", "Tag")],
                ["run.sort"],
                [])],
            [new FamilyFoundryDiagnostic("FamilyNotFound", "$.familyId", "Element id 9 is not a loaded family.")]);

        var back = JsonConvert.DeserializeObject<FamilyFoundryPlanData>(JsonConvert.SerializeObject(data))!;
        Assert.Multiple(() => {
            Assert.That(back.Families[0].Changes[0].MappedFrom, Is.EqualTo("Tag"));
            Assert.That(back.Families[0].RunEffects, Is.EqualTo(new[] { "run.sort" }));
            Assert.That(back.Diagnostics[0].Code, Is.EqualTo("FamilyNotFound"));
        });
    }

    [Test]
    public void Apply_contract_round_trips_receipts_with_residue() {
        var data = new FamilyFoundryApplyData(
            [new FamilyFoundryApplyReceipt(12, "PE Box", true, false, null, "ABCDEF0123456789",
                [new FamilyFoundryChangeData("types.cell", "Wide/Width", "Update", null)], [], "out/PE Box")],
            []);

        var back = JsonConvert.DeserializeObject<FamilyFoundryApplyData>(JsonConvert.SerializeObject(data))!;
        Assert.Multiple(() => {
            Assert.That(back.Receipts[0].Converged, Is.False);
            Assert.That(back.Receipts[0].Residue[0].Key, Is.EqualTo("Wide/Width"));
        });
    }

    [Test]
    public void Project_contract_round_trips_model_json_and_coverage() {
        var data = new FamilyFoundryProjectData(
            [new FamilyFoundryFamilyModelData(12, "PE Box", true, "{}", new Dictionary<string, string> { ["parameters"] = "Read" }, 0, null)],
            []);

        var back = JsonConvert.DeserializeObject<FamilyFoundryProjectData>(JsonConvert.SerializeObject(data))!;
        Assert.That(back.Families[0].Coverage["parameters"], Is.EqualTo("Read"));
    }
}
