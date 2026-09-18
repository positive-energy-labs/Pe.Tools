using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>The one judgment of parameter-write evidence, admission groups and aliases (no document).</summary>
[TestFixture]
public sealed class ParameterEditPlanTests {
    private static ParameterTarget Target(long element, long parameter = -1001203, string? raw = "A") =>
        new(element, parameter, "Mark", RequestedParameterStorageType.String, false, raw != null, raw);

    private static ParameterEditPlan.Edit Edit(int group, ParameterTarget current, string value, ParameterTarget? expected) =>
        new(group, new ParameterValueEdit(current.ElementId, current.ParameterId, Value: value, Expected: expected), current);

    [Test]
    public void A_stale_expected_refuses_and_writes_nothing() {
        var plan = ParameterEditPlan.Build([Edit(0, Target(1, raw: "B"), "X", Target(1, raw: "A"))], dryRun: false);
        Assert.Multiple(() => {
            Assert.That(plan.Refusals[0], Is.EqualTo(ParameterEditPlan.Stale));
            Assert.That(plan.Writes, Is.Empty);
        });
    }

    [Test]
    public void A_wet_edit_without_expected_refuses_while_a_dry_one_is_admitted() {
        var edits = new[] { Edit(0, Target(1), "X", expected: null) };
        Assert.Multiple(() => {
            Assert.That(ParameterEditPlan.Build(edits, dryRun: false).Refusals[0], Is.EqualTo(ParameterEditPlan.MissingExpected));
            Assert.That(ParameterEditPlan.Build(edits, dryRun: true).Refusals[0], Is.Null);
            Assert.That(ParameterEditPlan.Build(edits, dryRun: true).Writes, Has.Count.EqualTo(1));
        });
    }

    [Test]
    public void Identical_edits_to_one_target_write_once() {
        var plan = ParameterEditPlan.Build([
            Edit(0, Target(1), "X", Target(1)),
            Edit(1, Target(1), "X", Target(1)),
            Edit(2, Target(2), "Y", Target(2))
        ], dryRun: false);
        Assert.Multiple(() => {
            Assert.That(plan.Refusals, Is.All.Null);
            Assert.That(plan.Writes, Has.Count.EqualTo(2));
            Assert.That(plan.WriteOf, Is.EqualTo(new[] { 0, 0, 1 }));
        });
    }

    [Test]
    public void Differing_aliases_refuse_their_whole_connected_group_and_nothing_else() {
        // Groups 0 and 1 share target 2 with differing values; group 1 also reaches target 3, which joins group 2
        // into the same connected group. Group 3 touches nothing shared and still writes.
        var plan = ParameterEditPlan.Build([
            Edit(0, Target(1), "X", Target(1)), Edit(0, Target(2), "X", Target(2)),
            Edit(1, Target(2), "Y", Target(2)), Edit(1, Target(3), "Y", Target(3)),
            Edit(2, Target(3), "Y", Target(3)),
            Edit(3, Target(4), "Z", Target(4))
        ], dryRun: false);
        Assert.Multiple(() => {
            Assert.That(plan.Refusals.Take(5), Is.All.EqualTo(ParameterEditPlan.AliasConflict));
            Assert.That(plan.Refusals[5], Is.Null);
            Assert.That(plan.Writes, Is.EqualTo(new[] { 5 }));
        });
    }

    [Test]
    public void A_refused_edit_refuses_its_group_and_leaves_it_out_of_alias_judgment() {
        // Group 0's second target is stale, so group 0 is out; group 1 then has no conflicting partner.
        var plan = ParameterEditPlan.Build([
            Edit(0, Target(1), "X", Target(1)), Edit(0, Target(2, raw: "B"), "X", Target(2)),
            Edit(1, Target(1), "Y", Target(1))
        ], dryRun: false);
        Assert.Multiple(() => {
            Assert.That(plan.Refusals[0], Is.EqualTo(ParameterEditPlan.GroupRefused));
            Assert.That(plan.Refusals[1], Is.EqualTo(ParameterEditPlan.Stale));
            Assert.That(plan.Refusals[2], Is.Null);
            Assert.That(plan.Writes, Is.EqualTo(new[] { 2 }));
        });
    }

    [Test]
    public void A_resolution_refusal_is_kept_as_the_answer() {
        var plan = ParameterEditPlan.Build([
            new ParameterEditPlan.Edit(0, new ParameterValueEdit(9, -1, Value: "X", Expected: Target(9)), null, "Element 9 was not found.")
        ], dryRun: false);
        Assert.That(plan.Refusals[0], Is.EqualTo("Element 9 was not found."));
    }
}
