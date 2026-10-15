using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using NUnit.Framework;
using Pe.App.Commands;
using Pe.Revit.Loader.Documents;

namespace Pe.App.CloseModel.Tests;

[TestFixture]
public sealed class CloseModelTests {
    private static TaskDialog Show(Holdings holdings) {
        Holdings.Observation = holdings;
        string message = "";
        Assert.That(new CmdCloseModel().Execute(new ExternalCommandData(), ref message, new ElementSet()), Is.EqualTo(Result.Cancelled));
        return TaskDialog.Shown!;
    }

    [Test]
    public void Unknown_element_changes_never_offer_the_unchanged_shortcut() {
        var dialog = Show(new Holdings(true, false, false, [new(42, null, null, null, [])], []));
        Assert.That(dialog.Links.Select(link => link.Title), Does.Not.Contain("Save here, give back what hasn't changed"));
        Assert.That(dialog.MainContent, Does.Contain("unknown"));
    }

    [Test]
    public void Unknown_saved_sync_state_has_an_explicit_summary_warning_and_save_choices() {
        var dialog = Show(new Holdings(true, false, null, [], []));
        Assert.That(dialog.MainContent, Does.Contain("unknown").And.Contain("saved changes"));
        Assert.That(dialog.Links.Select(link => link.Title), Does.Contain("Save here, keep everything").And.Not.Contain("Close"));
        Assert.That(dialog.DefaultButton, Is.EqualTo(TaskDialogResult.Cancel));
    }

    [TestCase(true)]
    [TestCase(false)]
    public void Known_element_changes_keep_their_distinct_choices(bool changed) {
        var dialog = Show(new Holdings(true, false, false, [new(42, null, null, changed, [])], []));
        Assert.That(dialog.Links.Any(link => link.Title == "Save here, give back what hasn't changed"), Is.EqualTo(!changed));
        Assert.That(dialog.MainContent, Does.Not.Contain("unknown"));
    }
}
