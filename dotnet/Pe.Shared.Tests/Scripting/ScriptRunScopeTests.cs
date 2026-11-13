using Pe.Shared.Scripting.Execution;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

/// <summary>
///     The deterministic half of the script save hold (ADR 0038 rule 5): the run scope's lifetime and
///     the project/family decision. Whether Revit honours the cancel is proved in Pe.Revit.Tests.
/// </summary>
[TestFixture, NonParallelizable]
public sealed class ScriptRunScopeTests {
    private static readonly ScriptSaveKind[] HeldKinds =
        [ScriptSaveKind.Save, ScriptSaveKind.SaveAsOverExisting, ScriptSaveKind.Synchronize];

    // Mutants: ignoring the caller holds Person; flipping the request default lets an omitted caller save.
    [Test]
    public void Only_the_persons_script_bypasses_the_hold_and_omitted_caller_is_guarded() {
        Assert.That(new ExecuteRevitScriptRequest().Caller, Is.EqualTo(ScriptCaller.Agent));
        foreach (var caller in new[] { ScriptCaller.Person, ScriptCaller.Agent, new ExecuteRevitScriptRequest().Caller }) {
            using var run = ScriptRunScope.Enter(caller);
            foreach (var kind in HeldKinds)
                Assert.That(ScriptRunScope.Holds(kind, false), Is.EqualTo(caller != ScriptCaller.Person), $"{caller}: {kind}");
            Assert.That(run.Held, Is.Null);
        }
        using var agent = ScriptRunScope.Enter(ScriptCaller.Agent);
        using (ScriptRunScope.Enter(ScriptCaller.Person))
            Assert.That(ScriptRunScope.Holds(ScriptSaveKind.Save, false), Is.False);
        Assert.That(ScriptRunScope.Holds(ScriptSaveKind.Save, false), Is.True);
    }

    // Mutant, run red once: Dispose that leaves the scope set (`Current = this._outer` deleted) fails every line after a using.
    [Test]
    public void The_scope_is_active_only_between_enter_and_dispose() {
        Assert.That(ScriptRunScope.Current, Is.Null);
        using (var run = ScriptRunScope.Enter(ScriptCaller.Agent)) {
            Assert.That(ScriptRunScope.Current, Is.SameAs(run));
            using (var inner = ScriptRunScope.Enter(ScriptCaller.Person))
                Assert.That(ScriptRunScope.Current, Is.SameAs(inner));
            Assert.That(ScriptRunScope.Current, Is.SameAs(run), "a nested run hands the scope back to its outer run");
            run.Dispose();
            run.Dispose();
        }
        Assert.That(ScriptRunScope.Current, Is.Null);

        Assert.Throws<InvalidOperationException>(() => {
            using var run = ScriptRunScope.Enter(ScriptCaller.Agent);
            throw new InvalidOperationException("the script threw");
        });
        Assert.That(ScriptRunScope.Current, Is.Null, "a run that throws still clears the scope");
    }

    // Mutants, each run red once. Hold with no run (`Current is not null &&` deleted) fails the first block.
    // Drop the family exemption (`!isFamilyDocument &&` deleted) fails the family line. Hold a save-as to a new
    // path (`kind != ScriptSaveKind.SaveAsNewPath` deleted) fails the new-path line.
    [Test]
    public void Only_a_project_overwrite_or_synchronize_inside_a_run_is_held() {
        foreach (var kind in Enum.GetValues<ScriptSaveKind>())
            Assert.That(ScriptRunScope.Holds(kind, isFamilyDocument: false), Is.False, $"{kind} outside a run is the person's");

        using var run = ScriptRunScope.Enter(ScriptCaller.Agent);
        foreach (var kind in HeldKinds)
            Assert.That(ScriptRunScope.Holds(kind, isFamilyDocument: false), Is.True, $"{kind} of a project inside a run");
        foreach (var kind in Enum.GetValues<ScriptSaveKind>())
            Assert.That(ScriptRunScope.Holds(kind, isFamilyDocument: true), Is.False, $"{kind} of a family is never held");
        Assert.That(ScriptRunScope.Holds(ScriptSaveKind.SaveAsNewPath, isFamilyDocument: false), Is.False, "a new path overwrites nothing");
    }

    [Test]
    public void A_run_reports_one_reason_for_what_it_held() {
        using var run = ScriptRunScope.Enter(ScriptCaller.Agent);
        Assert.That(run.Held, Is.Null);

        run.RecordHeld(ScriptSaveKind.Save, "Chadds.rvt");
        run.RecordHeld(ScriptSaveKind.Save, "Chadds.rvt");
        run.RecordHeld(ScriptSaveKind.Synchronize, "Chadds.rvt");

        Assert.That(run.Held, Does.StartWith("Held, not done: "));
        Assert.That(run.Held!.Split("'Chadds.rvt'").Length - 1, Is.EqualTo(2), "the same held act is named once");
        Assert.That(run.Held, Does.Contain("presses Save in Revit").And.Contain("presses Synchronize in Revit"));
    }
}
