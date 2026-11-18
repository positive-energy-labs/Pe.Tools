using Pe.Revit.Global.Services.Host;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

/// <summary>
///     The 2026-11-18 ruling on fresh Revit: a NoTransaction run that ends by an exception, a timeout or a cancel
///     is rolled back whole, and its report says so; a run Revit cannot roll back keeps its commits and says
///     that. Counts are read from the document, never from the report.
/// </summary>
public sealed partial class ScriptRunProofTests {
    private const string LoadFamily = """
        using (var t = new Transaction(doc, "Proof 2 load family")) {
            _ = t.Start();
            var loaded = doc.LoadFamily(@"FAMILY_PATH", out var family);
            WriteLine("LoadFamily: " + loaded + " " + family?.Name);
            WriteLine("commit 2: " + t.Commit());
        }
        """;

    private const string RoundTrip = """
        public sealed class RoundTrip : PeScriptContainer {
            public override void Execute() {
                var level = new FilteredElementCollector(doc!).OfClass(typeof(Level)).FirstElementId();
                using (var t = new Transaction(doc, "Proof 1 add wall")) {
                    _ = t.Start();
                    _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 100, 0), new XYZ(10, 100, 0)), level, false);
                    WriteLine("commit 1: " + t.Commit());
                }
                var family = new FilteredElementCollector(doc).OfClass(typeof(Family)).Cast<Family>().First(each => each.Name == "PeProofFam");
                var familyDocument = doc.EditFamily(family);
                try {
                    using (var t = new Transaction(familyDocument, "Proof touch family")) {
                        _ = t.Start();
                        _ = familyDocument.FamilyManager.NewType("proof-type");
                        WriteLine("family commit: " + t.Commit());
                    }
                    WriteLine("loaded back: " + familyDocument.LoadFamily(doc, new Overwrite())?.Name);
                } finally { _ = familyDocument.Close(false); }
                throw new System.InvalidOperationException("PROOF-THROW C: after EditFamily and load back");
            }
            private sealed class Overwrite : IFamilyLoadOptions {
                public bool OnFamilyFound(bool familyInUse, out bool overwriteParameterValues) { overwriteParameterValues = true; return true; }
                public bool OnSharedFamilyFound(Family sharedFamily, bool familyInUse, out FamilySource source, out bool overwriteParameterValues) {
                    source = FamilySource.Family; overwriteParameterValues = true; return true;
                }
            }
        }
        """;

    // The throw is inside a `using`, so the unwind disposes the open transaction before the run's group closes.
    private const string OpenInUsing = """
        using (var t = new Transaction(doc, "Proof 2 open in using")) {
            _ = t.Start();
            _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 110, 0), new XYZ(10, 110, 0)), level, false);
            throw new System.InvalidOperationException("PROOF-THROW D2: thrown inside a using transaction");
        }
        """;

    private const string Throw = "throw new System.InvalidOperationException(\"PROOF-THROW: after the commits\");";
    // A script checks `ct` to yield; the run's one-second timeout has passed by then.
    private const string TimeOut = "System.Threading.Thread.Sleep(2500); ct.ThrowIfCancellationRequested();";

    private static string Script(string arm) => arm switch {
        "two-commits" => Walls + DeleteAndModify + Throw,
        "family-load" => Walls + LoadFamily + Throw,
        "family-round-trip" => RoundTrip,
        "throw-in-using" => Walls + OpenInUsing,
        "timeout" => Walls + DeleteAndModify + TimeOut,
        _ => throw new ArgumentOutOfRangeException(nameof(arm))
    };

