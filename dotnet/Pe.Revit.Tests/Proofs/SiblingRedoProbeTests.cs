using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Execution;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

/// <summary>
///     Does a script run take a person's Redo in a document it was not run on? (Purger finding F-W18-2 on the
///     sibling fence, ADR 0044.) Revit 2025 has no API that reads the redo stack, and it runs a posted Undo or
///     Redo only when it is idle, so this is no ordinary test: it is one step of a state machine, and each step
///     is one attached run in a session that stays up between them.
///     Runbook: start a controlled session, create the state file `%LOCALAPPDATA%\Temp\pe-redo-probe\state.json`
///     holding `{}`, then run this fixture with `pe-revit test --attach --no-build` once per step until the
///     state says `done`. The verdict lines are in `log.txt` beside it. Without the state file the step is ignored.
///     Each scenario: commit an edit in the sibling and post Undo; next step, check the undo landed, do the
///     scenario's act, and post Redo; next step, read whether the edit is back.
/// </summary>
[TestFixture, Explicit("One step of a multi-run probe; see the runbook in the summary.")]
public sealed class SiblingRedoProbeTests {
    private static readonly string Home = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temp", "pe-redo-probe");

    private static readonly (string Name, Action<UIApplication, Document, Document> Act)[] Scenarios = [
        ("control: nothing between Undo and Redo", (_, _, _) => { }),
        ("a ReadOnly script on the target that only reads", (app, target, _) => Run(app, target, "WriteLine(doc!.Title);", ScriptPermissionMode.ReadOnly)),
        ("a WriteTransaction script on the target", (app, target, _) => Run(app, target, "doc!.ProjectInformation.Author = System.Guid.NewGuid().ToString();", ScriptPermissionMode.WriteTransaction)),
        ("a NoTransaction script that commits on the target", (app, target, _) => Run(app, target,
            "using (var own = new Transaction(doc, \"Probe target\")) { _ = own.Start(); doc!.ProjectInformation.Author = System.Guid.NewGuid().ToString(); _ = own.Commit(); }",
            ScriptPermissionMode.NoTransaction)),
        ("a ReadOnly script on the target that commits in this document (fenced, rolled back)", (app, target, sibling) => Run(app, target,
            $"var other = app.Application.Documents.Cast<Document>().First(each => each.Title == \"{sibling.Title}\");\n" +
            "using (var transaction = (Transaction)Activator.CreateInstance(typeof(Transaction), other, \"Probe sibling\")!) { _ = transaction.Start(); other.ProjectInformation.Author = \"fenced\"; WriteLine(\"sibling commit \" + transaction.Commit()); }",
            ScriptPermissionMode.ReadOnly)),
        ("a ReadOnly script run on this document itself (its rollback guard, no fence)", (app, _, sibling) => Run(app, sibling, "WriteLine(doc!.Title);", ScriptPermissionMode.ReadOnly)),
        ("instrument check: a raw committed transaction in this document, which must take Redo", (_, _, sibling) => {
            using var transaction = new Transaction(sibling, "Probe negative control");
            _ = transaction.Start();
            sibling.ProjectInformation.Number = Guid.NewGuid().ToString();
            Say("  raw commit: " + transaction.Commit());
        })
    ];

    [Test]
    public void Step(UIApplication uiApplication) {
        var statePath = Path.Combine(Home, "state.json");
        if (!File.Exists(statePath)) Assert.Ignore("The Redo probe runs only from its runbook; see the fixture summary.");
        var state = JObject.Parse(File.ReadAllText(statePath));
        if (state.Value<bool>("done")) Assert.Ignore("The Redo probe has finished; read log.txt.");
        var step = state.Value<int?>("step") ?? 0;
        var redo = RevitCommandId.LookupPostableCommandId(PostableCommand.Redo);

        if (step == 0) {
            state["target"] = Create(uiApplication, "Redo-target");
            state["sibling"] = Create(uiApplication, "Redo-sibling");
            state["name"] = "base";
        }
        var target = Open(uiApplication, state.Value<string>("target")!, activate: false);
        var sibling = Open(uiApplication, state.Value<string>("sibling")!, activate: true);
        var scenario = (step - 1) / 2;

        if (step % 2 == 1) {
            // The act: the Undo posted by the last step has run, or the instrument is broken.
            var undone = sibling.ProjectInformation.Name == state.Value<string>("name");
            Say($"scenario {scenario}: {Scenarios[scenario].Name}");
            Say($"  undo landed: {undone} (name '{sibling.ProjectInformation.Name}'); Redo postable before: {uiApplication.CanPostCommand(redo)}");
            Scenarios[scenario].Act(uiApplication, target, sibling);
            Say($"  Redo postable after: {uiApplication.CanPostCommand(redo)}; sibling modified: {sibling.IsModified}");
            uiApplication.PostCommand(redo);
            state["undone"] = undone;
        } else {
            if (step > 0) {
                var kept = sibling.ProjectInformation.Name == $"edit-{scenario - 1}";
                var done = scenario - 1;
                Say($"  VERDICT scenario {done}: Redo {(kept ? "KEPT" : "LOST")} (name '{sibling.ProjectInformation.Name}', undo landed {state.Value<bool>("undone")})");
                state["name"] = sibling.ProjectInformation.Name;
            }
            if (scenario < Scenarios.Length) {
                using (var transaction = new Transaction(sibling, $"Probe edit {scenario}")) {
                    _ = transaction.Start();
                    sibling.ProjectInformation.Name = $"edit-{scenario}";
                    _ = transaction.Commit();
                }
                uiApplication.PostCommand(RevitCommandId.LookupPostableCommandId(PostableCommand.Undo));
            } else {
                state["done"] = true;
                Say("done");
            }
        }

        state["step"] = step + 1;
        File.WriteAllText(statePath, state.ToString());
    }

    private static void Say(string line) {
        File.AppendAllText(Path.Combine(Home, "log.txt"), line + Environment.NewLine);
        Console.WriteLine("[PE_REDO_PROBE] " + line);
    }

    private static void Run(UIApplication uiApplication, Document document, string script, ScriptPermissionMode mode) {
        var result = RevitScriptExecutionService.CreateDefault(() => uiApplication).Execute(document,
            new ExecuteRevitScriptRequest(script, SourceName: "redo-probe", PermissionMode: mode), "redo-" + Guid.NewGuid().ToString("N"));
        Say($"  script {mode} on '{document.Title}': {result.Status}; {result.Changes?.Summary}; output '{result.Output.Trim()}'");
        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded),
            string.Join("; ", result.Diagnostics.Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error).Select(diagnostic => diagnostic.Message)));
    }

    private static string Create(UIApplication uiApplication, string name) {
        var path = Path.Combine(Home, Guid.NewGuid().ToString("N").Substring(0, 8), name + ".rvt");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var blank = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        using (var transaction = new Transaction(blank, "Name the fixture")) {
            _ = transaction.Start();
            blank.ProjectInformation.Name = "base";
            _ = transaction.Commit();
        }
        blank.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
        _ = blank.Close(false);
        return path;
    }

    /// <summary>The open document at <paramref name="path" />, opened when it is not; made active when asked.</summary>
    private static Document Open(UIApplication uiApplication, string path, bool activate) {
        var open = uiApplication.Application.Documents.Cast<Document>()
            .FirstOrDefault(each => string.Equals(each.PathName, path, StringComparison.OrdinalIgnoreCase));
        if (activate && uiApplication.ActiveUIDocument?.Document.Equals(open) != true)
            return uiApplication.OpenAndActivateDocument(path).Document;
        return open ?? uiApplication.Application.OpenDocumentFile(path);
    }
}
