using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

/// <summary>
///     The heal backstop on Revit's own numbers: EX 1 before and after the cap on 11620957:1, verbatim from the D8
///     preview receipt on cloud Chadds (Pe.Tools/.artifacts/tmp/d8-drive/h9-heal-review.txt, 2026-10-30).
/// </summary>
[TestFixture]
public sealed class DuctSystemHarmTests {
    private static readonly DuctSection One = new(1, 444, 0.00618, [10163852, 12008463, 12071389, 14609156]);
    private static readonly long[] Run = [10727804, 11620957, 11830107, 11830110, 11830112, 12067726, 12067739, 12067743, 12069931, 12070739, 12071082, 12071271, 12071394, 14609156];

    private static DuctSystem Ex1(bool well, double loss, int[] critical, params DuctSection[] sections) =>
        new(10163824, "EX 1", "ExhaustAir", well, null, null, loss, critical, sections);

    private static readonly DuctSystem Before = Ex1(true, 0.12861, [1, 2], One, new DuctSection(2, 444, 0.12243, Run));

    [Test]
    public void A_cap_on_a_fans_only_outlet_is_named_as_harm() {
        var after = Ex1(false, 0, [], One, new DuctSection(2, 444, 0, Run), new DuctSection(3, 0, 0, [11620957, 14847356]));
        Assert.That(DuctSystemHarm.Of(Before, after),
            Is.EqualTo("would leave EX 1 with no way for its air: not well connected; 0 cfm section 3"));
    }

    [Test]
    public void A_heal_that_leaves_the_calculation_as_it_was_passes() =>
        Assert.That(DuctSystemHarm.Of(Before, Before), Is.Null);

    [Test]
    public void A_system_already_not_well_connected_is_judged_on_new_dead_sections_only() {
        var broken = Before with { IsWellConnected = false };
        Assert.Multiple(() => {
            Assert.That(DuctSystemHarm.Of(broken, broken), Is.Null);
            Assert.That(DuctSystemHarm.Of(broken, broken with { Sections = [..broken.Sections, new DuctSection(3, 0, 0, [1])] }),
                Is.EqualTo("would leave EX 1 with no way for its air: 0 cfm section 3"));
        });
    }
}