    [TestCase("two-commits"), TestCase("family-load"), TestCase("family-round-trip"), TestCase("throw-in-using"), TestCase("timeout")]
    public void B_run_that_does_not_finish_is_rolled_back_whole(string arm) {
        var (document, seedDelete, seedKeep) = Seeded(withFamily: arm == "family-round-trip");
        try {
            var before = Snapshot.Of(document, seedDelete, seedKeep);
            var (ran, result) = Run(document, Seeds(Script(arm), seedDelete, seedKeep), arm, timeoutSeconds: arm == "timeout" ? 1 : 0);
            var after = Snapshot.Of(document, seedDelete, seedKeep);
            Row(arm, new { read = after.Versus(before), touched = ran.Touched, status = result.Status.ToString(), result.Output, changes = result.Changes,
                errors = result.Diagnostics.Where(diagnostic => diagnostic.Severity != ScriptDiagnosticSeverity.Info).Select(diagnostic => $"{diagnostic.Stage}: {diagnostic.Message.Split('\n')[0].Trim()}") });
            Assert.Multiple(() => {
                Assert.That(result.Status, Is.EqualTo(arm == "timeout" ? ScriptExecutionStatus.TimedOut : ScriptExecutionStatus.RuntimeFailed));
                Assert.That(result.Output, Does.Contain("commit 1: Committed"), "the script did commit before it ended");
                // The document, read back: nothing the run committed is in it.
                Assert.That(after.Facts, Is.EqualTo(before.Facts));
                Assert.That(after.Versions.Keys, Is.EquivalentTo(before.Versions.Keys));
                // The report, against that reading.
                if (arm == "family-round-trip")
                    // The family document is one the script opened itself, outside the run's group: its own commit
                    // is still stated, and the project's commits ('Proof 1 add wall', 'Load Family') are not.
                    Assert.That((ran.Touched as Touched.Wrote)?.Transactions, Is.EqualTo(new[] { "Proof touch family" }));
                else
                    Assert.That(ran.Touched, Is.InstanceOf<Touched.RolledBack>());
                // The script's own exception is what the result carries, never one from the rollback.
                if (arm != "timeout")
                    Assert.That(Said(result, "runtime", ScriptDiagnosticSeverity.Error).Single(), Does.Contain("PROOF-THROW"));
                Assert.That(result.Changes!.Kept, Is.False);
                Assert.That(result.Changes.Undo, Is.Null);
                Assert.That(result.Changes.Ungrouped, Is.Null);
                Assert.That(result.Changes.Summary, Does.Contain("rolled back").And.Contain($"nothing changed in '{document.Title}'"));
                // The summary speaks for the target alone: the family document's commit is named as not rolled back.
                if (arm == "family-round-trip")
                    Assert.That(result.Changes.Summary, Does.Contain("The run also committed 1 transaction in").And.Contain("That was not rolled back"));
                else
                    Assert.That(result.Changes.Summary, Does.Not.Contain("The run also committed"));
                if (arm == "timeout")
                    Assert.That(Said(result, "cancel", ScriptDiagnosticSeverity.Error).Single(), Does.Contain("rolled back"));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>
    ///     A WriteTransaction script that throws never commits the host's one transaction: the document reads as
    ///     before and the result says nothing was kept.
    /// </summary>
    [Test]
    public void B_host_owned_write_that_throws_changes_nothing_and_keeps_nothing() {
        var (document, seedDelete, seedKeep) = Seeded();
        try {
            var before = Snapshot.Of(document, seedDelete, seedKeep);
            var (ran, result) = Run(document, "doc!.ProjectInformation.Name = \"__proof_modified__\";" + Throw, "host-owned-throw", mode: ScriptPermissionMode.WriteTransaction);
            var after = Snapshot.Of(document, seedDelete, seedKeep);
            Row("host-owned-throw", new { read = after.Versus(before), touched = ran.Touched, status = result.Status.ToString(), changes = result.Changes });
            Assert.Multiple(() => {
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.RuntimeFailed));
                Assert.That(after.Facts, Is.EqualTo(before.Facts));
                Assert.That(result.Changes!.Kept, Is.False);
                Assert.That(result.Changes.Summary, Is.EqualTo($"The script did not finish. No element changed in '{document.Title}'."));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>
    ///     A script that leaks a transaction and throws: the script's own exception is the first Error, so it is
    ///     what the action's error text carries, and the leak's words follow it.
    /// </summary>
    [Test]
    public void B_leak_and_throw_puts_the_scripts_own_exception_first() {
        var (document, _, _) = Seeded();
        try {
            AppDomain.CurrentDomain.SetData(OpenTransactionKey, null);
            var (_, result) = Run(document, Walls + LeftOpen + Throw, "leak-order");
            var open = (Transaction)AppDomain.CurrentDomain.GetData(OpenTransactionKey)!;
            _ = open.RollBack();
            open.Dispose();
            var errors = result.Diagnostics.Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error).ToList();
            Assert.Multiple(() => {
                Assert.That(errors[0].Stage, Is.EqualTo("runtime"));
                Assert.That(errors[0].Message, Does.StartWith("System.InvalidOperationException: PROOF-THROW"));
                Assert.That(errors[1].Message, Does.Contain("still open on"));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>A script whose own source calls Save runs ungrouped, so Revit cannot roll it back: its commits stay and one sentence says so.</summary>
    [Test]
    public void B_ungrouped_run_that_throws_keeps_its_commits_and_says_so() {
        var (document, seedDelete, seedKeep) = Seeded();
        try {
            var before = Snapshot.Of(document, seedDelete, seedKeep);
            var (ran, result) = Run(document, Seeds(Walls + DeleteAndModify + "if (doc.PathName == \"never\") doc.Save();" + Throw, seedDelete, seedKeep), "ungrouped");
            var after = Snapshot.Of(document, seedDelete, seedKeep);
            Row("ungrouped", new { read = after.Versus(before), touched = ran.Touched, status = result.Status.ToString(), changes = result.Changes });
            Assert.Multiple(() => {
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.RuntimeFailed));
                Assert.That(after.Walls, Is.EqualTo(before.Walls + 1), "two walls added, one deleted: the commits are in the document");
                Assert.That(after.ProjectName, Is.EqualTo("__proof_modified__"));
                Assert.That(ran.Touched, Is.InstanceOf<Touched.Wrote>());
                Assert.That(result.Changes!.Kept, Is.True);
                Assert.That(result.Changes.Summary, Does.StartWith($"The script did not finish, and what it had committed is still in '{document.Title}': 5 elements (2 added, 2 modified, 1 deleted) in 2 transactions."));
                Assert.That(result.Changes.Summary, Does.Contain("2 undo entries, not one"));
                Assert.That(Said(result, "transaction", ScriptDiagnosticSeverity.Warning), Has.Some.EqualTo(result.Changes.Summary));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>A run with a leaked transaction cannot be rolled back either: the first commit stays and the result joins the failure with it.</summary>
    [Test]
    public void B_leaked_transaction_keeps_the_commits_and_says_so() {
        var (document, _, _) = Seeded();
        try {
            AppDomain.CurrentDomain.SetData(OpenTransactionKey, null);
            var (ran, result) = Run(document, Walls + LeftOpen + Throw, "leak-throw");
            var open = (Transaction)AppDomain.CurrentDomain.GetData(OpenTransactionKey)!;
            _ = open.RollBack();
            open.Dispose();
            Row("leak-throw", new { touched = ran.Touched, status = result.Status.ToString(), changes = result.Changes });
            Assert.Multiple(() => {
                Assert.That(new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount(), Is.EqualTo(4), "two seed walls and the two committed");
                Assert.That(ran.Touched, Is.InstanceOf<Touched.Wrote>());
                Assert.That(result.Changes!.Kept, Is.True);
                Assert.That(result.Changes.Summary, Does.StartWith($"The script did not finish, and what it had committed is still in '{document.Title}': 3 elements (2 added, 1 modified, 0 deleted) in 1 transaction."));
            });
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>
    ///     A workshared local of the test's own central: the script borrows elements, adds one, loads a family and
    ///     throws. After the rollback the local reads as before, and a synchronize sends nothing of the run: a
    ///     second local made from the central afterwards reads as the first did before the run. The elements the
    ///     run borrowed stay borrowed until that synchronize.
    /// </summary>
    [Test]
    public void B_workshared_run_that_throws_is_rolled_back_and_synchronize_sends_nothing() {
        var dir = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("ws");
        string central = Path.Combine(dir, "central.rvt"), local = Path.Combine(dir, "local.rvt"), second = Path.Combine(dir, "second.rvt");
        var seed = RevitFamilyFixtureHarness.CreateProjectDocument(_ui.Application);
        seed.EnableWorksharing("Shared Levels and Grids", "Workset1");
        var save = new SaveAsOptions { OverwriteExistingFile = true, MaximumBackups = 1 };
        save.SetWorksharingOptions(new WorksharingSaveAsOptions { SaveAsCentral = true });
        seed.SaveAs(central, save);
        _ = seed.Close(false);
        WorksharingUtils.CreateNewLocal(ModelPathUtils.ConvertUserVisiblePathToModelPath(central), ModelPathUtils.ConvertUserVisiblePathToModelPath(local));
        var document = _ui.Application.OpenDocumentFile(ModelPathUtils.ConvertUserVisiblePathToModelPath(local), new OpenOptions());
        try {
            // The central keeps its creator's worksets editable; give everything back so the local starts owning nothing.
            WorksharingUtils.RelinquishOwnership(document, new RelinquishOptions(true), new TransactWithCentralOptions());
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).FirstElementId();
            var info = document.ProjectInformation.Id;
            var before = Workshared.Of(document, level, info);
            var (ran, result) = Run(document, """
                var level = (Level)new FilteredElementCollector(doc!).OfClass(typeof(Level)).FirstElement();
                using (var t = new Transaction(doc, "WS 1 borrow and add")) {
                    _ = t.Start();
                    doc.ProjectInformation.Name = "__ws_modified__";
                    level.Name = "__ws_level__";
                    _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 100, 0), new XYZ(10, 100, 0)), level.Id, false);
                    WriteLine("commit 1: " + t.Commit());
                }
                WriteLine("info checkout: " + WorksharingUtils.GetCheckoutStatus(doc, doc.ProjectInformation.Id));
                WriteLine("level checkout: " + WorksharingUtils.GetCheckoutStatus(doc, level.Id));
                using (var t = new Transaction(doc, "WS 2 load family")) {
                    _ = t.Start();
                    WriteLine("LoadFamily: " + doc.LoadFamily(@"FAMILY_PATH", out var family) + " " + family?.Name);
                    WriteLine("commit 2: " + t.Commit());
                }
                throw new System.InvalidOperationException("WS-THROW: after a borrow and a family load");
                """.Replace("FAMILY_PATH", _familyPath), "workshared");
            var after = Workshared.Of(document, level, info);
            var centralWritten = File.GetLastWriteTimeUtc(central);
            var options = new SynchronizeWithCentralOptions();
            options.SetRelinquishOptions(new RelinquishOptions(true));
            document.SynchronizeWithCentral(new TransactWithCentralOptions(), options);
            var afterSync = Workshared.Of(document, level, info);
            var centralChangedBySync = File.GetLastWriteTimeUtc(central) != centralWritten;
            WorksharingUtils.CreateNewLocal(ModelPathUtils.ConvertUserVisiblePathToModelPath(central), ModelPathUtils.ConvertUserVisiblePathToModelPath(second));
            var other = _ui.Application.OpenDocumentFile(ModelPathUtils.ConvertUserVisiblePathToModelPath(second), new OpenOptions());
            Workshared fromCentral;
            try { fromCentral = Workshared.Of(other, level, info); } finally { _ = other.Close(false); }
            Row("workshared", new { before, after, afterSync, fromCentral, centralChangedBySync, touched = ran.Touched, status = result.Status.ToString(), result.Output, changes = result.Changes });
            Assert.Multiple(() => {
                Assert.That(result.Output, Does.Contain("info checkout: OwnedByCurrentUser").And.Contain("LoadFamily: True"), "the run did borrow and load before it threw");
                Assert.That(after.Model, Is.EqualTo(before.Model), "the local reads as before the run");
                Assert.That(fromCentral.Model, Is.EqualTo(before.Model), "the synchronize sent none of the run's changes to the central");
                Assert.That(ran.Touched, Is.InstanceOf<Touched.RolledBack>());
                Assert.That(result.Changes!.Kept, Is.False);
                // Measured 2026-11-18: the rollback does not give back what the run borrowed. The two elements it
                // modified stay borrowed, the family workset it made is gone, and a synchronize relinquishes both.
                Assert.That((after.InfoCheckout, after.LevelCheckout), Is.EqualTo(("OwnedByCurrentUser", "OwnedByCurrentUser")));
                Assert.That(after.OwnedElements, Is.EqualTo(2));
                Assert.That(after.OwnedWorksets, Is.Empty);
                Assert.That(afterSync.OwnedElements, Is.Zero, "a synchronize that relinquishes gives back whatever the run borrowed");
            });
        } finally {
            try { WorksharingUtils.RelinquishOwnership(document, new RelinquishOptions(true), new TransactWithCentralOptions()); } catch { }
            _ = document.Close(false);
        }
    }

    /// <summary>A workshared document read back: <see cref="Model" /> is what the model holds, the rest is what the user owns.</summary>
    private sealed record Workshared(string Model, string InfoCheckout, string LevelCheckout, int OwnedElements, List<string> OwnedWorksets, bool IsModified) {
        public static Workshared Of(Document document, ElementId level, ElementId info) {
            var ids = new FilteredElementCollector(document).WhereElementIsNotElementType().ToElementIds()
                .Concat(new FilteredElementCollector(document).WhereElementIsElementType().ToElementIds()).ToList();
            return new Workshared(
                $"elements={ids.Count} walls={new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount()} projectName={document.ProjectInformation.Name} "
                + $"levelName={document.GetElement(level)?.Name} familyLoaded={new FilteredElementCollector(document).OfClass(typeof(Family)).Any(each => each.Name == FamilyName)}",
                WorksharingUtils.GetCheckoutStatus(document, info).ToString(),
                WorksharingUtils.GetCheckoutStatus(document, level).ToString(),
                ids.Count(id => WorksharingUtils.GetCheckoutStatus(document, id) == CheckoutStatus.OwnedByCurrentUser),
                new FilteredWorksetCollector(document).Where(workset => workset.IsEditable).Select(workset => $"{workset.Kind}:{workset.Name}").ToList(),
                document.IsModified);
        }
    }
}
