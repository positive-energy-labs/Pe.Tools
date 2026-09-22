using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     F-J3-5 (project-a joint hold): a Yes/No cell accepted "Noj3-a-1" at plan. Capture records a shared parameter with no dataType, only
///     its sharedSpecId, so the value check never ran. Cells of a shared parameter are judged against the spec its sharedSpecId names.
/// </summary>
public sealed class FamilySharedValueTypeTests {
    private const string YesNoSpec = "autodesk.spec:spec.bool-1.0.0";

    private static IEnumerable<FamilyModelDiagnostic> Mismatches(string cell) =>
        FamilyModelJson.Parse("""
            {"family":{"name":"x","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"},
             "parameters":{"Offset Symbol":{"shared":true,"sharedGuid":"6f1f0e8b-7a2e-4d1c-9a4f-0b8f6c1d2e3a","sharedSpecId":"SPEC"}},
             "types":{"A":{"Offset Symbol":"CELL"}}}
            """.Replace("SPEC", YesNoSpec).Replace("CELL", cell)).Diagnostics.Where(d => d.Code == FamilyModelDiagnosticCodes.ValueDataTypeMismatch);

    [Test]
    public void Shared_yes_no_cell_refuses_text() =>
        Assert.That(Mismatches("Noj3-a-1").Select(d => d.Path), Is.EqualTo(new[] { "$.types.A.Offset Symbol" }));

    [TestCase("Yes")]
    [TestCase("No")]
    public void Shared_yes_no_cell_accepts_yes_and_no(string cell) => Assert.That(Mismatches(cell), Is.Empty);

    [Test]
    public void Shared_spec_the_vocabulary_cannot_name_is_not_judged() =>
        Assert.That(FamilyModelJson.Parse("""
            {"family":{"name":"x","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"},
             "parameters":{"Heat":{"shared":true,"sharedGuid":"6f1f0e8b-7a2e-4d1c-9a4f-0b8f6c1d2e3b","sharedSpecId":"autodesk.spec.aec.hvac:heatGain-2.0.0"}},
             "types":{"A":{"Heat":"anything 12"}}}
            """).Diagnostics.Where(d => d.Code == FamilyModelDiagnosticCodes.ValueDataTypeMismatch), Is.Empty);
}
