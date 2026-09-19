using Autodesk.Revit.UI.Events;
using Pe.Revit.DocumentData.Families.Loaded;
using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.Tests;

/// <summary>
///     A READ never raises a Revit modal (project-a hold 4b: a matrix read blocked 6 min on "Constraints defined by highlighted Lines
///     and Dimensions can't be satisfied", which the EditFamily gate had already rejected). The process-wide test guard is suspended
///     so only product failure handling acts; any dialog Revit would show is recorded and cancelled so the run cannot hang.
/// </summary>
[TestFixture]
public sealed class ReadNoModalProofTests {
    private const string FamilyName = "PE No Modal";

    /// <summary>The project-a failure: "Constraints defined by highlighted Lines and Dimensions can't be satisfied" (FamilyFailurePolicy.KnownFailures).</summary>
    private static readonly FailureDefinitionId SketchConstraints = new(new Guid("3012554f-816b-4e6a-9b74-6b3914c87737"));

    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void The_EditFamily_gate_rejects_an_open_time_error_without_a_dialog() {
        var app = this._ui.Application;
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        try {
            var family = Load(app, project);
            var diagnostics = new List<(bool IsError, string Message)>();
            var dialogs = WithDialogRecorder(() => {
                using var unguarded = RevitTestFailureGuard.Suspend();
                var refused = Assert.Throws<InvalidOperationException>(() => project.HandleFamilyCopyFailures(family, () => {
                    var copy = project.EditFamily(family);
                    Console.WriteLine($"[PE_READ_NO_MODAL] copy title '{copy.Title}' path '{copy.PathName}'");
                    try {
                        using var t = new Transaction(copy, "Post the project-a failure");
                        _ = t.Start();
                        _ = copy.PostFailure(new FailureMessage(SketchConstraints));
                        _ = t.Commit();
                        return copy;
                    } catch {
                        _ = copy.Close(false);
                        throw;
                    }
                }, diagnostics));
                Console.WriteLine($"[PE_READ_NO_MODAL] refused: {refused!.Message}");
            });
            Assert.Multiple(() => {
                Assert.That(dialogs, Is.Empty, "no Revit dialog reached the user");
                Assert.That(diagnostics.Any(d => d.IsError && d.Message.Contains("3012554f")), Is.True, "the rejected error is recorded by name");
            });
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    [Test]
    public void A_matrix_evaluation_error_rolls_back_without_a_dialog() {
        var app = this._ui.Application;
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        try {
            var family = Load(app, project);
            using var context = LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(project, [family.Id.Value()]);
            var dialogs = WithDialogRecorder(() => {
                using var unguarded = RevitTestFailureGuard.Suspend();
                context.BeginTransaction("Matrix evaluation proof");
                LoadedFamiliesTempPlacementEngine.PlaceOneTempInstancePerPlaceableSymbol(context);
                var placed = context.GetPlacedInstancesForFamily(family.Id.Value()).Single();
                _ = project.PostFailure(new FailureMessage(SketchConstraints).SetFailingElement(placed.InstanceId));
                project.Regenerate();
                context.RollBackTransaction();
            });
            var issue = context.EvaluationIssues.SingleOrDefault(i => i.Code == "FamilyEvaluationRolledBack");
            Console.WriteLine($"[PE_READ_NO_MODAL] evaluation issue: {issue}");
            Assert.Multiple(() => {
                Assert.That(dialogs, Is.Empty, "no Revit dialog reached the user");
                Assert.That((issue?.FamilyName, issue?.TypeName), Is.EqualTo(((string?)FamilyName, (string?)"Standard")), "the rollback is named by family and type");
                Assert.That(issue?.Message, Does.Contain("3012554f"), "the Revit failure is named");
            });
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    /// <summary>Every dialog Revit tries to show while <paramref name="act" /> runs, each cancelled so nothing blocks.</summary>
    private List<string> WithDialogRecorder(Action act) {
        var dialogs = new List<string>();
        void OnDialog(object? _, DialogBoxShowingEventArgs args) {
            dialogs.Add($"{args.DialogId} {(args as TaskDialogShowingEventArgs)?.Message ?? (args as MessageBoxShowingEventArgs)?.Message}");
            Console.WriteLine($"[PE_READ_NO_MODAL] dialog: {dialogs[^1]}");
            _ = args.OverrideResult(2); // IDCANCEL
        }
        this._ui.DialogBoxShowing += OnDialog;
        try { act(); } finally { this._ui.DialogBoxShowing -= OnDialog; }
        return dialogs;
    }

    private static Family Load(Autodesk.Revit.ApplicationServices.Application app, Document project) {
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(ReadNoModalProofTests));
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(app, BuiltInCategory.OST_GenericModel, FamilyName);
        string path;
        try {
            using (var t = new Transaction(familyDocument, "Seed")) {
                _ = t.Start();
                RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Standard");
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            path = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, directory, FamilyName);
        } finally { RevitFamilyFixtureHarness.CloseDocument(familyDocument); }
        return RevitFamilyFixtureHarness.LoadFamilyIntoProject(app, project, path);
    }
}
