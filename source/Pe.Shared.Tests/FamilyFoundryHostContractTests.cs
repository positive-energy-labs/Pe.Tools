using Newtonsoft.Json;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class FamilyFoundryHostContractTests {
    [Test]
    public void Plan_contract_round_trips_inline_profile_filter_provenance_and_diagnostics() {
        var request = JsonConvert.DeserializeObject<FamilyFoundryPlanRequest>(
            """{ "profileJson": "{\"FamilyParameters\":[]}", "familyId": 42 }""");
        var data = new FamilyFoundryPlanData(
            "abc",
            [new FamilyFoundryFamilyPlanData(42, "AHU", CreatePlan("Width"))],
            [new FamilyFoundryDiagnostic("NamedDiagnostic", "$.profileJson.old", "stale field")]);
        var roundTripped = RoundTrip(data);

        Assert.Multiple(() => {
            Assert.That(request!.ProfileJson, Does.Contain("FamilyParameters"));
            Assert.That(request.FamilyId, Is.EqualTo(42));
            Assert.That(roundTripped.PlanHash, Is.EqualTo("abc"));
            Assert.That(roundTripped.Families.Single().Plan.Parameters.Single().Provenance.DataType,
                Is.EqualTo("Authored"));
            Assert.That(roundTripped.Diagnostics.Single().Code, Is.EqualTo("NamedDiagnostic"));
        });
    }

    [Test]
    public void Apply_contract_round_trips_drift_gate_and_per_family_receipts() {
        var request = RoundTrip(new FamilyFoundryApplyRequest("{}", [7, 9], "expected"));
        var data = RoundTrip(new FamilyFoundryApplyData(
            "actual",
            false,
            [new FamilyFoundryApplyReceipt(
                7,
                "Pump",
                true,
                null,
                ["Add Params", "Set Values"],
                3,
                new FamilyFoundryParameterDiffSummary(1, 0, 2),
                "C:\\artifacts\\Pump")],
            []));

        Assert.Multiple(() => {
            Assert.That(request.FamilyIds, Is.EqualTo(new long[] { 7, 9 }));
            Assert.That(request.ExpectedPlanHash, Is.EqualTo("expected"));
            Assert.That(data.Refused, Is.False);
            Assert.That(data.Receipts.Single().ParametersChanged, Is.EqualTo(3));
            Assert.That(data.Receipts.Single().DiffSummary.Modified, Is.EqualTo(2));
            Assert.That(data.Receipts.Single().ArtifactDirectoryPath, Is.EqualTo("C:\\artifacts\\Pump"));
        });
    }

    [Test]
    public void Project_contract_round_trips_dense_inline_profile_documents() {
        var request = RoundTrip(new FamilyFoundryProjectRequest([5]));
        var data = RoundTrip(new FamilyFoundryProjectData(
            [new FamilyFoundryProfileProjectionData(5, "VAV", true, "{\"FamilyParameters\":[]}", null)],
            []));

        Assert.Multiple(() => {
            Assert.That(request.FamilyIds.Single(), Is.EqualTo(5));
            Assert.That(data.Projections.Single().Success, Is.True);
            Assert.That(data.Projections.Single().ProfileJson, Does.Contain("FamilyParameters"));
        });
    }

    [Test]
    public void Plan_hash_is_deterministic_and_changes_with_a_field() {
        var first = CreatePlan("Width", reverseValues: false);
        var sameProfileDifferent_dictionary_order = CreatePlan("Width", reverseValues: true);
        var changedField = CreatePlan("Depth", reverseValues: false);

        var firstHash = FamilyFoundryPlanHasher.Compute(first);
        Assert.Multiple(() => {
            Assert.That(FamilyFoundryPlanHasher.Compute(first), Is.EqualTo(firstHash));
            Assert.That(FamilyFoundryPlanHasher.Compute(sameProfileDifferent_dictionary_order), Is.EqualTo(firstHash));
            Assert.That(FamilyFoundryPlanHasher.Compute(changedField), Is.Not.EqualTo(firstHash));
            Assert.That(firstHash, Does.Match("^[0-9a-f]{64}$"));
        });
    }

    private static FamilyFoundryReconciliationPlanData CreatePlan(string parameterName, bool reverseValues = false) {
        var values = new Dictionary<string, string?>();
        if (reverseValues) {
            values["Type B"] = "2'";
            values["Type A"] = "1'";
        } else {
            values["Type A"] = "1'";
            values["Type B"] = "2'";
        }

        return new FamilyFoundryReconciliationPlanData(
            [new FamilyFoundryResolvedParameterData(
                new FamilyFoundryResolvedParameterDefinitionData(
                    new ParameterIdentity(
                        $"name:{parameterName.ToLowerInvariant()}",
                        ParameterIdentityKind.NameFallback,
                        parameterName,
                        null,
                        null,
                        null),
                    parameterName,
                    "autodesk.spec.aec:length-2.0.0",
                    "autodesk.parameter.group:dimensions-1.0.0",
                    false,
                    null),
                false,
                new FamilyFoundryAssignmentData("Value", "1'"),
                values,
                null,
                new FamilyFoundryParameterProvenanceData(
                    "SnapshotOrFixture",
                    "Authored",
                    "FamilyFoundryDefault",
                    "Authored",
                    "Unresolved"))],
            [],
            [parameterName],
            [new FamilyFoundryLoweredActionData("AddFamilyParameter", parameterName, [], "declared")]);
    }

    private static T RoundTrip<T>(T value) =>
        JsonConvert.DeserializeObject<T>(JsonConvert.SerializeObject(value))!;
}
