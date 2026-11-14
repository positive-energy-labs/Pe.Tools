using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;

namespace Pe.Revit.Tests;

/// <summary>What a script result says about its changes and Revit's failures, from plain facts (slice 6, defect D5).</summary>
[TestFixture]
public sealed class ScriptChangeLedgerTests {
    private const ScriptPermissionMode Write = ScriptPermissionMode.NoTransaction;
    private const string Central = "Can't obtain permission to edit the element: The Central Model is inaccessible";

    private static ScriptCommit Commit(string name, long[]? added = null, long[]? modified = null, long[]? deleted = null) =>
        new([name], added ?? [], modified ?? [], deleted ?? []);

    private static ScriptRaisedFailure Failure(string transaction, int commitsBefore, string severity = "Error", bool dismissed = false) =>
        new(Central, severity, "0d9b1e3a-0000-0000-0000-000000000001", [77], transaction, commitsBefore, dismissed);

    private static ScriptChanges Changes(ScriptPermissionMode mode, ScriptCommit[] commits, ScriptRaisedFailure[]? raised = null, ScriptUndo? undo = null) =>
        ScriptChangeLedger.Changes(mode, commits, ScriptChangeLedger.Failures(mode, commits, raised ?? []), undo ?? new ScriptUndo());

    [Test]
    public void Ids_are_net_over_the_runs_commits_in_order() {
        var changes = Changes(Write, [
            Commit("one", added: [1, 2], modified: [10, 11]),
            Commit("two", added: [3], modified: [1, 10], deleted: [2, 11, 20])
        ], undo: new ScriptUndo("heal"));

        Assert.Multiple(() => {
            // 1 was added then modified: added. 2 was added then deleted: gone. 11 was modified then deleted: deleted.
            Assert.That(changes.Added.Ids, Is.EqualTo(new long[] { 1, 3 }));
            Assert.That(changes.Modified.Ids, Is.EqualTo(new long[] { 10 }));
            Assert.That(changes.Deleted.Ids, Is.EqualTo(new long[] { 11, 20 }));
            Assert.That(changes.Transactions, Is.EqualTo(new[] { "one", "two" }));
            Assert.That(changes.Kept, Is.True);
            Assert.That(changes.Undo, Is.EqualTo("heal"));
            Assert.That(changes.Summary, Is.EqualTo("Changed 5 elements (2 added, 1 modified, 2 deleted) in 2 transactions. One undo entry: 'heal'."));
        });
    }

    [Test]
    public void Id_lists_are_bounded_and_the_total_is_not() {
        var changes = Changes(Write, [Commit("big", modified: Enumerable.Range(1, 5000).Select(id => (long)id).ToArray())]);

        Assert.That(changes.Modified.Ids, Has.Count.EqualTo(ScriptChangeLedger.IdCap));
        Assert.That(changes.Modified.Total, Is.EqualTo(5000));
    }

    [Test]
    public void A_read_only_run_says_what_it_would_have_changed_and_keeps_nothing() {
        var changes = Changes(ScriptPermissionMode.ReadOnly, [Commit("PeSandbox::Pe Script ReadOnly", modified: [5])], undo: new ScriptUndo("ignored"));

        Assert.Multiple(() => {
            Assert.That(changes.Kept, Is.False);
            Assert.That(changes.Modified.Ids, Is.EqualTo(new long[] { 5 }));
            Assert.That(changes.Transactions, Is.Empty);
            Assert.That(changes.Undo, Is.Null);
            Assert.That(changes.Summary, Is.EqualTo("ReadOnly run: it would change 1 element (0 added, 1 modified, 0 deleted). Nothing was kept."));
        });
    }

    // D5: Transaction.Commit() answered RolledBack with no exception and no words.
    [Test]
    public void A_run_whose_every_transaction_rolled_back_says_so_in_revits_words() {
        ScriptRaisedFailure[] raised = [Failure("Set coefficient", 0), Failure("Set coefficient", 0)];
        var failures = ScriptChangeLedger.Failures(Write, [], raised);
        var changes = ScriptChangeLedger.Changes(Write, [], failures, new ScriptUndo("heal"));

        Assert.Multiple(() => {
            Assert.That(failures, Has.Count.EqualTo(1), "one failure processed twice is one failure");
            Assert.That(failures[0].Outcome, Is.EqualTo(ScriptFailureOutcome.RolledBack));
            Assert.That(failures[0].Message, Is.EqualTo(Central));
            Assert.That(failures[0].ElementIds, Is.EqualTo(new long[] { 77 }));
            Assert.That(changes.Undo, Is.Null);
            Assert.That(changes.Summary, Is.EqualTo(
                $"Nothing changed: Revit rolled back every transaction this run tried to commit ('Set coefficient'). Revit said: {Central}"));
        });
    }

    [Test]
    public void A_failure_is_committed_only_when_its_transaction_commits_after_it() {
        ScriptCommit[] commits = [Commit("first", modified: [1]), Commit("second", modified: [2])];
        var failures = ScriptChangeLedger.Failures(Write, commits, [
            Failure("first", 1),                                 // raised after 'first' had committed once: this attempt did not
            Failure("second", 1, "Warning"),                     // 'second' committed after it
            Failure("host", 2, "Warning", dismissed: true)
        ]);

        Assert.That(failures.Select(failure => failure.Outcome), Is.EqualTo(new[] {
            ScriptFailureOutcome.RolledBack, ScriptFailureOutcome.Committed, ScriptFailureOutcome.Dismissed
        }));
        Assert.That(ScriptChangeLedger.Changes(Write, commits, failures, new ScriptUndo("heal")).Summary, Is.EqualTo(
            $"Changed 2 elements (0 added, 2 modified, 0 deleted) in 2 transactions. One undo entry: 'heal'. Revit rolled back 1 transaction ('first'). Revit said: {Central}"));
    }

    [Test]
    public void A_run_that_could_not_be_grouped_says_why() {
        var changes = Changes(Write, [Commit("one", added: [1]), Commit("two", added: [2])],
            undo: new ScriptUndo(Ungrouped: "the script calls SaveAs, which Revit refuses inside a transaction group."));

        Assert.That(changes.Undo, Is.Null);
        Assert.That(changes.Ungrouped, Does.Contain("SaveAs"));
        Assert.That(changes.Summary, Does.EndWith("2 undo entries, not one: the script calls SaveAs, which Revit refuses inside a transaction group."));
    }

    [Test]
    public void A_save_in_the_scripts_own_source_is_a_call_revit_refuses_in_a_group() {
        static ScriptSourceSet Source(string content) => new([new ScriptSourceFile("heal.csx", content)], "heal.csx");

        Assert.Multiple(() => {
            Assert.That(ScriptChangeLedger.GroupRefusal(Source("doc.SaveAs(path, options);")), Is.EqualTo("SaveAs"));
            Assert.That(ScriptChangeLedger.GroupRefusal(Source("var family = doc.EditFamily(f); family.LoadFamily(doc, load);")), Is.Null);
            Assert.That(ScriptChangeLedger.GroupRefusal(Source("// doc.Save();\nvar text = \"x.Save()\";")), Is.Null);
        });
    }
}
