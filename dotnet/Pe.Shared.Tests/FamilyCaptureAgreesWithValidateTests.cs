using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     w5-revit defect 2: capture wrote a member its own composition refused, so `/family` could not plan
///     what it had just captured. The fixture is the real member w5-revit captured from the R2025 shipped
///     family `Structural Precast/Mounting Parts/Double Wall - Lattice Girder.rfa`
///     (`reports/w5-revit-evidence/04-captured-member.json`, sha 36e8419d…), committed verbatim.
///     These tests pin both halves of the disagreement and the two rules that settle it.
/// </summary>
[TestFixture]
public sealed class FamilyCaptureAgreesWithValidateTests {
    private static string Fixture(string name) => File.ReadAllText(Path.Combine(FamilyModelContractTests.FixtureDir, name));

    private const string Captured = "w5-revit-lattice-girder.captured.json";
    private const string Fixed = "w5-revit-lattice-girder.json";

    /// <summary>The falsification, reproduced with no Revit: exactly the three diagnostics w5-revit hit.</summary>
    [Test]
    public void Captured_member_as_w5_wrote_it_is_refused_on_exactly_the_two_known_causes() {
        var result = FamilyModelJson.Parse(Fixture(Captured));
        Assert.That(result.Value, Is.Not.Null, string.Join("\n", result.Diagnostics.Select(d => $"[{d.Code}] {d.Path}: {d.Message}")));
        Assert.That(result.Diagnostics.Select(d => $"{d.Code} {d.Path}"), Is.EquivalentTo(new[] {
            "formula-unknown-name $.parameters.LG Length.formula",
            "formula-unknown-name $.parameters.Num.formula",
            "refline-from-two-planes $.refLines.line-1.from"
        }));
    }

    /// <summary>
    ///     Rule 1: a formula may name a built-in family parameter. `Length` is the family's, and the engine
    ///     never creates it, so the document declares the census and the validator resolves against it.
    /// </summary>
    [Test]
    public void Declared_built_in_resolves_a_formula_the_engine_never_creates() {
        var model = FamilyModelJson.Parse(Fixture(Captured)).Value!;
        Assert.That(FamilyModelValidator.Validate(model).Count(d => d.Code == FamilyModelDiagnosticCodes.FormulaUnknownName), Is.EqualTo(2));
        model.BuiltIns.Add("Length");
        Assert.That(FamilyModelValidator.Validate(model).Any(d => d.Code == FamilyModelDiagnosticCodes.FormulaUnknownName), Is.False);
        model.Parameters["Typo"] = new FamilyModelParameter { DataType = DataType.Number, Formula = "Lenth / 2" };
        Assert.That(FamilyModelValidator.Validate(model).Any(d => d.Code == FamilyModelDiagnosticCodes.FormulaUnknownName), Is.True,
            "An undeclared name is still a refusal; the census is not an escape hatch.");
    }

    /// <summary>
    ///     Rule 2: a reference line whose start is not fixed by exactly two planes is not constructible
    ///     (`MakeRefLines` intersects `on` with `from[0]` and `from[1]`), so it leaves the member as a fact.
    /// </summary>
    [Test]
    public void Unconstructible_reference_line_leaves_the_member_as_a_fact() {
        var model = FamilyModelJson.Parse(Fixture(Captured)).Value!;
        Assert.That(model.RefLines["line-1"].From, Has.Count.EqualTo(1));
        var facts = FamilyModelPrune.RefLinesWithoutTwoPlanes(model);
        Assert.That(model.RefLines, Is.Empty);
        Assert.That(facts.Select(f => (f.Reason, f.Path)),
            Is.EquivalentTo(new[] { (UnmodeledReason.RefLineStartNotTwoPlanes, "$.refLines.line-1.from") }));
        Assert.That(facts.Single().Facts["planes"], Is.EqualTo("Left"));
    }

    /// <summary>
    ///     Both rules applied to the captured bytes give exactly the committed fixture, and the fixture
    ///     validates — so what the fixed capture writes is a member `/family` can plan with no hand edit.
    /// </summary>
    [Test]
    public void The_two_rules_turn_the_captured_bytes_into_the_committed_member_and_it_validates() {
        var model = FamilyModelJson.Parse(Fixture(Captured)).Value!;
        model.BuiltIns.Add("Length");
        _ = FamilyModelPrune.RefLinesWithoutTwoPlanes(model);
        Assert.That(FamilyModelValidator.Validate(model), Is.Empty);
        Assert.That(JToken.DeepEquals(JObject.Parse(FamilyModelJson.Serialize(model)), JObject.Parse(FamilyModelJson.Serialize(FamilyModelJson.Parse(Fixture(Fixed)).Value!))), Is.True);
    }
    /// <summary>
    ///     w6-revit claim 3: the real Air Terminals family from the project-a model
    ///     (`reports/w6-revit-evidence/33-captured-family-member.json`, sha e2135098…, verbatim) labels its duct
    ///     dimensions and connector size slots with `DuctSize` parameters. Slots compare by measure, so it plans
    ///     with no hand edit; a slot still refuses a parameter of another measure.
    /// </summary>
    [Test]
    public void Captured_mep_family_with_duct_size_labels_validates_with_no_hand_edit() {
        var result = FamilyModelJson.Parse(Fixture("w6-revit-air-terminal.captured.json"));
        Assert.That(result.Value, Is.Not.Null);
        Assert.That(result.Diagnostics.Select(d => $"[{d.Code}] {d.Path}: {d.Message}"), Is.Empty);
        var model = result.Value!;
        model.Parameters["Duct Width"] = new FamilyModelParameter { DataType = DataType.AirFlow };
        Assert.That(FamilyModelValidator.Validate(model).Select(d => d.Code), Does.Contain(FamilyModelDiagnosticCodes.LabelTypeMismatch).And.Contain(FamilyModelDiagnosticCodes.DriverDataTypeMismatch));
    }
}
