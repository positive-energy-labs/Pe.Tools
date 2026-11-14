using Autodesk.Revit.DB.Events;

namespace Pe.Revit.Tests;

/// <summary>
///     The platform facts the script sibling fence stands on (D14, pods run 2026-11-14), on raw Revit API with no
///     product code: a transaction group held open on a second open document, and rolled back when the run ends,
///     discards what the run committed there, in the transaction shape of each script mode. The fence itself is
///     tested through the service in ScriptSiblingFenceTests.
/// </summary>
[TestFixture]
public sealed class SiblingFenceProofTests {
    private const string Original = "__pe_original__";

    [Test]
    public void A_group_held_on_a_sibling_discards_its_commits_in_every_mode_shape(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var target = Open(uiApplication, "target", activate: true);
        var sibling = Open(uiApplication, "sibling", activate: false);
        var events = new List<string>();
        void OnChanged(object? sender, DocumentChangedEventArgs args) => events.Add(
            $"{args.GetDocument().Title} {args.Operation} [{string.Join(",", args.GetTransactionNames())}] +{args.GetAddedElementIds().Count} ~{args.GetModifiedElementIds().Count} -{args.GetDeletedElementIds().Count}");
        application.DocumentChanged += OnChanged;
        var facts = new List<string>();
        void Fact(string name, object? value) { facts.Add($"{name}: {value}"); TestContext.Out.WriteLine($"FACT {name}: {value}"); }
        try {
            Assert.That(target.Equals(sibling), Is.False);
            Fact("open documents", string.Join(", ", application.Documents.Cast<Document>().Select(each => each.Title)));

            // NoTransaction: the run's group on the target is assimilated; the script commits on both documents.
            using (var fence = Fence(sibling))
            using (var undo = new TransactionGroup(target, "Pe script: spike")) {
                Assert.That(undo.Start(), Is.EqualTo(TransactionStatus.Started));
                Fact("NoTransaction sibling commit", Rename(sibling, "nt-sibling"));
                Fact("NoTransaction target commit", Rename(target, "nt-target"));
                // A script's own group on the sibling nests inside the fence and is assimilated into it.
                using (var nested = new TransactionGroup(sibling, "script group")) {
                    Fact("nested group start", nested.Start());
                    Fact("nested commit", Rename(sibling, "nt-sibling-nested"));
                    Fact("nested assimilate", nested.Assimilate());
                }
                Fact("sibling name inside fence", sibling.ProjectInformation.Name);
                Fact("target assimilate", undo.Assimilate());
                Fact("NoTransaction fence rollback", fence.RollBack());
            }
            Assert.Multiple(() => {
                Assert.That(sibling.ProjectInformation.Name, Is.EqualTo(Original), "NoTransaction: the sibling commit is gone");
                Assert.That(target.ProjectInformation.Name, Is.EqualTo("nt-target"), "NoTransaction: the target commit stays");
            });
            Fact("sibling IsModified after NoTransaction fence", sibling.IsModified);
            Fact("events NoTransaction", "\n    " + string.Join("\n    ", events));
            events.Clear();

            // WriteTransaction: one host-owned transaction is open on the target while a library commits on the sibling.
            using (var fence = Fence(sibling)) {
                using (var host = new Transaction(target, "Pe script: spike")) {
                    Assert.That(host.Start(), Is.EqualTo(TransactionStatus.Started));
                    target.ProjectInformation.Name = "wt-target";
                    Fact("WriteTransaction sibling commit under an open target transaction", Rename(sibling, "wt-sibling"));
                    Fact("WriteTransaction target commit", host.Commit());
                }
                Fact("WriteTransaction fence rollback", fence.RollBack());
            }
            Assert.Multiple(() => {
                Assert.That(sibling.ProjectInformation.Name, Is.EqualTo(Original), "WriteTransaction: the sibling commit is gone");
                Assert.That(target.ProjectInformation.Name, Is.EqualTo("wt-target"), "WriteTransaction: the target commit stays");
            });
            Fact("events WriteTransaction", "\n    " + string.Join("\n    ", events));
            events.Clear();

            // ReadOnly: the guard commits the script's target changes inside a group that rolls back.
            using (var fence = Fence(sibling)) {
                using (var guard = new TransactionGroup(target, "guard")) {
                    Assert.That(guard.Start(), Is.EqualTo(TransactionStatus.Started));
                    using (var inner = new Transaction(target, "guard")) {
                        Assert.That(inner.Start(), Is.EqualTo(TransactionStatus.Started));
                        target.ProjectInformation.Name = "ro-target";
                        Fact("ReadOnly sibling commit under the guard", Rename(sibling, "ro-sibling"));
                        Fact("ReadOnly guard commit", inner.Commit());
                    }
                    Fact("ReadOnly guard rollback", guard.RollBack());
                }
                Fact("ReadOnly fence rollback", fence.RollBack());
            }
            Assert.Multiple(() => {
                Assert.That(sibling.ProjectInformation.Name, Is.EqualTo(Original), "ReadOnly: the sibling commit is gone");
                Assert.That(target.ProjectInformation.Name, Is.EqualTo("wt-target"), "ReadOnly: the target is as it was");
            });
            Fact("events ReadOnly", "\n    " + string.Join("\n    ", events));
            events.Clear();

            // What a person had changed in the sibling before the run is not the run's, and stays.
            Assert.That(Rename(sibling, "person-edit"), Is.EqualTo(TransactionStatus.Committed));
            using (var fence = Fence(sibling)) {
                _ = Rename(sibling, "run-edit");
                Fact("fence rollback over a person's unsaved edit", fence.RollBack());
            }
            Assert.That(sibling.ProjectInformation.Name, Is.EqualTo("person-edit"), "the person's earlier unsaved edit stays");
            Fact("sibling IsModified with the person's edit", sibling.IsModified);

            // A document the run opens itself has no fence, and what the run commits in it stays.
            using (var fence = Fence(sibling)) {
                var opened = application.NewProjectDocument(UnitSystem.Imperial);
                Fact("opened document commit", Rename(opened, "opened-by-run"));
                Fact("fence rollback with a run-opened document", fence.RollBack());
                Assert.That(opened.ProjectInformation.Name, Is.EqualTo("opened-by-run"), "a document the run opened keeps its commit");
                _ = opened.Close(false);
            }

            // EditFamily from the fenced sibling, and the load back into it.
            using (var fence = Fence(sibling)) {
                Fact("EditFamily and LoadFamily on the fenced sibling", Try(() => {
                    var family = new FilteredElementCollector(sibling).OfClass(typeof(Family)).Cast<Family>().FirstOrDefault(each => each.IsEditable);
                    if (family is null) return "no editable family";
                    var types = family.GetFamilySymbolIds().Count;
                    var familyDocument = sibling.EditFamily(family);
                    try {
                        using (var transaction = new Transaction(familyDocument, "Touch family")) {
                            _ = transaction.Start();
                            _ = familyDocument.FamilyManager.NewType("pe-fence-" + Guid.NewGuid().ToString("N"));
                            _ = transaction.Commit();
                        }
                        var loaded = familyDocument.LoadFamily(sibling, new Overwrite());
                        var inside = loaded.GetFamilySymbolIds().Count;
                        _ = fence.RollBack();
                        var after = ((Family)sibling.GetElement(family.Id)).GetFamilySymbolIds().Count;
                        return $"types before {types}, inside the fence {inside}, after rollback {after}";
                    } finally { _ = familyDocument.Close(false); }
                }));
                if (fence.HasStarted() && !fence.HasEnded()) _ = fence.RollBack();
            }

            // Revit's own refusals while the fence is up.
            using (var fence = Fence(sibling)) {
                Fact("sibling Save inside the fence", Try(() => { sibling.Save(); return "saved"; }));
                Fact("sibling SaveAs inside the fence", Try(() => {
                    sibling.SaveAs(Path.Combine(RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("sibling-fence-saveas"), "Other.rvt"));
                    return "saved";
                }));
                Fact("target Save while the sibling is fenced", Try(() => { target.Save(); return "saved"; }));
                Fact("a second fence group start", Try(() => { using var second = new TransactionGroup(sibling, "second"); var status = second.Start(); _ = second.RollBack(); return status.ToString(); }));
                Fact("sibling Close inside the fence", Try(() => sibling.Close(false).ToString()));
                Fact("sibling valid after Close", sibling.IsValidObject);
                Fact("fence rollback after Save and Close attempts", Try(() => fence.RollBack().ToString()));
            }
            if (sibling.IsValidObject)
                Assert.That(sibling.ProjectInformation.Name, Is.EqualTo("person-edit"));
        } finally {
            application.DocumentChanged -= OnChanged;
            TestContext.Out.WriteLine("VERDICT TABLE\n" + string.Join("\n", facts));
        }
    }

