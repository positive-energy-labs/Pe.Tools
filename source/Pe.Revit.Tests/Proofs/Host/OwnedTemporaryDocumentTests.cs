using Pe.Revit.Loader;
using Pe.Revit.Loader.Documents;

namespace Pe.Revit.Tests;

/// <summary>Parent-owned native proof. Deterministic tests cannot certify EditFamily or Close.</summary>
[TestFixture]
public sealed class OwnedTemporaryDocumentTests {
    [Test, Explicit("Requires parent-owned controlled Revit with the slice-2 Loader bytes.")]
    public void Temporary_family_preserves_borrowed_editor_and_refuses_changes_before_explicit_discard(UIApplication ui) {
        SessionCustody.RequireCurrent();
        using var tracker = new DocumentTracker(ui);
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(OwnedTemporaryDocumentTests));
        var path = Path.Combine(directory, "Same Name.rfa");
        Document? editor = null;
        Document? project = null;
        Document? temporary = null;
        try {
            editor = RevitFamilyFixtureHarness.CreateFamilyDocument(ui.Application, BuiltInCategory.OST_GenericModel, "Same Name");
            using (var tx = new Transaction(editor, "Seed family")) {
                tx.Start();
                RevitFamilyFixtureHarness.EnsureFamilyType(editor, "Original");
                tx.Commit();
            }
            editor.SaveAs(path);
            var bytes = File.ReadAllBytes(path);
            Assert.That(editor.Close(false), Is.True);
            editor = null;
            project = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
            var family = RevitFamilyFixtureHarness.LoadFamilyIntoProject(ui.Application, project, path);
            editor = ui.Application.OpenDocumentFile(path);
            using (var tx = new Transaction(editor, "Human sentinel")) {
                tx.Start();
                editor.FamilyManager.RenameCurrentType("Human sentinel");
                tx.Commit();
            }
            var borrowedId = Guid.NewGuid().ToString();
            var borrowed = OwnedTemporaryDocuments.Acquire(ui, tracker, borrowedId, "borrowed", () => editor);
            Assert.That(borrowed.Status, Is.EqualTo("borrowed"));
            var borrowedRelease = OwnedTemporaryDocuments.Release(ui, tracker, borrowedId, Guid.NewGuid().ToString(), borrowed.OpenId, discard: true);
            Assert.That(borrowedRelease.Status, Is.EqualTo("borrowed"));
            Assert.That(editor.IsValidObject && editor.IsModified, Is.True);
            Assert.That(editor.FamilyManager.CurrentType.Name, Is.EqualTo("Human sentinel"));

            var id = Guid.NewGuid().ToString();
            var opens = 0;
            var receipt = OwnedTemporaryDocuments.Acquire(ui, tracker, id, "project:F", () => {
                opens++;
                return temporary = project.EditFamily(family);
            });
            Assert.That(receipt.Status, Is.EqualTo("acquired"), receipt.Detail);
            Assert.That(receipt.OpenId, Is.Not.EqualTo(borrowed.OpenId));
            Assert.That(OwnedTemporaryDocuments.Acquire(ui, tracker, id, "project:F", () => throw new Exception("duplicate opener")), Is.EqualTo(receipt));
            Assert.That(opens, Is.EqualTo(1));
            Assert.That(temporary!.FamilyManager.CurrentType.Name, Is.EqualTo("Original"));
            using (var tx = new Transaction(temporary, "Adaptive edit")) {
                tx.Start();
                temporary.FamilyManager.RenameCurrentType("Adaptive edit");
                tx.Commit();
            }
            var automatic = OwnedTemporaryDocuments.Release(ui, tracker, id, Guid.NewGuid().ToString(), receipt.OpenId);
            Assert.That(automatic.Status, Is.EqualTo("recovery-required"));
            Assert.That(temporary.IsValidObject, Is.True);
            var discarded = OwnedTemporaryDocuments.Release(ui, tracker, id, Guid.NewGuid().ToString(), receipt.OpenId, discard: true);
            Assert.That(discarded.Status, Is.EqualTo("released"), discarded.Detail);
            Assert.That(NativeDocumentClose.Contains(ui, temporary), Is.False);
            temporary = null;
            Assert.That(editor.IsValidObject && editor.IsModified, Is.True);
            Assert.That(editor.FamilyManager.CurrentType.Name, Is.EqualTo("Human sentinel"));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(bytes));
        } finally {
            if (temporary is { IsValidObject: true }) temporary.Close(false);
            if (editor is { IsValidObject: true }) editor.Close(false);
            if (project is { IsValidObject: true }) project.Close(false);
        }
    }

    [Test, Explicit("Requires parent-owned controlled Revit with the slice-2 Loader bytes.")]
    public void Reopened_path_is_a_new_lifetime_and_stale_release_does_not_close_it(UIApplication ui) {
        SessionCustody.RequireCurrent();
        using var tracker = new DocumentTracker(ui);
        var path = Path.Combine(RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(OwnedTemporaryDocumentTests)), "Reopened.rvt");
        Document? document = ui.Application.NewProjectDocument(UnitSystem.Imperial);
        Document? unchanged = null;
        try {
            document.SaveAs(path);
            Assert.That(document.Close(false), Is.True);
            document = null;
            var id = Guid.NewGuid().ToString();
            var receipt = OwnedTemporaryDocuments.Acquire(ui, tracker, id, path, () => document = ui.Application.OpenDocumentFile(path));
            Assert.That(receipt.Status, Is.EqualTo("acquired"), receipt.Detail);
            Assert.That(document!.Close(false), Is.True);
            document = ui.Application.OpenDocumentFile(path);
            Assert.That(tracker.Track(document).OpenId, Is.Not.EqualTo(receipt.OpenId));
            var release = OwnedTemporaryDocuments.Release(ui, tracker, id, Guid.NewGuid().ToString(), receipt.OpenId);
            Assert.That(release.Status, Is.EqualTo("released"), release.Detail);
            Assert.That(document.IsValidObject && NativeDocumentClose.Contains(ui, document), Is.True);
            var next = Guid.NewGuid().ToString();
            var acquired = OwnedTemporaryDocuments.Acquire(ui, tracker, next, "unchanged", () => unchanged = ui.Application.NewProjectDocument(UnitSystem.Imperial));
            var closed = OwnedTemporaryDocuments.Release(ui, tracker, next, Guid.NewGuid().ToString(), acquired.OpenId);
            Assert.That(closed.Status, Is.EqualTo("released"), closed.Detail);
            Assert.That(NativeDocumentClose.Contains(ui, unchanged!), Is.False);
        } finally {
            if (unchanged is { IsValidObject: true }) unchanged.Close(false);
            if (document is { IsValidObject: true }) document.Close(false);
        }
    }
}
