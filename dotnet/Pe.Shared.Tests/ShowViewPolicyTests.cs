using Pe.Shared.RevitData;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class ShowViewPolicyTests {
    private static ShowViewInfo V(long id, string name, ShowViewRole role, bool active = false, bool level = false) =>
        new(id, name, role, active, level);

    [Test]
    public void Sheet_active_view_is_never_a_candidate_and_default_3d_leads() {
        var order = ShowViewPolicy.Order([
            V(1, "A101", ShowViewRole.NonModel, active: true),
            V(2, "Zeta 3D", ShowViewRole.ThreeD), V(3, "{3D}", ShowViewRole.ThreeD),
            V(4, "Level 1", ShowViewRole.Plan, level: true), V(5, "Level 9", ShowViewRole.Plan),
        ]);
        Assert.That(order.Select(v => v.Id), Is.EqualTo(new long[] { 3, 2, 4 }));
    }

    [Test]
    public void Active_model_view_goes_first() {
        var order = ShowViewPolicy.Order([V(3, "{3D}", ShowViewRole.ThreeD), V(4, "Level 1", ShowViewRole.Plan, active: true)]);
        Assert.That(order.Select(v => v.Id), Is.EqualTo(new long[] { 4, 3 }));
    }

    [Test]
    public void No_model_views_yields_nothing_and_candidates_are_capped() {
        Assert.That(ShowViewPolicy.Order([V(1, "Sched", ShowViewRole.NonModel, active: true)]), Is.Empty);
        var many = Enumerable.Range(1, 30).Select(i => V(i, $"v{i:00}", ShowViewRole.ThreeD));
        Assert.That(ShowViewPolicy.Order(many), Has.Count.EqualTo(ShowViewPolicy.MaxCandidates));
    }
}
