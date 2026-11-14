using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Execution;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

/// <summary>
///     What a script run tells the person and Pea, on real Revit (pods slice 6, defect D5): the element ids it
///     changed in every mode, one undo entry for a run that commits several transactions, and Revit's own words
///     for a commit it rolled back. The words themselves are tested without Revit in ScriptChangeLedgerTests.
///     Every test writes only to a blank project under a temp folder. `Undo` is set only when Revit assimilated
///     the run's group; that one Ctrl+Z then takes the run back is not provable here (Revit runs a posted Undo
///     only after the whole test run), so a person or a driven session proves it.
///     Mutants, each run red once (2026-11-14). "ids dropped": pass no `idsOf` to OperationMonitor.Watch in
///     RevitScriptExecutionService.ExecuteContainer; the id lists are empty. "no group": skip `group.Start()` in
///     ExecuteInUndoGroup; `Undo` is null. "failures unheard":
///     delete `application.FailuresProcessing += run.OnFailuresProcessing;`; the rolled-back run carries no failure.
/// </summary>
[TestFixture]
public sealed class ScriptChangesTests {
    private const string TwoTransactions = """
        var level = new FilteredElementCollector(doc!).OfClass(typeof(Level)).FirstElementId();
        var ids = new List<long>();
        foreach (var y in new[] { 100.0, 105.0 }) {
            using var transaction = new Transaction(doc, $"Wall at {y}");
            _ = transaction.Start();
            ids.Add(Wall.Create(doc, Line.CreateBound(new XYZ(0, y, 0), new XYZ(10, y, 0)), level, false).Id.Value);
            WriteLine(transaction.Commit().ToString());
        }
        Result(new { walls = ids });
        """;

