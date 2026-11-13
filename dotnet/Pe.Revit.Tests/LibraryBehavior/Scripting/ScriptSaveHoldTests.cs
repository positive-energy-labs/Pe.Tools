using Pe.Revit.Scripting.Execution;
using Pe.Shared.HostContracts.Scripting;
using System.Security.Cryptography;

namespace Pe.Revit.Tests;

/// <summary>
///     ADR 0038 rule 5 on real Revit: a project save or synchronize that fires inside a Pea script run is
///     cancelled at the pre-event and the run reports "held"; a person's script, family save and save outside a run go
///     through. This is assumption A of the homes MAP. Every test writes only under a temp folder: with
///     PE_SAVE_HOLD_FIXTURE naming the detached Chadds clone the project is a copy of it, and without it
///     a blank project. Each "not held" test carries a sentinel (the pre-event was seen), so a pass
///     is never an event that did not fire.
/// </summary>
[TestFixture]
public sealed class ScriptSaveHoldTests {
    private const string FixtureVariable = "PE_SAVE_HOLD_FIXTURE";
    private const string SaveScript = "doc!.Save();";

    // Mutants, each run red once. "never cancels": delete `args.Cancel();` in ScriptSaveHold.Hold; the bytes
    // and the modified time change. "scope never set": delete `using var run = ScriptRunScope.Enter(request.Caller);` in
    // RevitScriptExecutionService.Execute; nothing is held and the file is written.
    [Test]
    public void A_script_save_of_a_project_is_cancelled_and_reported_held(UIApplication uiApplication) =>
        ProjectSave(uiApplication, null);

    [Test]
    public void An_agent_script_save_of_a_project_is_held(UIApplication uiApplication) =>
        ProjectSave(uiApplication, ScriptCaller.Agent);

    [Test]
    public void A_persons_script_save_of_a_project_writes_the_file(UIApplication uiApplication) =>
        ProjectSave(uiApplication, ScriptCaller.Person);

