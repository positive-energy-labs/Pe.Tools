using Pe.Revit.Global.Services.Host;
using Pe.Revit.Operations;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

/// <summary>
///     What the runner states a call touched, from the scope's own record and the changes Revit reported.
///     Deterministic: <see cref="OpRunner.Touch" /> is pure. That Revit reports the changes these rows assume is
///     the fresh rung's to prove (OpScopeProofTests).
/// </summary>
[TestFixture]
public sealed class OpTouchedTests {
    private static ObservedChange Commit(string name, bool contained = false) => new("Project1", [name], 1, 2, 0, contained);
    private static readonly string[] CropNames = ["PE temporary crop", "PE restore crop"];
    private static ScopeFacts Facts(bool used = false, bool posted = false, string[]? own = null, params ScopeRestore[] restores) =>
        new(used, posted, own ?? [], restores);
    private static ScopeRestore Crop(bool held) => new("doc-a", "view-uid-1", 4001, ViewTemporary.Crop | ViewTemporary.AnnotationCrop, held);

    [Test]
    public void A_read_that_commits_is_unauthorized_and_names_what_changed() {
        var touched = OpRunner.Touch(OpEffect.Read, ScopeFacts.None, [Commit("Rogue commit")], false);
        Assert.That(touched, Is.EqualTo(new Touched.Unauthorized(["Rogue commit"], 1, 2, 0)).Using<Touched>(Same));
    }

    // Purger N1. Mutant: put `&& !overlapped` back on the unauthorized case with no overlapped case above it,
    // and both lines read `none` and `rolledBack`.
    [Test]
    public void A_commit_seen_beside_another_open_call_is_unknown_never_clean_and_never_blamed() {
        var unknown = new Touched.Unknown(TouchedUnknownReason.Overlapped);
        Assert.That(OpRunner.Touch(OpEffect.Read, ScopeFacts.None, [Commit("Another call")], true), Is.EqualTo(unknown));
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, Facts(used: true), [Commit("Flex", true), Commit("Another call")], true), Is.EqualTo(unknown));
        // With nothing stray, an overlap changes nothing.
        Assert.That(OpRunner.Touch(OpEffect.Read, ScopeFacts.None, [], true), Is.InstanceOf<Touched.None>());
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, Facts(used: true), [Commit("Flex", true)], true), Is.InstanceOf<Touched.RolledBack>());
    }

    // Purger N2. Mutant: drop `|| scope.Undiscarded` from the stray filter and the first line reads `rolledBack`.
    [Test]
    public void A_transact_read_whose_discard_did_not_happen_contained_nothing() {
        var undiscarded = new ScopeFacts(true, false, [], [], Undiscarded: true);
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, undiscarded, [Commit("Place verification row", true)], false),
            Is.InstanceOf<Touched.Unauthorized>());
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, undiscarded, [], false),
            Is.EqualTo(new Touched.Unknown(TouchedUnknownReason.CancelledMidEffect)));
    }

    [Test]
    public void A_read_that_saw_only_sandbox_churn_touched_nothing() =>
        Assert.That(OpRunner.Touch(OpEffect.Read, ScopeFacts.None, [Commit("PeSandbox::regen", true)], false), Is.InstanceOf<Touched.None>());

    [Test]
    public void A_transact_read_is_rolled_back_when_its_changes_were_contained_and_unauthorized_when_one_escaped() {
        var scope = ScopeFacts.None;
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, scope, [], false), Is.InstanceOf<Touched.None>());
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, Facts(used: true), [], false), Is.InstanceOf<Touched.RolledBack>());
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, scope, [Commit("Flex family", true)], false), Is.InstanceOf<Touched.RolledBack>());
        Assert.That(OpRunner.Touch(OpEffect.TransactRead, scope, [Commit("Flex family", true), Commit("Escaped")], false),
            Is.InstanceOf<Touched.Unauthorized>());
    }

    [Test]
    public void A_session_write_whose_undo_held_is_restored_and_its_own_commits_are_not_writes() {
        var scope = Facts(used: true, own: CropNames, restores: Crop(held: true));
        var touched = OpRunner.Touch(OpEffect.SessionWrite, scope, [Commit("PE temporary crop"), Commit("PE restore crop")], false);
        Assert.That(touched, Is.InstanceOf<Touched.Restored>());
        Assert.That(((Touched.Restored)touched).Views, Is.EqualTo(new[] { new ViewRef("doc-a", "view-uid-1", 4001) }));
    }

    // Mutant: drop the `left.Count != 0` branch in OpRunner.Touch and this reads `restored`.
    [Test]
    public void A_session_write_whose_undo_failed_names_the_view_and_what_it_was_left_with() {
        var scope = Facts(used: true, own: CropNames, restores: Crop(held: false));
        var touched = OpRunner.Touch(OpEffect.SessionWrite, scope, [Commit("PE temporary crop")], false);
        Assert.That(touched, Is.InstanceOf<Touched.RestoreFailed>());
        var left = ((Touched.RestoreFailed)touched).Views.Single();
        Assert.That(left.View, Is.EqualTo(new ViewRef("doc-a", "view-uid-1", 4001)));
        Assert.That(left.Left, Is.EqualTo(new[] { ViewLeftover.Crop, ViewLeftover.AnnotationCrop }));
    }

    [Test]
    public void A_write_states_its_transactions_and_counts_and_a_posted_command_is_unknown() {
        var scope = ScopeFacts.None;
        Assert.That(OpRunner.Touch(OpEffect.ModelWrite, scope, [], false), Is.InstanceOf<Touched.None>());
        Assert.That(OpRunner.Touch(OpEffect.ModelWrite, scope, [Commit("Pe Apply Schedule"), Commit("Pe Apply Schedule")], false),
            Is.EqualTo(new Touched.Wrote(["Pe Apply Schedule"], 2, 4, 0)).Using<Touched>(Same));
        Assert.That(OpRunner.Touch(OpEffect.SessionWrite, ScopeFacts.None, [Commit("Lens: Pe lens")], false), Is.InstanceOf<Touched.Wrote>());
        Assert.That(OpRunner.Touch(OpEffect.ModelWrite, Facts(used: true, posted: true), [Commit("Whatever ran first")], false),
            Is.EqualTo(new Touched.Unknown(TouchedUnknownReason.PostedCommand)));
    }

    // Records compare their List members by reference, so compare what crosses the wire.
    private static bool Same(Touched left, Touched right) =>
        Newtonsoft.Json.JsonConvert.SerializeObject(left) == Newtonsoft.Json.JsonConvert.SerializeObject(right);
}