    [Test]
    public void A_run_that_commits_two_transactions_answers_its_change_ids_and_is_one_undo_entry(UIApplication uiApplication) {
        var document = OpenBlankProject(uiApplication, "two-transactions");
        var before = Walls(document);

        var result = Run(uiApplication, document, TwoTransactions, ScriptPermissionMode.NoTransaction, "two-walls");

        var walls = JToken.FromObject(result.Data!)["walls"]!.Values<long>().ToList();
        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
            Assert.That(result.Changes, Is.Not.Null);
            Assert.That(walls, Has.Count.EqualTo(2));
            Assert.That(result.Changes!.Added.Ids, Is.SupersetOf(walls), "both walls are in the added ids");
            Assert.That(result.Changes.Added.Total, Is.EqualTo(result.Changes.Added.Ids.Count));
            Assert.That(result.Changes.Transactions, Is.EqualTo(new[] { "Wall at 100", "Wall at 105" }));
            Assert.That(result.Changes.Kept, Is.True);
            Assert.That(result.Changes.Undo, Is.EqualTo("Pe script: two-walls"));
            Assert.That(result.Changes.Ungrouped, Is.Null);
            Assert.That(result.Changes.Summary, Does.EndWith("in 2 transactions. One undo entry: 'Pe script: two-walls'."));
            Assert.That(result.Failures, Is.Empty);
            Assert.That(Walls(document), Is.EqualTo(before + 2));
        });
        TestContext.Out.WriteLine(result.Changes!.Summary);
    }

    // D5, found on a real session: a script's Transaction.Commit() answered RolledBack with no exception and no
    // words, because a handler outside the script rolled the failure back. Here the test failure guard is that handler.
    [Test]
    public void A_commit_revit_rolled_back_is_reported_in_revits_words(UIApplication uiApplication) {
        var document = OpenBlankProject(uiApplication, "rolled-back");
        var before = Walls(document);

        var result = Run(uiApplication, document, """
            var level = new FilteredElementCollector(doc!).OfClass(typeof(Level)).FirstElementId();
            var error = Autodesk.Revit.ApplicationServices.Application.GetFailureDefinitionRegistry().ListAllFailureDefinitions()
                .First(definition => definition.GetSeverity() == FailureSeverity.Error
                    && definition.IsResolutionApplicable(FailureResolutionType.DeleteElements));
            using var transaction = new Transaction(doc, "Doomed wall");
            _ = transaction.Start();
            var wall = Wall.Create(doc, Line.CreateBound(new XYZ(0, 200, 0), new XYZ(10, 200, 0)), level, false);
            var message = new FailureMessage(error.GetId());
            message.SetFailingElement(wall.Id);
            _ = doc.PostFailure(message);
            var wallId = wall.Id.Value;
            var status = transaction.Commit();
            Result(new { status = status.ToString(), wall = wallId, definition = error.GetId().Guid.ToString(), text = error.GetDescriptionText() });
            """, ScriptPermissionMode.NoTransaction, "doomed");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
        var data = JToken.FromObject(result.Data!);
        Assert.Multiple(() => {
            Assert.That(data.Value<string>("status"), Is.EqualTo("RolledBack"), "the script saw only a status");
            Assert.That(Walls(document), Is.EqualTo(before));
            Assert.That(result.Failures, Has.Count.EqualTo(1));
            Assert.That(result.Changes!.Added.Total + result.Changes.Modified.Total + result.Changes.Deleted.Total, Is.Zero);
            Assert.That(result.Changes.Undo, Is.Null);
        });
        var failure = result.Failures![0];
        var said = $"Nothing changed: Revit rolled back every transaction this run tried to commit ('Doomed wall'). Revit said: {data.Value<string>("text")}";
        Assert.Multiple(() => {
            Assert.That(failure.Message, Is.EqualTo(data.Value<string>("text")).And.Not.Empty);
            Assert.That(failure.Severity, Is.EqualTo("Error"));
            Assert.That(failure.DefinitionId, Is.EqualTo(data.Value<string>("definition")));
            Assert.That(failure.ElementIds, Is.EqualTo(new[] { data.Value<long>("wall") }));
            Assert.That(failure.Transaction, Is.EqualTo("Doomed wall"));
            Assert.That(failure.Outcome, Is.EqualTo(ScriptFailureOutcome.RolledBack));
            Assert.That(result.Changes!.Summary, Is.EqualTo(said));
            Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Stage == "transaction"
                && diagnostic.Severity == ScriptDiagnosticSeverity.Warning && diagnostic.Message == said), Is.True, Words(result));
        });
        TestContext.Out.WriteLine(result.Changes!.Summary);
    }

    [Test]
    public void A_read_only_run_answers_what_it_would_have_changed(UIApplication uiApplication) {
        var document = OpenBlankProject(uiApplication, "read-only");
        var name = document.ProjectInformation.Name;

        var result = Run(uiApplication, document, "doc!.ProjectInformation.Name = \"__pe_would_change__\";", ScriptPermissionMode.ReadOnly, "would");

        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
            Assert.That(document.ProjectInformation.Name, Is.EqualTo(name));
            Assert.That(result.Changes!.Kept, Is.False);
            Assert.That(result.Changes.Modified.Ids, Does.Contain(document.ProjectInformation.Id.Value));
            Assert.That(result.Changes.Transactions, Is.Empty);
            Assert.That(result.Changes.Undo, Is.Null);
            Assert.That(result.Changes.Summary, Does.StartWith("ReadOnly run: it would change "));
        });
    }

    [Test]
    public void A_host_owned_write_is_one_entry_named_after_the_entrypoint(UIApplication uiApplication) {
        var document = OpenBlankProject(uiApplication, "host-owned");

        var result = Run(uiApplication, document, "doc!.ProjectInformation.Name = \"__pe_host_owned__\";", ScriptPermissionMode.WriteTransaction, "rename");

        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
            Assert.That(document.ProjectInformation.Name, Is.EqualTo("__pe_host_owned__"));
            Assert.That(result.Changes!.Modified.Ids, Does.Contain(document.ProjectInformation.Id.Value));
            Assert.That(result.Changes.Transactions, Is.EqualTo(new[] { "Pe script: rename" }));
            Assert.That(result.Changes.Undo, Is.EqualTo("Pe script: rename"));
        });
    }

    // Revit refuses Save and SaveAs on a document while a transaction group is open on it, so a script that makes
    // such a call runs ungrouped. The call here saves nothing in Revit; it only carries the name the host reads.
    [Test]
    public void A_script_revit_would_refuse_inside_a_group_runs_ungrouped_and_says_so(UIApplication uiApplication) {
        var document = OpenBlankProject(uiApplication, "ungrouped");

        var result = Run(uiApplication, document,
            "new System.Xml.Linq.XElement(\"x\").Save(System.IO.TextWriter.Null);\n" + TwoTransactions, ScriptPermissionMode.NoTransaction, "saver");

        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
            Assert.That(result.Changes!.Transactions, Is.EqualTo(new[] { "Wall at 100", "Wall at 105" }));
            Assert.That(result.Changes.Undo, Is.Null);
            Assert.That(result.Changes.Ungrouped, Is.EqualTo("the script calls Save, which Revit refuses inside a transaction group."));
            Assert.That(result.Changes.Summary, Does.Contain("2 undo entries, not one: the script calls Save"));
        });
    }

    // The shape of a family heal: EditFamily and LoadFamily back, which Revit allows inside the run's undo group.
    [Test]
    public void A_family_round_trip_runs_inside_the_undo_group(UIApplication uiApplication) {
        var document = OpenBlankProject(uiApplication, "family-round-trip");
        if (new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>().All(family => !family.IsEditable))
            Assert.Ignore("The blank project carries no editable family.");

        var result = Run(uiApplication, document, """
            public sealed class RoundTrip : PeScriptContainer {
                public override void Execute() {
                    var family = new FilteredElementCollector(doc!).OfClass(typeof(Family)).Cast<Family>().First(each => each.IsEditable);
                    var familyDocument = doc.EditFamily(family);
                    try {
                        using (var transaction = new Transaction(familyDocument, "Touch family")) {
                            _ = transaction.Start();
                            _ = familyDocument.FamilyManager.NewType("pe-round-trip-" + System.Guid.NewGuid().ToString("N"));
                            _ = transaction.Commit();
                        }
                        Result(new { loaded = familyDocument.LoadFamily(doc, new Overwrite())?.Name });
                    } finally { _ = familyDocument.Close(false); }
                }
                private sealed class Overwrite : IFamilyLoadOptions {
                    public bool OnFamilyFound(bool familyInUse, out bool overwriteParameterValues) { overwriteParameterValues = true; return true; }
                    public bool OnSharedFamilyFound(Family sharedFamily, bool familyInUse, out FamilySource source, out bool overwriteParameterValues) {
                        source = FamilySource.Family; overwriteParameterValues = true; return true;
                    }
                }
            }
            """, ScriptPermissionMode.NoTransaction, "round-trip");

        Assert.Multiple(() => {
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
            Assert.That(JToken.FromObject(result.Data!).Value<string>("loaded"), Is.Not.Null.And.Not.Empty);
            Assert.That(result.Changes!.Added.Total + result.Changes.Modified.Total, Is.GreaterThan(0), "the reload changed the project");
            Assert.That(result.Changes.Undo, Is.EqualTo("Pe script: round-trip"), result.Changes.Summary);
        });
    }

    // A warning under the host-owned transaction is read by the host's preprocessor and may reach the event too.
    // It is one failure, acknowledged, and its transaction goes on.
    [Test]
    public void A_warning_in_a_host_owned_write_is_dismissed_once_and_the_write_is_kept(UIApplication uiApplication) {
        var document = OpenBlankProject(uiApplication, "warning");

        var result = Run(uiApplication, document, """
            doc!.ProjectInformation.Name = "__pe_warned__";
            var warning = Autodesk.Revit.ApplicationServices.Application.GetFailureDefinitionRegistry().ListAllFailureDefinitions()
                .First(definition => definition.GetSeverity() == FailureSeverity.Warning);
            var message = new FailureMessage(warning.GetId());
            message.SetFailingElement(doc.ProjectInformation.Id);
            _ = doc.PostFailure(message);
            Result(new { definition = warning.GetId().Guid.ToString() });
            """, ScriptPermissionMode.WriteTransaction, "warned");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
        Assert.Multiple(() => {
            Assert.That(document.ProjectInformation.Name, Is.EqualTo("__pe_warned__"));
            Assert.That(result.Failures, Has.Count.EqualTo(1), string.Join(" | ", result.Failures!.Select(failure => $"{failure.Outcome} {failure.Message}")));
            Assert.That(result.Failures![0].Outcome, Is.EqualTo(ScriptFailureOutcome.Dismissed));
            Assert.That(result.Failures[0].Severity, Is.EqualTo("Warning"));
            Assert.That(result.Failures[0].DefinitionId, Is.EqualTo(JToken.FromObject(result.Data!).Value<string>("definition")));
            Assert.That(result.Changes!.Kept, Is.True);
            Assert.That(result.Changes.Overlapped, Is.False);
            Assert.That(result.Changes.Summary, Does.Not.Contain("rolled back"));
        });
    }

    // What document-profiler's ViewOpenProbe does in NoTransaction: activate a view, close a view tab, export an
    // image. The run's undo group must change nothing about those calls, so the same script runs grouped and
    // ungrouped (the XElement.Save line only carries the name that ungroups it) and must answer the same.
    [Test]
    public void The_undo_group_changes_nothing_about_view_activation_view_close_and_image_export(UIApplication uiApplication) {
        const string script = """
            string Try(Action act) { try { act(); return "ok"; } catch (Exception e) { return $"{e.GetType().Name}: {e.Message}"; } }
            var start = uidoc!.ActiveView;
            var other = new FilteredElementCollector(doc!).OfClass(typeof(ViewPlan)).Cast<View>().First(view => !view.IsTemplate && view.Id != start.Id);
            using (var transaction = new Transaction(doc, "Probe change")) { _ = transaction.Start(); doc.ProjectInformation.Name = "__pe_probe__"; _ = transaction.Commit(); }
            var image = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "pe-probe-" + System.Guid.NewGuid().ToString("N"));
            Result(new {
                activate = Try(() => uidoc.ActiveView = other),
                close = Try(() => uidoc.GetOpenUIViews().First(view => view.ViewId == start.Id).Close()),
                export = Try(() => {
                    var options = new ImageExportOptions { FilePath = image, ExportRange = ExportRange.SetOfViews, ZoomType = ZoomFitType.FitToPage, PixelSize = 256 };
                    options.SetViewsAndSheets(new List<ElementId> { other.Id });
                    doc.ExportImage(options);
                })
            });
            """;
        JToken Answers(string name, string source) {
            var result = Run(uiApplication, OpenBlankProject(uiApplication, name), source, ScriptPermissionMode.NoTransaction, name);
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), Words(result));
            Assert.That(result.Changes!.Undo == $"Pe script: {name}", Is.EqualTo(name == "views-grouped"), result.Changes.Summary);
            TestContext.Out.WriteLine($"{name}: {JToken.FromObject(result.Data!).ToString(Newtonsoft.Json.Formatting.None)}");
            return JToken.FromObject(result.Data!);
        }

        var ungrouped = Answers("views-ungrouped", "new System.Xml.Linq.XElement(\"x\").Save(System.IO.TextWriter.Null);\n" + script);
        var grouped = Answers("views-grouped", script);

        Assert.That(grouped.ToString(), Is.EqualTo(ungrouped.ToString()), "the group refuses a call that runs without it");
    }

    private static ExecuteRevitScriptData Run(UIApplication uiApplication, Document document, string script, ScriptPermissionMode mode, string name) =>
        RevitScriptExecutionService.CreateDefault(() => uiApplication).Execute(document,
            new ExecuteRevitScriptRequest(script, SourceName: name, PermissionMode: mode), "changes-" + Guid.NewGuid().ToString("N"));

    private static int Walls(Document document) => new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount();

    private static string Words(ExecuteRevitScriptData result) =>
        string.Join("; ", result.Diagnostics.Select(diagnostic => $"{diagnostic.Stage} {diagnostic.Severity}: {diagnostic.Message}"));

    /// <summary>A blank project this test owns, saved under a temp folder and made the active document.</summary>
    private static Document OpenBlankProject(UIApplication uiApplication, string name) {
        var path = Path.Combine(RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("script-changes-" + name), "Changes.rvt");
        var blank = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        blank.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
        _ = blank.Close(false);
        return uiApplication.OpenAndActivateDocument(path).Document;
    }
}
