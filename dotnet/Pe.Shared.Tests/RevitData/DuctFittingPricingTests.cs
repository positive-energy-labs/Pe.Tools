using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;
using System.Runtime.CompilerServices;

namespace Pe.Shared.Tests.RevitData;

[TestFixture]
public sealed class DuctFittingPricingTests {
    private static string Folder([CallerFilePath] string source = "") =>
        Path.Combine(Path.GetDirectoryName(source)!, "Fixtures", "Ashrae");

    private static IReadOnlyDictionary<string, AshraeGrid> Table(string id) => AshraeTables.Read(Folder(), [id]).Tables[id];

    [Test]
    public void Lookup_matches_the_web_pins() {
        // The same numbers losses.test.ts pins for lookupGrid.
        Assert.That(AshraeLookup.Value(Table("CD3-2")["Co"], 8), Is.EqualTo(0.24).Within(1e-6));
        Assert.That(AshraeLookup.Value(Table("CD3-2")["Co"], 4.5), Is.EqualTo(0.335).Within(1e-6));
        Assert.That(AshraeLookup.Value(Table("CD3-2")["Co"], 12), Is.EqualTo(AshraeLookup.Value(Table("CD3-2")["Co"], 10)), "clamped at the edge");
        Assert.That(AshraeLookup.Value(Table("SD5-9")["Cb"], 0.4292, 0.36), Is.EqualTo(0.9704).Within(1e-4));
        Assert.That(AshraeLookup.Value(Table("SD5-9")["Cs"], 0.5708, 1), Is.EqualTo(0.1788).Within(1e-4));
        Assert.That(AshraeLookup.Value(Table("SR4-3")["Co"], 45, 1.698), Is.EqualTo(0.921).Within(1e-3));
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(Table("SR4-3")["Co"], 45));
    }

    [Test]
    public void Takeoff_legs_price_as_revit_reports_them() {
        // srv-spike5 (2026-10-05) and srv-1-apply (2026-10-12), Round Takeoff 12085147 at the end of SA 32: legs 0 and 1 are the main
        // (32 in, 0 and 13.333 cfs), -1 the 8 in branch (13.333 cfs); items (-1,1) and (-1,0).
        static double A(double inches) => Math.PI * Math.Pow(inches / 24, 2);
        var legs = new[] { new LossLeg(0, 0, A(32), true, false), new LossLeg(1, 13.333, A(32), true, false), new LossLeg(-1, 13.333, A(8), true, true) };
        var sd59 = Table("SD5-9");
        var branch = DuctFittingPricing.Price("Tee", sd59, legs, new LossItem(-1, 1));
        var straight = DuctFittingPricing.Price("Tee", sd59, legs, new LossItem(-1, 0));
        Assert.That(branch, Is.EqualTo(AshraeLookup.Value(sd59["Cb"], 1.0, A(8) / A(32))).Within(1e-9), "branch: Cb over Qb/Qc = 1, Ab/Ac = 1/16");
        Assert.That(straight, Is.Zero, "straight leg with no flow prices 0, not the grid edge (session 2026-10-12 read 8500 there)");
        Assert.That(DuctFittingPricing.Price("Tee", sd59, [legs[0], legs[1] with { Flow = 0 }, legs[2] with { Flow = 0 }], new LossItem(-1, 1)), Is.Zero, "no flow prices 0");
    }

    [Test]
    public void Transition_and_elbow_price_on_their_areas() {
        static double A(double inches) => Math.PI * Math.Pow(inches / 24, 2);
        var legs = new[] { new LossLeg(0, 2, A(10), true, true), new LossLeg(1, 2, A(13.03), false, false) };
        Assert.That(DuctFittingPricing.Price("Transition", Table("SR4-3"), legs, new LossItem(0, 1)),
            Is.EqualTo(AshraeLookup.Value(Table("SR4-3")["Co"], 45, A(13.03) / A(10))).Within(1e-9));
        Assert.That(DuctFittingPricing.Price("Elbow", Table("CD3-2"), [new LossLeg(0, 1, A(8), true, true), new LossLeg(1, 1, A(8), true, false)], new LossItem(0, 1)),
            Is.EqualTo(0.24).Within(1e-6));
    }
}
