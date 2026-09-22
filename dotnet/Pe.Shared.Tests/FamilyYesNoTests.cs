using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     One Yes/No reader (F-J3-5b, authority ruling msg-authority-domains-bool-plan.md): yes/no/true/false in any case, and 0/1, read as
///     Yes/No; anything else refuses by parameter and value. A Yes/No cell is written and captured as "Yes"/"No".
/// </summary>
public sealed class FamilyYesNoTests {
    [TestCase("Yes", true)] [TestCase("No", false)] [TestCase("yes", true)] [TestCase(" NO ", false)]
    [TestCase("true", true)] [TestCase("FALSE", false)] [TestCase("1", true)] [TestCase("0", false)]
    public void Accepted_spellings_read(string text, bool expected) {
        Assert.That(YesNoValue.TryParse(text, out var value), Is.True);
        Assert.That(value, Is.EqualTo(expected));
    }

    [TestCase("2")] [TestCase("-5")] [TestCase("01")] [TestCase("Noj3-a-1")] [TestCase("")] [TestCase(null)] [TestCase("y")] [TestCase("1.0")]
    public void Anything_else_refuses(string? text) => Assert.That(YesNoValue.TryParse(text, out _), Is.False);

    private const string Header = """{"name":"x","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"}""";

    // Both a family Yes/No parameter (dataType) and a shared one (sharedSpecId, how capture records it).
    private const string Model = """
        {"family":HEADER,
         "parameters":{"Show":{"dataType":"YesNo"},
                       "Offset Symbol":{"shared":true,"sharedGuid":"6f1f0e8b-7a2e-4d1c-9a4f-0b8f6c1d2e3a","sharedSpecId":"autodesk.spec:spec.bool-1.0.0"}},
         "types":{"A":{"Show":"FAMILY","Offset Symbol":"SHARED"}}}
        """;

    private static FamilyModelParseResult Parse(string familyCell, string sharedCell) =>
        FamilyModelJson.Parse(Model.Replace("HEADER", Header).Replace("FAMILY", familyCell).Replace("SHARED", sharedCell));

    [TestCase("true", "1", "Yes", "Yes")]
    [TestCase("no", "0", "No", "No")]
    [TestCase("Yes", "No", "Yes", "No")]
    public void Plan_reads_accepted_spellings_as_canonical_yes_no(string family, string shared, string expectedFamily, string expectedShared) {
        var parsed = Parse(family, shared);
        Assert.That(parsed.Diagnostics, Is.Empty, string.Join("; ", parsed.Diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        var row = parsed.Value!.Types["A"];
        Assert.That((row["Show"].Kind, row["Show"].Text), Is.EqualTo((PortableValueKind.YesNo, expectedFamily)));
        Assert.That((row["Offset Symbol"].Kind, row["Offset Symbol"].Text), Is.EqualTo((PortableValueKind.YesNo, expectedShared)));
    }

    [TestCase("2", "Show")]
    [TestCase("Noj3-a-1", "Show")]
    public void Plan_refuses_a_family_yes_no_value_outside_the_set(string cell, string parameter) =>
        AssertRefused(Parse(cell, "Yes"), parameter, cell);

    [TestCase("-5")]
    [TestCase("Noj3-a-1")]
    public void Plan_refuses_a_shared_yes_no_value_outside_the_set(string cell) =>
        AssertRefused(Parse("Yes", cell), "Offset Symbol", cell);

    [Test]
    public void Parameter_level_value_is_read_the_same_way() {
        var parsed = FamilyModelJson.Parse(("""{"family":HEADER,"parameters":{"Show":{"dataType":"YesNo","value":"TRUE"}},"types":{"A":{}}}""").Replace("HEADER", Header));
        Assert.That(parsed.Diagnostics, Is.Empty);
        Assert.That(parsed.Value!.Parameters["Show"].Value?.Text, Is.EqualTo("Yes"));
    }

    private static void AssertRefused(FamilyModelParseResult parsed, string parameter, string value) {
        var refusal = parsed.Diagnostics.Single(d => d.Code == FamilyModelDiagnosticCodes.ValueDataTypeMismatch);
        Assert.That(refusal.Path, Is.EqualTo($"$.types.A.{parameter}"));
        Assert.That(refusal.Message, Does.Contain($"'{value}'").And.Contain(parameter));
    }
}