    private static void ProjectSave(UIApplication uiApplication, ScriptCaller? caller) {
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(A_script_save_of_a_project_is_cancelled_and_reported_held));
        var path = ProjectCopy(uiApplication.Application, directory);
        var document = uiApplication.Application.OpenDocumentFile(path);
        using var hold = ScriptSaveHold.Register(uiApplication.Application);
        try {
            Touch(document);
            var before = Stamp(path);

            var result = Run(uiApplication, document, SaveScript, caller);

            TestContext.Out.WriteLine($"status={result.Status}; diagnostics={string.Join(" | ", result.Diagnostics.Select(d => d.Message))}");
            if (caller == ScriptCaller.Person) {
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
                Assert.That(result.Held, Is.Null);
                Assert.That(Stamp(path).Sha256, Is.Not.EqualTo(before.Sha256), "the person's script saves the changed project");
                Assert.That(document.IsModified, Is.False);
            } else {
                Assert.That(result.Held, Does.StartWith("Held, not done: ").And.Contain(document.Title).And.Contain("presses Save in Revit"));
                Assert.That(Stamp(path), Is.EqualTo(before), "a held save leaves the file's bytes and modified time alone");
                Assert.That(document.IsModified, Is.True, "the unsaved change is still the person's to save");
            }
        } finally { _ = document.Close(false); }
    }

    // Mutant, run red once: "new path is held": delete `kind != ScriptSaveKind.SaveAsNewPath` in ScriptRunScope.Holds;
    // the new file is never written. The over-existing half goes red under "never cancels".
    [Test]
    public void A_script_save_as_is_held_only_over_an_existing_file(UIApplication uiApplication) {
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(A_script_save_as_is_held_only_over_an_existing_file));
        var path = ProjectCopy(uiApplication.Application, directory);
        var existing = Path.Combine(directory, "Existing.rvt");
        File.Copy(path, existing);
        var fresh = Path.Combine(directory, "Fresh.rvt");
        var document = uiApplication.Application.OpenDocumentFile(path);
        using var hold = ScriptSaveHold.Register(uiApplication.Application);
        try {
            var before = Stamp(existing);
            var over = Run(uiApplication, document, SaveAsScript(existing));
            TestContext.Out.WriteLine($"over: status={over.Status}; diagnostics={string.Join(" | ", over.Diagnostics.Select(d => d.Message))}");
            Assert.That(over.Held, Does.StartWith("Held, not done: "));
            Assert.That(Stamp(existing), Is.EqualTo(before));

            var toNew = Run(uiApplication, document, SaveAsScript(fresh));
            Assert.That(toNew.Held, Is.Null, string.Join(" | ", toNew.Diagnostics.Select(d => d.Message)));
            Assert.That(toNew.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
            Assert.That(File.Exists(fresh), Is.True);
        } finally { _ = document.Close(false); }
    }

    // Mutant, run red once: "families are held": delete `!isFamilyDocument &&` in ScriptRunScope.Holds; the run
    // reports held and the family file is not rewritten.
    [Test]
    public void A_script_save_of_a_family_is_not_held(UIApplication uiApplication) {
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(A_script_save_of_a_family_is_not_held));
        var path = Path.Combine(directory, "SaveHold.rfa");
        var family = RevitFamilyFixtureHarness.CreateFamilyDocument(uiApplication.Application, BuiltInCategory.OST_GenericModel, "SaveHold");
        family.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
        using var hold = ScriptSaveHold.Register(uiApplication.Application);
        var saving = 0;
        void Seen(object? sender, Autodesk.Revit.DB.Events.DocumentSavingEventArgs args) => saving++;
        uiApplication.Application.DocumentSaving += Seen;
        try {
            var before = Stamp(path);

            var result = Run(uiApplication, family, SaveScript);

            Assert.That(saving, Is.EqualTo(1), "sentinel: the pre-event fired for the family save");
            Assert.That(result.Held, Is.Null);
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), string.Join(" | ", result.Diagnostics.Select(d => d.Message)));
            Assert.That(Stamp(path).ModifiedUtc, Is.GreaterThan(before.ModifiedUtc), "the family file was written");
        } finally {
            uiApplication.Application.DocumentSaving -= Seen;
            _ = family.Close(false);
        }
    }

    // Mutant, run red once: "held with no run": delete `Current is not null &&` in ScriptRunScope.Holds; Save throws
    // or the file is not written.
    [Test]
    public void A_project_save_outside_a_script_run_is_not_held(UIApplication uiApplication) {
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(A_project_save_outside_a_script_run_is_not_held));
        var path = ProjectCopy(uiApplication.Application, directory);
        var document = uiApplication.Application.OpenDocumentFile(path);
        using var hold = ScriptSaveHold.Register(uiApplication.Application);
        var saving = 0;
        void Seen(object? sender, Autodesk.Revit.DB.Events.DocumentSavingEventArgs args) => saving++;
        uiApplication.Application.DocumentSaving += Seen;
        try {
            // A run that came and went must leave nothing behind: the save after it is the person's.
            Assert.That(Run(uiApplication, document, "WriteLine(doc!.Title);").Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
            Touch(document);
            var before = Stamp(path);

            document.Save();

            Assert.That(saving, Is.EqualTo(1), "sentinel: the pre-event fired with the subscriber registered");
            Assert.That(Stamp(path).ModifiedUtc, Is.GreaterThan(before.ModifiedUtc), "the person's save wrote the file");
            Assert.That(document.IsModified, Is.False);
        } finally {
            uiApplication.Application.DocumentSaving -= Seen;
            _ = document.Close(false);
        }
    }

    // A local central in a temp folder: a blank project made workshared, saved as central, and a local of it.
    // Mutants as for the save test ("never cancels", "scope never set"): the central's bytes change.
    [Test]
    public void A_script_synchronize_of_a_project_is_cancelled_and_reported_held(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(A_script_synchronize_of_a_project_is_cancelled_and_reported_held));
        var centralPath = Path.Combine(directory, "Central.rvt");
        var localPath = Path.Combine(directory, "Local.rvt");
        var central = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        central.EnableWorksharing("Shared Levels and Grids", "Workset1");
        var asCentral = new SaveAsOptions { OverwriteExistingFile = true };
        asCentral.SetWorksharingOptions(new WorksharingSaveAsOptions { SaveAsCentral = true });
        central.SaveAs(centralPath, asCentral);
        _ = central.Close(false);
        WorksharingUtils.CreateNewLocal(
            ModelPathUtils.ConvertUserVisiblePathToModelPath(centralPath),
            ModelPathUtils.ConvertUserVisiblePathToModelPath(localPath));
        var local = application.OpenDocumentFile(localPath);
        using var hold = ScriptSaveHold.Register(application);
        try {
            Touch(local);
            var before = Stamp(centralPath);

            var result = Run(uiApplication, local,
                "doc!.SynchronizeWithCentral(new TransactWithCentralOptions(), new SynchronizeWithCentralOptions());");

            TestContext.Out.WriteLine($"status={result.Status}; diagnostics={string.Join(" | ", result.Diagnostics.Select(d => d.Message))}");
            Assert.That(result.Held, Does.StartWith("Held, not done: ").And.Contain("presses Synchronize in Revit"));
            Assert.That(Stamp(centralPath), Is.EqualTo(before), "a held synchronize leaves the central alone");
        } finally { _ = local.Close(false); }
    }

    private static ExecuteRevitScriptData Run(UIApplication uiApplication, Document document, string script, ScriptCaller? caller = null) {
        var request = new ExecuteRevitScriptRequest(script, PermissionMode: ScriptPermissionMode.NoTransaction);
        if (caller is { } explicitCaller) request = request with { Caller = explicitCaller };
        return RevitScriptExecutionService.CreateDefault(() => uiApplication).Execute(document, request,
            "save-hold-" + Guid.NewGuid().ToString("N"));
    }

    private static string SaveAsScript(string path) =>
        $"doc!.SaveAs(@\"{path}\", new SaveAsOptions {{ OverwriteExistingFile = true }});";

    /// <summary>A project file this test owns: a copy of the detached clone when the variable names it, else a blank project.</summary>
    private static string ProjectCopy(Application application, string directory) {
        var path = Path.Combine(directory, "SaveHold.rvt");
        var fixture = Environment.GetEnvironmentVariable(FixtureVariable);
        if (!string.IsNullOrWhiteSpace(fixture)) {
            File.Copy(fixture, path);
            File.SetAttributes(path, FileAttributes.Normal);
        } else {
            var blank = RevitFamilyFixtureHarness.CreateProjectDocument(application);
            blank.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
            _ = blank.Close(false);
        }
        TestContext.Out.WriteLine($"project={path}; source={fixture ?? "blank project"}");
        return path;
    }

    /// <summary>One real unsaved change, so a save that goes through has something to write.</summary>
    private static void Touch(Document document) {
        using var transaction = new Transaction(document, "Save hold test change");
        _ = transaction.Start();
        document.ProjectInformation.Author = "save-hold-" + Guid.NewGuid().ToString("N");
        _ = transaction.Commit();
    }

    private static (string Sha256, DateTime ModifiedUtc) Stamp(string path) {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return (Convert.ToHexString(SHA256.HashData(stream)), File.GetLastWriteTimeUtc(path));
    }
}
