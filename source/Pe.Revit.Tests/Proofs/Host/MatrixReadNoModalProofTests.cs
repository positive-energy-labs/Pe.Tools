using Autodesk.Revit.UI.Events;
using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     A family READ never leaves a Revit dialog to the user (project-a hold 4b: `revit.matrix.loaded-families` blocked 6 min on a
///     failure the EditFamily gate had already rejected). Old_Template's 'PE - Title Block' makes the gate reject "some dimensions
///     were not copied" on EditFamily, and Revit then shows `Dialog_Revit_DocWarnDialog`: the same shape. The process-wide test
///     guard is suspended so only product handling acts; this test answers any dialog itself so the run cannot hang.
///     Invariant (domains-opus ruling 2): the copy stays refused by name AND the product answers and names the dialog.
/// </summary>
[TestFixture]
public sealed class MatrixReadNoModalProofTests {
    private const string TitleBlock = "PE - Title Block";
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test, Timeout(300000)]
    public void A_matrix_read_refuses_the_destructive_copy_by_name_and_answers_its_dialog() {
        var application = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(MatrixReadNoModalProofTests));
        var path = Path.Combine(directory, "Old_Template.rvt");
        File.Copy(RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt"), path, true);
        Document? project = null;
        try {
            project = application.OpenDocumentFile(path);
            var seen = new List<string>();
            void OnDialog(object? _, DialogBoxShowingEventArgs args) {
                seen.Add(args.DialogId);
                // The census answer (RevitDialogs.KnownDialogs): DocWarnDialog's Cancel is IDABORT.
                _ = args.OverrideResult(args.DialogId == "Dialog_Revit_DocWarnDialog" ? 3 : (int)TaskDialogResult.Cancel);
            }
            LoadedFamiliesMatrixData data;
            this._ui.DialogBoxShowing += OnDialog;
            try {
                using var unguarded = RevitTestFailureGuard.Suspend();
                data = Read(project, new LoadedFamiliesFilter { FamilyNames = [TitleBlock] });
            } finally { this._ui.DialogBoxShowing -= OnDialog; }

            var row = data.Families.SingleOrDefault(family => family.FamilyName == TitleBlock);
            var rowIssues = row?.Issues ?? [];
            Console.WriteLine($"[PE_MATRIX_NO_MODAL] dialogs seen: {string.Join(", ", seen)}; row issues: {string.Join(" | ", rowIssues.Select(i => $"{i.Code}: {i.Message}"))}; matrix issues: {string.Join(" | ", data.Issues.Select(i => $"{i.Code}: {i.Message}"))}");
            Assert.That(row, Is.Not.Null, "the matrix lists the title block");
            Assert.That(seen, Is.Not.Empty, "precondition: the fixture raises Revit's dialog (else this proves nothing)");
            Assert.Multiple(() => {
                Assert.That(rowIssues.Any(i => i.Code == "FamilyEditError" && i.Message.Contains("Rejected warning")), Is.True,
                    "the destructive copy stays refused by name on its row");
                Assert.That(data.Issues.Concat(rowIssues).Any(i => i.Code == "RevitDialogAnswered" && i.Message.Contains("Dialog_Revit_DocWarnDialog")), Is.True,
                    "the product answered Revit's dialog and named it");
            });
        } finally {
            if (project is { IsValidObject: true }) project.Close(false);
        }
    }

    /// <summary>
    ///     PROBE (hold 88746ed regression): the EditFamily gate's policy on the title block, with and without ClearAfterRollback.
    ///     Prints what the policy recorded, whether EditFamily threw, and whether a copy came back. No verdict asserted.
    /// </summary>
    [TestCase(false)]
    [TestCase(true)]
    public void Probe_the_gate_policy_with_and_without_clear_after_rollback(bool clear) {
        var application = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory($"{nameof(MatrixReadNoModalProofTests)}-probe-{clear}");
        var path = Path.Combine(directory, "Old_Template.rvt");
        File.Copy(RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt"), path, true);
        Document? project = null;
        try {
            project = application.OpenDocumentFile(path);
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == TitleBlock);
            var diagnostics = new List<(bool IsError, string Message)>();
            var events = new List<string>();
            var dialogs = new List<string>();
            void OnDialog(object? _, DialogBoxShowingEventArgs args) {
                dialogs.Add(args.DialogId);
                _ = args.OverrideResult(args.DialogId == "Dialog_Revit_DocWarnDialog" ? 3 : (int)TaskDialogResult.Cancel);
            }
            Document? copy = null;
            string outcome;
            this._ui.DialogBoxShowing += OnDialog;
            try {
                using var unguarded = RevitTestFailureGuard.Suspend();
                copy = Pe.Revit.Tasks.RevitFailureScope.Execute(project, accessor => {
                    var result = Pe.Revit.Failures.PeToolsFailureHandling.RejectUnsafeFamilyCopyFailures(accessor, diagnostics);
                    events.Add($"{accessor.GetDocument().Title}|{result}|{accessor.GetFailureMessages().Count}");
                    if (clear && result == FailureProcessingResult.ProceedWithRollBack)
                        accessor.SetFailureHandlingOptions(accessor.GetFailureHandlingOptions().SetClearAfterRollback(true));
                    return result;
                }, () => project.EditFamily(family),
                    failureDocument => failureDocument.IsFamilyDocument && string.IsNullOrEmpty(failureDocument.PathName)
                                       && string.Equals(failureDocument.Title, $"{family.Name}.rfa", StringComparison.OrdinalIgnoreCase));
                outcome = $"returned copy '{copy?.Title}'";
            } catch (Exception exception) {
                outcome = $"threw {exception.GetType().Name}: {exception.Message}";
            } finally {
                this._ui.DialogBoxShowing -= OnDialog;
                if (copy is { IsValidObject: true }) _ = copy.Close(false);
            }
            var line = $"[PE_GATE_PROBE] clear={clear} outcome={outcome}; events={string.Join(" ; ", events)}; dialogs={string.Join(",", dialogs)}; " +
                       $"diagnostics={string.Join(" | ", diagnostics.Select(d => $"{(d.IsError ? "E" : "W")} {d.Message}"))}";
            Console.WriteLine(line);
            Assert.Pass(line);
        } finally {
            if (project is { IsValidObject: true }) project.Close(false);
        }
    }

    /// <summary>The matrix read as the host op runs it.</summary>
    private static LoadedFamiliesMatrixData Read(Document project, LoadedFamiliesFilter filter) =>
        Pe.Revit.Global.Services.Host.RevitDataRequestService.ReadLoadedFamiliesMatrix(project, filter, null, false, null);
}
