using System.Globalization;
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     Proof for the one measured-cell door (`revit.resolve.unit-value`): what a person types is
///     Revit's to read, against the document's own units, and what comes back renders in the unit
///     the surface asked for. A human surface stages exactly this and nothing it invented.
/// </summary>
[TestFixture]
public sealed class UnitValueResolveProofTests {
    private static readonly string AirFlow = SpecTypeId.AirFlow.TypeId;

    [Test]
    public void Typed_text_is_read_by_the_document_and_answered_in_the_unit_the_surface_renders(
        UIApplication uiApplication
    ) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            // The document shows L/s; the surface renders CFM (a schedule field may override it).
            using (var transaction = new Transaction(document, "Seed document air flow units")) {
                _ = transaction.Start();
                var units = document.GetUnits();
                units.SetFormatOptions(SpecTypeId.AirFlow, new FormatOptions(UnitTypeId.LitersPerSecond));
                document.SetUnits(units);
                _ = transaction.Commit();
            }

            var cfm = UnitTypeId.CubicFeetPerMinute.TypeId;
            var converted = UnitValueResolver.Resolve(document, new UnitValueResolveRequest(AirFlow, cfm, "300 L/s"));
            var bare = UnitValueResolver.Resolve(document, new UnitValueResolveRequest(AirFlow, cfm, "300"));
            var refused = UnitValueResolver.Resolve(document, new UnitValueResolveRequest(AirFlow, cfm, "not a number"));

            Assert.Multiple(() => {
                // 300 L/s is 635.66 CFM: the number comes back in the unit the surface asked for.
                Assert.That(converted.Ok, Is.True, converted.Refusal);
                Assert.That(converted.Value, Is.EqualTo(635.664).Within(0.01));
                // The rendering carries no symbol: the surface draws the unit it already knows.
                Assert.That(converted.Text, Does.Not.Contain("CFM"));
                Assert.That(double.Parse(converted.Text!, CultureInfo.CurrentCulture), Is.EqualTo(converted.Value!.Value).Within(0.5));

                // A bare number is read in the DOCUMENT's unit, which is why a surface never sends one
                // for a value the person typed bare — it stages the display unit itself instead.
                Assert.That(bare.Ok, Is.True, bare.Refusal);
                Assert.That(bare.Value, Is.EqualTo(635.664).Within(0.01));

                Assert.That(refused.Ok, Is.False);
                Assert.That(refused.Value, Is.Null);
                Assert.That(refused.Refusal, Is.Not.Null.And.Not.Empty);
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
