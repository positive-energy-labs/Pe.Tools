using Pe.Shared.Scripting.Execution;

namespace Pe.Revit.Tests;

/// <summary>
/// The ReadOnly guard's persist-vs-contained decision. Regression cover for the
/// ViewSchedule.GetTableData false positive: a regeneration the script's reads force raises
/// DocumentChanged under the guard's own transaction name (or none), which the guard once misread —
/// via a Document-reference check — as a write that escaped and PERSISTED. Only a real, non-guard
/// transaction name is an escape.
/// </summary>
[TestFixture]
public sealed class ReadOnlyGuardMutationClassifierTests {
    private const string Guard = "PeSandbox::Pe Script ReadOnly";

    [Test]
    public void The_guards_own_transaction_is_contained() =>
        Assert.That(ReadOnlyGuardMutationClassifier.EscapedGuard([Guard], Guard), Is.False);

    [Test]
    public void Regeneration_without_a_transaction_name_is_contained() {
        Assert.That(ReadOnlyGuardMutationClassifier.EscapedGuard([], Guard), Is.False);
        Assert.That(ReadOnlyGuardMutationClassifier.EscapedGuard([""], Guard), Is.False);
        Assert.That(ReadOnlyGuardMutationClassifier.EscapedGuard(["   "], Guard), Is.False);
    }

    [Test]
    public void Guard_name_alongside_an_unnamed_regen_event_is_contained() =>
        Assert.That(ReadOnlyGuardMutationClassifier.EscapedGuard([Guard, ""], Guard), Is.False);

    [Test]
    public void A_foreign_transaction_name_escaped() =>
        Assert.That(ReadOnlyGuardMutationClassifier.EscapedGuard(["Rename wall"], Guard), Is.True);

    [Test]
    public void Guard_name_mixed_with_a_foreign_name_escaped() =>
        Assert.That(ReadOnlyGuardMutationClassifier.EscapedGuard([Guard, "Rename wall"], Guard), Is.True);
}
