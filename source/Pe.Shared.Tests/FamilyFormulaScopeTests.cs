using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     Revit forbids a type parameter's formula from reading an instance parameter (GROUNDING-REVIT.md #4). The host validator is the
///     authority the web advisory check (`apps/web/src/family/formula.ts`, type-refs-instance) defers to, so it refuses at parse.
/// </summary>
public sealed class FamilyFormulaScopeTests {
    private static IReadOnlyList<FamilyModelDiagnostic> Validate(string parameters) =>
        FamilyModelJson.Parse("""{"family":{"name":"x","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"},"parameters":""" +
            parameters + "}").Diagnostics;

    private static IEnumerable<FamilyModelDiagnostic> ScopeDiagnostics(string parameters) =>
        Validate(parameters).Where(d => d.Code == FamilyModelDiagnosticCodes.TypeRefsInstance);

    [Test]
    public void Type_formula_reading_an_instance_parameter_is_refused() {
        var diagnostic = ScopeDiagnostics("""{"Clearance":{"dataType":"Length","isInstance":true},"Height":{"dataType":"Length","isInstance":false,"formula":"Clearance + 1'"}}""").Single();
        Assert.That(diagnostic.Path, Is.EqualTo("$.parameters.Height.formula"));
        Assert.That(diagnostic.Message, Does.Contain("'Clearance'"));
    }

    [Test]
    public void Parameter_without_isInstance_is_a_type_parameter() =>
        Assert.That(ScopeDiagnostics("""{"Clearance":{"dataType":"Length","isInstance":true},"Height":{"dataType":"Length","formula":"Clearance * 2"}}"""), Has.Exactly(1).Items);

    [Test]
    public void Instance_formula_may_read_instance_and_type_parameters() =>
        Assert.That(ScopeDiagnostics("""{"Clearance":{"dataType":"Length","isInstance":true},"Width":{"dataType":"Length"},"Height":{"dataType":"Length","isInstance":true,"formula":"Clearance + Width"}}"""), Is.Empty);

    [Test]
    public void Type_formula_reading_type_parameters_is_fine() =>
        Assert.That(ScopeDiagnostics("""{"Width":{"dataType":"Length"},"Height":{"dataType":"Length","isInstance":false,"formula":"Width * 2"}}"""), Is.Empty);

    [Test]
    public void Shared_parameter_with_unresolved_scope_is_not_judged() =>
        // A shared parameter's scope comes from its APS definition at resolution; before that, an absent isInstance is unknown, not type.
        Assert.That(ScopeDiagnostics("""{"Clearance":{"dataType":"Length","isInstance":true},"PE_Height":{"shared":true,"formula":"Clearance * 2"}}"""), Is.Empty);
}
