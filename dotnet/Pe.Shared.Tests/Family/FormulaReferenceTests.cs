using Pe.Revit.Extensions.FamParameter.Formula;

namespace Pe.Revit.Tests;

/// <summary>Name-level half of the formula reference primitive; the FamilyParameter overloads stand on it.</summary>
[TestFixture]
public sealed class FormulaReferenceTests {
    [Test]
    public void Longer_name_consumes_its_span_before_the_shorter_name_is_tested() {
        string[] names = ["Width", "Half Width"];

        Assert.Multiple(() => {
            Assert.That(names.GetReferencedNames("Half Width"), Is.EquivalentTo(new[] { "Half Width" }));
            Assert.That(names.GetReferencedNames("Half Width + Width"), Is.EquivalentTo(new[] { "Half Width", "Width" }));
            Assert.That(names.GetReferencedNames("Width * 2"), Is.EquivalentTo(new[] { "Width" }));
            Assert.That(names.GetReferencedNames("Depth"), Is.Empty);
        });
    }
}