    private static TransactionGroup Fence(Document sibling) {
        var group = new TransactionGroup(sibling, "Pe script fence");
        Assert.That(group.Start(), Is.EqualTo(TransactionStatus.Started));
        return group;
    }

    private static TransactionStatus Rename(Document document, string name) {
        using var transaction = new Transaction(document, $"Rename to {name}");
        _ = transaction.Start();
        document.ProjectInformation.Name = name;
        return transaction.Commit();
    }

    private static string Try(Func<string> act) {
        try { return act(); } catch (Exception exception) { return $"{exception.GetType().Name}: {exception.Message}"; }
    }

    /// <summary>A blank project this test owns, saved under a temp folder with a known project name.</summary>
    private static Document Open(UIApplication uiApplication, string name, bool activate) {
        var path = Path.Combine(RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("sibling-fence-" + name), $"Fence-{name}.rvt");
        var blank = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        _ = Rename(blank, Original);
        blank.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
        _ = blank.Close(false);
        return activate ? uiApplication.OpenAndActivateDocument(path).Document : uiApplication.Application.OpenDocumentFile(path);
    }

    private sealed class Overwrite : IFamilyLoadOptions {
        public bool OnFamilyFound(bool familyInUse, out bool overwriteParameterValues) { overwriteParameterValues = true; return true; }
        public bool OnSharedFamilyFound(Family sharedFamily, bool familyInUse, out FamilySource source, out bool overwriteParameterValues) {
            source = FamilySource.Family; overwriteParameterValues = true; return true;
        }
    }
}
