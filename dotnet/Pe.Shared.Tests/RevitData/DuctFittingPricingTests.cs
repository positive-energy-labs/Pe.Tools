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
        Assert.That(AshraeLookup.Value(Table("CD3-2")["Co"], new Dictionary<string,double> { ["D, in.(mm)"] = 8 }), Is.EqualTo(0.24).Within(1e-6));
        Assert.That(AshraeLookup.Value(Table("CD3-2")["Co"], new Dictionary<string,double> { ["D, in.(mm)"] = 4.5 }), Is.EqualTo(0.335).Within(1e-6));
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(Table("CD3-2")["Co"], new Dictionary<string,double> { ["D, in.(mm)"] = 12 }));
        Assert.That(AshraeLookup.Value(Table("SD5-9")["Cb"], new Dictionary<string,double> { ["Qb/Qc"] = 0.4292, ["Ab/Ac"] = 0.36 }), Is.EqualTo(0.9704).Within(1e-4));
        Assert.That(AshraeLookup.Value(Table("SD5-9")["Cs"], new Dictionary<string,double> { ["Qs/Qc"] = 0.5708, ["As/Ac"] = 1 }), Is.EqualTo(0.1788).Within(1e-4));
        Assert.That(AshraeLookup.Value(Table("SR4-3")["Co"], new Dictionary<string,double> { ["Theta"] = 45, ["Ao/A1"] = 1.698 }), Is.EqualTo(0.921).Within(1e-3));
        Assert.Throws<ArgumentException>(() => AshraeLookup.Value(Table("SR4-3")["Co"], new Dictionary<string,double> { ["Theta"] = 45 }));
    }

    [Test]
    public void Takeoff_legs_price_as_revit_reports_them() {
        // srv-spike5 (2026-10-05) and srv-1-apply (2026-10-12), Round Takeoff 12085147 at the end of SA 32: legs 0 and 1 are the main
        // (32 in, 0 and 13.333 cfs), -1 the 8 in branch (13.333 cfs); items (-1,1) and (-1,0).
        static double A(double inches) => Math.PI * Math.Pow(inches / 24, 2);
        var legs = new[] { new LossLeg(0, 0, A(32), true, "out"), new LossLeg(1, 13.333, A(32), true, "out"), new LossLeg(-1, 13.333, A(8), true, "in") };
        var sd59 = Table("SD5-9");
        var branch = DuctFittingPricing.TryPrice("Tee", sd59, legs, new LossItem(-1, 1)).Coefficient;
        var straight = DuctFittingPricing.TryPrice("Tee", sd59, legs, new LossItem(-1, 0)).Coefficient;
        Assert.That(branch, Is.EqualTo(AshraeLookup.Value(sd59["Cb"], new Dictionary<string,double> { ["Qb/Qc"] = 1, ["Ab/Ac"] = A(8)/A(32) })).Within(1e-9), "branch: Cb over Qb/Qc = 1, Ab/Ac = 1/16");
        Assert.That(straight, Is.Zero, "straight leg with no flow prices 0, not the grid edge (session 2026-10-12 read 8500 there)");
        Assert.That(DuctFittingPricing.TryPrice("Tee", sd59, [legs[0], legs[1] with { Flow = 0 }, legs[2] with { Flow = 0 }], new LossItem(-1, 1)).Coefficient, Is.Zero, "no flow prices 0");
    }

    [Test]
    public void Transition_and_elbow_price_on_their_areas() {
        static double A(double inches) => Math.PI * Math.Pow(inches / 24, 2);
        var legs = new[] { new LossLeg(0, 2, A(10), true, "in"), new LossLeg(1, 2, A(13.03), false, "out") };
        Assert.That(DuctFittingPricing.TryPrice("Transition", Table("SR4-3"), legs, new LossItem(0, 1), 45).Coefficient,
            Is.EqualTo(AshraeLookup.Value(Table("SR4-3")["Co"], new Dictionary<string,double> { ["Theta"] = 45, ["Ao/A1"] = A(13.03)/A(10) })).Within(1e-9));
        Assert.That(DuctFittingPricing.TryPrice("Elbow", Table("CD3-2"), [new LossLeg(0, 1, A(8), true, "in"), new LossLeg(1, 1, A(8), true, "out")], new LossItem(0, 1)).Coefficient,
            Is.EqualTo(0.24).Within(1e-6));
    }
    [Test]
    public void Physical_transition_pair_uses_explicit_angle_and_is_independent_of_item_or_port_order() {
        // Actual 12398836 physical geometry. 45 is a stated test input, not a retained model observation.
        var legs = new[] { new LossLeg(0, 410 / 60.0, 1, false, "in"), new LossLeg(1, 410 / 60.0, Math.PI * 100 / 576, true, "out") };
        var table = Table("SD4-2");
        foreach (var ports in new[] { legs, Enumerable.Reverse(legs).ToArray() }) {
            var actual = DuctFittingPricing.TryPrice("Transition", table, ports, new LossItem(1, 0), 45);
            Assert.That(actual.Success, Is.True, actual.Error);
            Assert.That(actual.Coefficient, Is.EqualTo(0.05455015305021264).Within(1e-12));
        }
        Assert.That(DuctFittingPricing.TryPrice("Transition", table, legs, new LossItem(0, 1)).Error,
            Does.Contain("measured included angle"));
        Assert.That(DuctFittingPricing.TryPrice("Transition", table, legs, new LossItem(0, 1), 30).Coefficient,
            Is.Not.EqualTo(DuctFittingPricing.TryPrice("Transition", table, legs, new LossItem(0, 1), 60).Coefficient), "angle is consumed, never replaced by 45");
    }

    [TestCase("in", "in")]
    [TestCase("out", "out")]
    [TestCase("bidirectional", "bidirectional")]
    [TestCase("in", "n/a")]
    public void Unknown_transition_orientation_is_a_failure_not_a_zero(string first, string second) {
        var legs = new[] { new LossLeg(0, 1, 1, true, first), new LossLeg(1, 1, .5, true, second) };
        var actual = DuctFittingPricing.TryPrice("Transition", Table("SD4-2"), legs, new LossItem(0, 1), 45);
        Assert.That(actual.Success, Is.False);
        Assert.That(actual.Coefficient, Is.Null);
        Assert.That(actual.Error, Does.Contain("exactly one In and one Out"));
    }

    [Test]
    public void Missing_or_unsupported_pricing_is_distinct_from_observed_zero_flow() {
        var legs = new[] { new LossLeg(0, 1, 1, true, "in"), new LossLeg(1, 1, 1, true, "out") };
        Assert.That(DuctFittingPricing.TryPrice("Elbow", null, legs, new LossItem(0, 1)).Success, Is.False);
        Assert.That(DuctFittingPricing.TryPrice("Union", Table("CD3-2"), legs, new LossItem(0, 1)).Success, Is.False);
        Assert.That(DuctFittingPricing.TryPrice("Transition", new Dictionary<string, AshraeGrid>(), legs, new LossItem(0, 1), 45).Success, Is.False);
        var zero = DuctFittingPricing.TryPrice("Transition", null, legs.Select(l => l with { Flow = 0 }).ToArray(), new LossItem(0, 1));
        Assert.That(zero.Success, Is.True);
        Assert.That(zero.Coefficient, Is.Zero);
    }

    [Test]
    public void Reading_three_coordinate_negative_samples_does_not_admit_unqualified_junction_pricing() {
        var legs = new[] { new LossLeg(0, 3, 1, true, "in"), new LossLeg(1, 1, .5, true, "out"), new LossLeg(2, 2, .5, true, "out") };
        var priced = DuctFittingPricing.TryPrice("Tee", Table("ER5-1"), legs, new(0,1));
        Assert.That(priced.Coefficient, Is.Null);
        Assert.That(priced.Error, Does.Contain("does not qualify"));
    }

}
