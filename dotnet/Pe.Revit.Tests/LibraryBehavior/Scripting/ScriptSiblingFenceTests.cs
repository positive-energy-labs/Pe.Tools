using Pe.Revit.Scripting.Execution;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

/// <summary>
///     A script run is fenced to the document it runs on (D14), through the real execution service on real Revit:
///     with a second project open, what the script commits there is gone after the run and the result says so,
///     while the target's change is kept or discarded as its mode says. The platform facts are in
///     SiblingFenceProofTests, and the words in ScriptChangeLedgerTests.
///     Mutant, run red once (2026-11-14). "no fence": `continue;` as the first statement of the loop in
///     SiblingFence.Raise, so no sibling is held: 5 of the 6 tests fail (ReadOnly answers the old PERSISTED
///     error naming the sibling), and only the run-opened document test, which needs no fence, passes.
/// </summary>
[TestFixture]
public sealed class ScriptSiblingFenceTests {
    private const string Original = "__pe_original__";
    private const string SiblingChanged = "__pe_sibling_changed__";
    private const string TargetChanged = "__pe_target_changed__";

    // Activator stands in for a called library: policy refuses `new Transaction` in a ReadOnly or WriteTransaction
    // script's own source, and a library the script calls is not read by policy.
    private static string CommitOnSibling(string siblingTitle) => $$"""
        var sibling = app.Application.Documents.Cast<Document>().First(each => each.Title == "{{siblingTitle}}");
        using (var transaction = (Transaction)Activator.CreateInstance(typeof(Transaction), sibling, "Rename sibling")!) {
            _ = transaction.Start();
            sibling.ProjectInformation.Name = "{{SiblingChanged}}";
            WriteLine("sibling commit " + transaction.Commit());
        }
        WriteLine("sibling inside " + sibling.ProjectInformation.Name);

        """;

    private const string ChangeTarget = $"doc!.ProjectInformation.Name = \"{TargetChanged}\";";
    private const string CommitOnTarget =
        $"using (var own = new Transaction(doc, \"Rename target\")) {{ _ = own.Start(); doc!.ProjectInformation.Name = \"{TargetChanged}\"; _ = own.Commit(); }}";

    [Test]
    public void ReadOnly_rolls_back_a_sibling_commit_and_keeps_nothing_in_the_target(UIApplication uiApplication) =>
        SiblingCommitIsRolledBack(uiApplication, ScriptPermissionMode.ReadOnly, ChangeTarget, Original);

    [Test]
    public void WriteTransaction_rolls_back_a_sibling_commit_and_keeps_the_target_change(UIApplication uiApplication) =>
        SiblingCommitIsRolledBack(uiApplication, ScriptPermissionMode.WriteTransaction, ChangeTarget, TargetChanged);

    [Test]
    public void NoTransaction_rolls_back_a_sibling_commit_and_keeps_the_target_commit(UIApplication uiApplication) =>
        SiblingCommitIsRolledBack(uiApplication, ScriptPermissionMode.NoTransaction, CommitOnTarget, TargetChanged);

