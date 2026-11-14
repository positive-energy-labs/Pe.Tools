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
        ScriptChangeLedger.Changes(mode, commits, ScriptChangeLedger.Failures(mode, Names(commits), raised ?? []), undo ?? new ScriptUndo());

    private static List<IReadOnlyList<string>> Names(ScriptCommit[] commits) => commits.Select(commit => commit.Transactions).ToList();

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
    public void A_failure_is_committed_only_when_the_very_next_commit_is_its_transaction() {
        ScriptCommit[] commits = [Commit("first", modified: [1]), Commit("second", modified: [2])];
        var failures = ScriptChangeLedger.Failures(Write, Names(commits), [
            Failure("first", 1),                                 // raised after 'first' had committed once: this attempt did not
            Failure("second", 1, "Warning"),                     // 'second' is the next commit
            Failure("host", 2, "Warning", dismissed: true)
        ]);

        Assert.That(failures.Select(failure => failure.Outcome), Is.EqualTo(new[] {
            ScriptFailureOutcome.RolledBack, ScriptFailureOutcome.Committed, ScriptFailureOutcome.Dismissed
        }));
        Assert.That(ScriptChangeLedger.Changes(Write, commits, failures, new ScriptUndo("heal")).Summary, Is.EqualTo(
            $"Changed 2 elements (0 added, 2 modified, 0 deleted) in 2 transactions. One undo entry: 'heal'. Revit rolled back 1 transaction ('first'). Revit said: {Central}"));
    }

    // Transaction names are not unique: a script commits "Set" twice, the first rolled back by an error.
    [Test]
    public void A_rolled_back_attempt_is_not_committed_by_a_later_transaction_of_the_same_name() {
        ScriptCommit[] commits = [Commit("Other", modified: [1]), Commit("Set", modified: [2])];
        var failures = ScriptChangeLedger.Failures(Write, Names(commits), [Failure("Set", 0)]);

        Assert.That(failures.Single().Outcome, Is.EqualTo(ScriptFailureOutcome.RolledBack));
        Assert.That(ScriptChangeLedger.Changes(Write, commits, failures, new ScriptUndo("heal")).Summary,
            Does.Contain("Revit rolled back 1 transaction ('Set')."));
    }

    // A commit in a family document is a commit: a warning there stands, though the run's own document lists none of it.
    [Test]
    public void A_failure_in_another_documents_transaction_is_judged_by_that_commit() {
        var failures = ScriptChangeLedger.Failures(Write, [["Family edit"]], [Failure("Family edit", 0, "Warning")]);

        Assert.That(failures.Single().Outcome, Is.EqualTo(ScriptFailureOutcome.Committed));
    }

    // The preprocessor and the event may both hand over one warning of one attempt; the acknowledged copy decides.
    [Test]
    public void A_warning_read_twice_in_one_attempt_is_dismissed_once() {
        var failures = ScriptChangeLedger.Failures(ScriptPermissionMode.WriteTransaction, [["Pe script: heal"]], [
            Failure("Pe script: heal", 0, "Warning", dismissed: true), Failure("Pe script: heal", 0, "Warning")
        ]);

        Assert.That(failures.Single().Outcome, Is.EqualTo(ScriptFailureOutcome.Dismissed));
    }

    [Test]
    public void A_run_beside_another_call_says_its_changes_may_be_the_others() {
        ScriptCommit[] commits = [Commit("one", added: [1])];
        var changes = ScriptChangeLedger.Changes(Write, commits, [], new ScriptUndo("heal"), overlapped: true);

        Assert.That(changes.Overlapped, Is.True);
        Assert.That(changes.Summary, Does.EndWith("Another call ran at the same time; these may include its changes."));
        Assert.That(ScriptChangeLedger.Changes(Write, commits, [], new ScriptUndo("heal")).Overlapped, Is.False);
    }

    // D14: a commit in a document the run was not run on is rolled back by the sibling fence. It is the host's
    // row, not one of Revit's, so the summary never says "Revit said" for it. Mutant, run red once (2026-11-14):
    // drop the `FencedWords` term from Changes; the summary no longer names the sibling.
    [Test]
    public void A_commit_in_a_document_the_run_was_not_run_on_is_reported_as_rolled_back() {
        ScriptFencedCommit[] fenced = [new("Chadds", ["Rename sibling"], 1), new("Chadds", ["Move", "Tag"], 3)];
        var changes = ScriptChangeLedger.Changes(Write, [Commit("one", added: [1])], [], new ScriptUndo("heal"), fenced: fenced);
        var failures = ScriptChangeLedger.FencedFailures(fenced);

        Assert.Multiple(() => {
            Assert.That(changes.Summary, Is.EqualTo(
                "Changed 1 element (1 added, 0 modified, 0 deleted) in 1 transaction. One undo entry: 'heal'. " +
                "The run also committed 2 transactions in 'Chadds', which it was not run on. Those were rolled back: a script changes only the document it runs on."));
            Assert.That(changes.Kept, Is.True);
            Assert.That(changes.Added.Ids, Is.EqualTo(new long[] { 1 }));
            Assert.That(failures.Select(failure => failure.Message), Is.EqualTo(new[] {
                "A script changes only the document it runs on. This run committed 'Rename sibling' in 'Chadds' (1 element), and that was rolled back: nothing changed there. To change 'Chadds', run the script on it.",
                "A script changes only the document it runs on. This run committed 'Move', 'Tag' in 'Chadds' (3 elements), and that was rolled back: nothing changed there. To change 'Chadds', run the script on it."
            }));
            Assert.That(failures.Select(failure => failure.Transaction), Is.EqualTo(new[] { "Rename sibling", "Move, Tag" }));
            Assert.That(failures, Has.All.Matches<ScriptFailure>(failure =>
                failure.Outcome == ScriptFailureOutcome.RolledBack && failure.DefinitionId.Length == 0 && failure.ElementIds.Count == 0));
            Assert.That(ScriptChangeLedger.Changes(ScriptPermissionMode.ReadOnly, [], [], new ScriptUndo(), fenced: fenced[..1]).Summary, Is.EqualTo(
                "ReadOnly run: it would change no element. The run also committed 1 transaction in 'Chadds', which it was not run on. That was rolled back: a script changes only the document it runs on."));
            Assert.That(ScriptChangeLedger.Changes(Write, [], [], new ScriptUndo()).Summary, Is.EqualTo("No element changed."));
        });
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
        // The set is the entrypoint's dependency closure: a helper in it that saves ungroups the run.
        ScriptSourceSet closure = new([new ScriptSourceFile("heals/heal.csx", "Keep.Variant(doc);"), new ScriptSourceFile("src/Keep.cs", "doc.SaveAs(path);")], "heals/heal.csx");

        Assert.Multiple(() => {
            Assert.That(ScriptChangeLedger.GroupRefusal(Source("doc.SaveAs(path, options);")), Is.EqualTo("SaveAs"));
            Assert.That(ScriptChangeLedger.GroupRefusal(Source("var family = doc.EditFamily(f); family.LoadFamily(doc, load);")), Is.Null);
            Assert.That(ScriptChangeLedger.GroupRefusal(closure), Is.EqualTo("SaveAs"));
            Assert.That(ScriptChangeLedger.GroupRefusal(Source("// doc.Save();\nvar text = \"x.Save()\";")), Is.Null);
        });
    }
}
