using Newtonsoft.Json;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Operations;
using Pe.Revit.Scripting.Transport;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

/// <summary>
///     How a script run ends, on fresh Revit: what the document holds afterwards is read from the document, and
///     the run's report is checked against that reading. Every case runs a real script through
///     <see cref="OpRunner" /> under a ModelWrite scope, the scope scripting.execute declares; the op here runs
///     the script in place on the API thread, as the SDK op queue does, because the real op waits for an
///     external event a test cannot pump. Each case prints one [PE_PROOF] JSON row.
///     This file holds the cases that needed no ruling (a dialog, a leaked transaction, a normal return);
///     ScriptRollbackOnThrowProofTests.cs holds the 2026-11-18 ruling's.
/// </summary>
[TestFixture]
public sealed partial class ScriptRunProofTests {
    private const string FamilyName = "PeProofFam";
    private const string OpenTransactionKey = "pe-proof-open-transaction";
    private static UIApplication _ui = null!;
    private static ScriptingBridgeMessageHandler _scripting = null!;
    private static string _familyPath = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) {
        _ui = ui;
        OperationMonitor.Attach(ui.Application);
        _ = OpRegistry.RegisterFrom(typeof(ScriptRunProofTests).Assembly);
        _scripting = new ScriptingBridgeMessageHandler(() => _ui);
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(ScriptRunProofTests));
        _familyPath = Path.Combine(output, FamilyName + ".rfa");
        var family = RevitFamilyFixtureHarness.CreateFamilyDocument(ui.Application, BuiltInCategory.OST_GenericModel, FamilyName);
        using (var transaction = new Transaction(family, "Seed family type")) {
            _ = transaction.Start();
            _ = family.FamilyManager.NewType("A");
            Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        }
        family.SaveAs(_familyPath, new SaveAsOptions { OverwriteExistingFile = true });
        _ = family.Close(false);
    }

    [OneTimeTearDown]
    public void TearDown() => _scripting?.Dispose();

    [Op("test.proof.script", OpSubject.None, OpTouches.Metadata, Does = "Run a script in place under a ModelWrite scope.", Actor = OpActor.Any, IsPublic = false, Thread = OpThread.Revit)]
    private static ExecuteRevitScriptData ProofScript(ExecuteRevitScriptRequest request, RevitDocument target, ModelWrite scope, CancellationToken cancellationToken) =>
        _scripting.ExecuteOnApiThread(request, target, cancellationToken);

    private static (OpRun Ran, ExecuteRevitScriptData Result) Run(Document document, string script, string name, int timeoutSeconds = 0) {
        Assert.That(OpRegistry.TryGet("test.proof.script", out var op), Is.True);
        var ran = OpRunner.RunAsync(op,
            JsonConvert.SerializeObject(new ExecuteRevitScriptRequest(script, SourceName: name, PermissionMode: ScriptPermissionMode.NoTransaction, TimeoutSeconds: timeoutSeconds), SdkOperations.Json),
            SdkOperations.Wrap(op.Definition.Needs, document), CancellationToken.None).GetAwaiter().GetResult();
        Assert.That(ran.Response, Is.InstanceOf<ExecuteRevitScriptData>(), ran.Error?.ToString());
        return (ran, (ExecuteRevitScriptData)ran.Response!);
    }

    private static void Row(string name, object row) => Console.WriteLine($"[PE_PROOF] {name} " + JsonConvert.SerializeObject(row, Formatting.None));

    private static IEnumerable<string> Said(ExecuteRevitScriptData result, string stage, ScriptDiagnosticSeverity severity) =>
        result.Diagnostics.Where(diagnostic => diagnostic.Stage == stage && diagnostic.Severity == severity).Select(diagnostic => diagnostic.Message);

    /// <summary>A blank project with the test's own commit in it: two walls, one to delete and one to modify.</summary>
    private static (Document Document, long SeedDelete, long SeedKeep) Seeded(bool withFamily = false) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(_ui.Application);
        using var transaction = new Transaction(document, "Proof seed");
        _ = transaction.Start();
        var level = new FilteredElementCollector(document).OfClass(typeof(Level)).FirstElementId();
        var seedDelete = Wall.Create(document, Line.CreateBound(new XYZ(0, 0, 0), new XYZ(10, 0, 0)), level, false).Id.Value;
        var seedKeep = Wall.Create(document, Line.CreateBound(new XYZ(0, 5, 0), new XYZ(10, 5, 0)), level, false).Id.Value;
        if (withFamily) Assert.That(document.LoadFamily(_familyPath, out _), Is.True, "the seed family loads");
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return (document, seedDelete, seedKeep);
    }

    private const string Walls = """
        var level = new FilteredElementCollector(doc!).OfClass(typeof(Level)).FirstElementId();
        using (var t = new Transaction(doc, "Proof 1 add+modify")) {
            _ = t.Start();
            _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 100, 0), new XYZ(10, 100, 0)), level, false);
            _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 105, 0), new XYZ(10, 105, 0)), level, false);
            doc.ProjectInformation.Name = "__proof_modified__";
            WriteLine("commit 1: " + t.Commit());
        }
        """;

    private const string DeleteAndModify = """
        using (var t = new Transaction(doc, "Proof 2 delete+modify")) {
            _ = t.Start();
            _ = doc.Delete(new ElementId(SEED_DELETEL));
            _ = doc.GetElement(new ElementId(SEED_KEEPL)).get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS).Set("__proof_comment__");
            WriteLine("commit 2: " + t.Commit());
        }
        """;

    // The transaction is never committed, rolled back or disposed, so it is open when the script ends. The test
    // keeps the object only so that it can end the transaction afterwards and close its document.
    private const string LeftOpen = """
        var open = new Transaction(doc, "Proof 2 left open");
        _ = open.Start();
        _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 110, 0), new XYZ(10, 110, 0)), level, false);
        System.AppDomain.CurrentDomain.SetData("pe-proof-open-transaction", open);
        """;

    private static string Seeds(string script, long seedDelete, long seedKeep) =>
        script.Replace("SEED_DELETE", seedDelete.ToString()).Replace("SEED_KEEP", seedKeep.ToString()).Replace("FAMILY_PATH", _familyPath);

    /// <summary>
    ///     FOOTGUN: a script's leaked transaction cannot be ended by the run (RevitScriptExecutionService
    ///     LeakedTransactionWords). The run says which document was left with a transaction open and names it from
    ///     the source, the run fails whether the script threw or returned, and the document really is still
    ///     modifiable. The test holds the Transaction object only to end it afterwards; that a collected one does
    ///     not roll back was measured apart, with no reference kept (2026-11-18).
    /// </summary>
    [TestCase(true), TestCase(false)]
    public void A_leaked_transaction_is_named_and_fails_the_run(bool throws) {
        var (document, seedDelete, seedKeep) = Seeded();
        try {
            var before = Snapshot.Of(document, seedDelete, seedKeep);
            AppDomain.CurrentDomain.SetData(OpenTransactionKey, null);
            var (ran, result) = Run(document, Walls + LeftOpen + (throws ? "throw new System.InvalidOperationException(\"PROOF-THROW: a transaction is still open\");" : ""), "leak");
            var open = (Transaction)AppDomain.CurrentDomain.GetData(OpenTransactionKey)!;
            var modifiableAfterRun = document.IsModifiable;
            var statusAfterRun = open.GetStatus();
            _ = open.RollBack();
            open.Dispose();
            var after = Snapshot.Of(document, seedDelete, seedKeep);
            var said = Said(result, "transaction", ScriptDiagnosticSeverity.Error).ToList();
            Row($"leak throws={throws}", new { modifiableAfterRun, statusAfterRun = statusAfterRun.ToString(), read = after.Versus(before), touched = ran.Touched, status = result.Status.ToString(), said, changes = result.Changes });
            Assert.Multiple(() => {
                Assert.That(modifiableAfterRun, Is.True, "Revit gave the run no way to end the transaction");
                Assert.That(statusAfterRun, Is.EqualTo(TransactionStatus.Started));
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.RuntimeFailed));
                Assert.That(said.Count(message => message.Contains("still open on '" + document.Title + "'") && message.Contains("'Proof 2 left open'")
                    && !message.Contains("Proof 1 add+modify")), Is.EqualTo(1), string.Join(" | ", said));
                // The first commit is in the document: nothing could roll the run back past an open transaction.
                Assert.That(after.Walls, Is.EqualTo(before.Walls + 2));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>A dialog a script raises goes through the one dialog lane: it is answered, the script goes on, and the result names the dialog and the answer.</summary>
    [Test]
    public void A_dialog_a_script_raises_is_answered_and_recorded() {
        var (document, _, _) = Seeded();
        try {
            var (_, result) = Run(document, """
                var dialog = new Autodesk.Revit.UI.TaskDialog("Pe proof") { Id = "PeProofDialog", MainInstruction = "A dialog a script raised." };
                WriteLine("answer: " + dialog.Show());
                """, "dialog");
            var said = Said(result, "dialog", ScriptDiagnosticSeverity.Warning).ToList();
            Row("dialog", new { status = result.Status.ToString(), result.Output, said });
            Assert.Multiple(() => {
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
                Assert.That(result.Output, Does.Contain("answer: Cancel"));
                Assert.That(said.Count(message => message.Contains("'PeProofDialog'") && message.Contains("with Cancel")), Is.EqualTo(1), string.Join(" | ", said));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>A script that returns keeps everything it committed, as one undo entry.</summary>
    [Test]
    public void A_script_that_returns_keeps_its_commits_as_one_undo_entry() {
        var (document, seedDelete, seedKeep) = Seeded();
        try {
            var before = Snapshot.Of(document, seedDelete, seedKeep);
            var (ran, result) = Run(document, Seeds(Walls + DeleteAndModify, seedDelete, seedKeep), "returns");
            var after = Snapshot.Of(document, seedDelete, seedKeep);
            Row("returns", new { read = after.Versus(before), touched = ran.Touched, status = result.Status.ToString(), changes = result.Changes });
            Assert.Multiple(() => {
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
                Assert.That(after.Walls, Is.EqualTo(before.Walls + 1), "two walls added, one deleted");
                Assert.That(after.ProjectName, Is.EqualTo("__proof_modified__"));
                Assert.That(after.SeedDeleteExists, Is.False);
                Assert.That(after.SeedKeepComment, Is.EqualTo("__proof_comment__"));
                Assert.That(ran.Touched, Is.InstanceOf<Touched.Wrote>());
                Assert.That(result.Changes!.Kept, Is.True);
                Assert.That(result.Changes.Undo, Is.EqualTo("Pe script: returns"));
                Assert.That(result.Changes.Summary, Does.StartWith("Changed "));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>What reading the document says, with no run report in it.</summary>
    private sealed record Snapshot(
        Dictionary<long, Guid> Versions, int Elements, int Walls, string ProjectName, bool SeedDeleteExists, string? SeedKeepComment,
        bool FamilyLoaded, string FamilySymbols, bool IsModifiable) {
        public static Snapshot Of(Document document, long seedDelete, long seedKeep) {
            var all = new FilteredElementCollector(document).WhereElementIsNotElementType().ToElements()
                .Concat(new FilteredElementCollector(document).WhereElementIsElementType().ToElements()).ToList();
            var family = new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>().FirstOrDefault(each => each.Name == FamilyName);
            return new Snapshot(all.GroupBy(element => element.Id.Value).ToDictionary(group => group.Key, group => group.First().VersionGuid),
                all.Count,
                new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount(),
                document.ProjectInformation.Name,
                document.GetElement(new ElementId(seedDelete)) is not null,
                document.GetElement(new ElementId(seedKeep))?.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString(),
                family is not null,
                family is null ? "" : string.Join(",", family.GetFamilySymbolIds().Select(id => document.GetElement(id).Name).OrderBy(name => name)),
                document.IsModifiable);
        }

        /// <summary>The document's own facts as one comparable line, with no element versions in it.</summary>
        public string Facts => $"elements={this.Elements} walls={this.Walls} projectName={this.ProjectName} seedDeleteExists={this.SeedDeleteExists} seedKeepComment={this.SeedKeepComment} familyLoaded={this.FamilyLoaded} familySymbols={this.FamilySymbols} isModifiable={this.IsModifiable}";

        public object Versus(Snapshot before) => new {
            added = this.Versions.Keys.Count(id => !before.Versions.ContainsKey(id)),
            deleted = before.Versions.Keys.Count(id => !this.Versions.ContainsKey(id)),
            modifiedByVersionGuid = this.Versions.Count(pair => before.Versions.TryGetValue(pair.Key, out var was) && was != pair.Value),
            before = before.Facts,
            now = this.Facts
        };
    }
}