    private static void SiblingCommitIsRolledBack(
        UIApplication uiApplication, ScriptPermissionMode mode, string targetChange, string targetAfter) {
        var (target, sibling) = OpenPair(uiApplication);
        var siblingTitle = sibling.Title;

        var result = Run(uiApplication, target, CommitOnSibling(siblingTitle) + targetChange, mode, "both");

        Console.WriteLine($"[PE_SIBLING_FENCE_RUN] {mode}: {result.Status}; {result.Changes?.Summary}; sibling modified={sibling.IsModified}; {Words(result)}");
        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
        Assert.Multiple(() => {
            // The commit happened inside the run: without these two lines a green test proves nothing.
            Assert.That(result.Output, Does.Contain("sibling commit Committed"));
            Assert.That(result.Output, Does.Contain("sibling inside " + SiblingChanged));
            Assert.That(sibling.ProjectInformation.Name, Is.EqualTo(Original), "the sibling's change is gone");
            Assert.That(sibling.IsModified, Is.False, "the sibling is not left with unsaved changes");
            Assert.That(target.ProjectInformation.Name, Is.EqualTo(targetAfter), "the target follows its mode");
        });
        Assert.That(result.Failures, Has.Count.EqualTo(1), "the rolled-back sibling commit is one failure row");
        Assert.Multiple(() => {
            var failure = result.Failures![0];
            Assert.That(failure.Transaction, Is.EqualTo("Rename sibling"));
            Assert.That(failure.Outcome, Is.EqualTo(ScriptFailureOutcome.RolledBack));
            Assert.That(failure.DefinitionId, Is.Empty);
            Assert.That(failure.Message, Is.EqualTo(
                $"A script changes only the document it runs on. This run committed 'Rename sibling' in '{siblingTitle}' (1 element), and that was rolled back: nothing changed there. To change '{siblingTitle}', run the script on it."));

            var said = $"The run also committed 1 transaction in '{siblingTitle}', which it was not run on. That was rolled back: a script changes only the document it runs on.";
            Assert.That(result.Changes!.Summary, Does.EndWith(said));
            Assert.That(result.Changes.Modified.Ids, Does.Contain(target.ProjectInformation.Id.Value), "the target's change is still reported");
            Assert.That(result.Changes.Transactions, Has.None.EqualTo("Rename sibling"), "the sibling's commit is not one of the run's kept commits");
            Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Stage == "fence"
                && diagnostic.Severity == ScriptDiagnosticSeverity.Warning && diagnostic.Message == said), Is.True, Words(result));
        });
    }

    [Test]
    public void A_document_the_script_opens_itself_is_no_sibling_and_keeps_its_commit(UIApplication uiApplication) {
        var (target, sibling) = OpenPair(uiApplication);
        var before = uiApplication.Application.Documents.Cast<Document>().ToList();

        var result = Run(uiApplication, target, """
            var opened = app.Application.NewProjectDocument(UnitSystem.Imperial);
            using (var transaction = new Transaction(opened, "Rename opened")) {
                _ = transaction.Start();
                opened.ProjectInformation.Name = "__pe_opened_by_run__";
                WriteLine("opened commit " + transaction.Commit());
            }
            """, ScriptPermissionMode.NoTransaction, "opens");

        var opened = uiApplication.Application.Documents.Cast<Document>().Single(each => before.All(known => !known.Equals(each)));
        try {
            Assert.Multiple(() => {
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
                Assert.That(result.Output, Does.Contain("opened commit Committed"));
                Assert.That(opened.ProjectInformation.Name, Is.EqualTo("__pe_opened_by_run__"), "the run's own document keeps its commit");
                Assert.That(result.Failures, Is.Empty);
                Assert.That(result.Changes!.Summary, Does.Not.Contain("rolled back"));
                Assert.That(sibling.ProjectInformation.Name, Is.EqualTo(Original));
            });
        } finally {
            _ = opened.Close(false);
        }
    }

    // Revit refuses Save on a document with a transaction group open (SiblingFenceProofTests), so a run cannot
    // save a sibling. The script fails on Revit's exception and the result says why in plain words. The script's
    // own source calls Save, so the run is ungrouped and only the fence holds anything.
    [Test]
    public void A_save_of_a_sibling_is_refused_and_the_result_says_why(UIApplication uiApplication) {
        var (target, sibling) = OpenPair(uiApplication);
        var siblingTitle = sibling.Title;

        var result = Run(uiApplication, target,
            $"app.Application.Documents.Cast<Document>().First(each => each.Title == \"{siblingTitle}\").Save();",
            ScriptPermissionMode.NoTransaction, "saver");

        Console.WriteLine($"[PE_SIBLING_FENCE_RUN] sibling save: {result.Status}; {Words(result)}");
        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.RuntimeFailed), Words(result));
            var said = result.Diagnostics.Single(diagnostic => diagnostic.Message.StartsWith("Revit refuses Save", StringComparison.Ordinal));
            Assert.That(said.Severity, Is.EqualTo(ScriptDiagnosticSeverity.Warning));
            Assert.That(said.Message, Does.StartWith("Revit refuses Save, SaveAs and synchronize on a document that has a transaction or a transaction group open. This run holds one on every other open document ("));
            Assert.That(said.Message, Does.Contain($"'{siblingTitle}'"));
            Assert.That(said.Message, Does.EndWith("), so that a script changes only the document it runs on. To save another document, run the script on it."));
            Assert.That(said.Message, Does.Not.Contain("its own document"), "nothing held the run's own document");
            Assert.That(sibling.IsModified, Is.False);
        });
    }

    // F-W18-3: a Save the run's own undo group refuses must not be blamed on the fence. The delegate stands in for
    // a library: the script's own source has no Save call for the host to read, so the run stays grouped.
    [Test]
    public void A_save_of_the_runs_own_document_refused_by_its_undo_group_names_that_group(UIApplication uiApplication) {
        var (target, sibling) = OpenPair(uiApplication);

        var result = Run(uiApplication, target, "Action save = doc!.Save; save();", ScriptPermissionMode.NoTransaction, "library-saver");

        Console.WriteLine($"[PE_SIBLING_FENCE_RUN] own save: {result.Status}; {Words(result)}");
        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.RuntimeFailed), Words(result));
            var said = result.Diagnostics.Single(diagnostic => diagnostic.Message.StartsWith("Revit refuses Save", StringComparison.Ordinal));
            Assert.That(said.Message, Does.StartWith(
                "Revit refuses Save, SaveAs and synchronize on a document that has a transaction or a transaction group open. " +
                "This run holds one on its own document (so that its transactions are one undo entry; a script whose own source calls Save runs ungrouped, and this call was made from a library), and one on every other open document ("));
            Assert.That(said.Message, Does.Contain($"'{sibling.Title}'"));
            Assert.That(said.Message, Does.EndWith("To save the run's own document, use a NoTransaction script whose own source calls Save. To save another document, run the script on it."));
        });
    }

    // Revit opens no transaction group on a document that has a transaction open. A sibling the run cannot fence
    // refuses the run by name, before the script is entered.
    [Test]
    public void A_sibling_that_cannot_be_fenced_refuses_the_run_by_name(UIApplication uiApplication) {
        var (target, sibling) = OpenPair(uiApplication);
        var siblingTitle = sibling.Title;
        using var atWork = new Transaction(sibling, "Someone at work");
        Assert.That(atWork.Start(), Is.EqualTo(TransactionStatus.Started));
        ExecuteRevitScriptData result;
        try {
            result = Run(uiApplication, target, "WriteLine(\"ran\");\n" + ChangeTarget, ScriptPermissionMode.WriteTransaction, "refused");
        } finally {
            _ = atWork.RollBack();
        }

        Console.WriteLine($"[PE_SIBLING_FENCE_RUN] refused: {result.Status}; {Words(result)}");
        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected), Words(result));
            Assert.That(result.Output, Does.Not.Contain("ran"));
            Assert.That(target.ProjectInformation.Name, Is.EqualTo(Original));
            Assert.That(result.Changes, Is.Null, "a run that was never entered changed nothing and says nothing");
            var refusal = result.Diagnostics.Single(diagnostic => diagnostic.Stage == "fence");
            Assert.That(refusal.Severity, Is.EqualTo(ScriptDiagnosticSeverity.Error));
            Assert.That(refusal.Message, Does.StartWith(
                $"The script was not run. A script changes only the document it runs on, and Revit would not let the run protect '{siblingTitle}', which is also open: "));
            Assert.That(refusal.Message, Does.EndWith($"Close '{siblingTitle}', or run the script on a copy in its own Revit."));
        });
    }

    private static ExecuteRevitScriptData Run(UIApplication uiApplication, Document document, string script, ScriptPermissionMode mode, string name) =>
        RevitScriptExecutionService.CreateDefault(() => uiApplication).Execute(document,
            new ExecuteRevitScriptRequest(script, SourceName: name, PermissionMode: mode), "fence-" + Guid.NewGuid().ToString("N"));

    private static string Words(ExecuteRevitScriptData result) =>
        string.Join("; ", result.Diagnostics.Select(diagnostic => $"{diagnostic.Stage} {diagnostic.Severity}: {diagnostic.Message}"));

    /// <summary>Two saved blank projects this test owns: the active target, and a sibling open beside it.</summary>
    private static (Document Target, Document Sibling) OpenPair(UIApplication uiApplication) {
        var token = Guid.NewGuid().ToString("N").Substring(0, 8);
        Document Open(string role, bool activate) {
            var path = Path.Combine(RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("script-fence-" + role), $"Fence-{token}-{role}.rvt");
            var blank = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
            using (var transaction = new Transaction(blank, "Name the fixture")) {
                _ = transaction.Start();
                blank.ProjectInformation.Name = Original;
                _ = transaction.Commit();
            }
            blank.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
            _ = blank.Close(false);
            return activate ? uiApplication.OpenAndActivateDocument(path).Document : uiApplication.Application.OpenDocumentFile(path);
        }

        var sibling = Open("sibling", activate: false);
        return (Open("target", activate: true), sibling);
    }
}
