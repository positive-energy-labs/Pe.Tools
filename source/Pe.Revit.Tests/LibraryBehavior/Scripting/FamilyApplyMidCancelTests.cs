using Autodesk.Revit.DB.Events;
using Newtonsoft.Json.Linq;
using Pe.App.Host;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

/// <summary>
///     A cancel that arrives after a family's edit has opened a transaction. The only cancellation checkpoint in
///     Family apply sits between families (<c>FamilyFoundryBridgeOps.ApplyFamilies</c>), so a cancel inside one
///     family's edit cannot interrupt it. These tests pin what then actually happens: the family in flight finishes,
///     families not yet started never start, and nothing that finished is rolled back.
///     The cancel is raised from Revit's public <c>DocumentChanged</c> event on the first committed change in a family
///     document, which is inside the apply, after that family's transaction opened. No product code is modified.
/// </summary>
[TestFixture]
public sealed class FamilyApplyMidCancelTests {
    private const string ApplySpec = "{\r\n  \"patch\": { \"parameters\": { \"Proof\": { \"dataType\": \"Text\", \"value\": \"kept\" } } }\r\n}";

    [Test]
    public void A_cancel_inside_the_only_family_edit_does_not_interrupt_it(UIApplication ui) {
        var (pod, source, applySpec) = PodRunInputTests.NewPod(ApplySpec);
        Document? document = null;
        try {
            document = PodRunInputTests.NewTwoTypeFamily(ui.Application, "Mid cancel single");
            var familyId = document.OwnerFamily.Id.Value();
            var plan = FamilyFoundryBridgeOps.PlanFamilies(applySpec, document).Families.Single();
            var (result, changes) = CancelInsideEdit(ui.Application, cancellation => FamilyFoundryBridgeOps.ApplyWithReceipt(
                "family.apply", applySpec, source, new Dictionary<long, string> { [familyId] = plan.PlanHash }, document, null,
                cancellationToken: cancellation));
            var proof = document.FamilyManager.get_Parameter("Proof");

            Assert.Multiple(() => {
                Assert.That(changes, Is.Not.Empty, "The cancel must land inside the edit: a family document committed a change first.");
                Assert.That(result.Receipts.Single().Success, Is.True);
                Assert.That(result.Diagnostics.Select(d => d.Code), Has.None.EqualTo("Cancelled"));
                Assert.That(Outcome(result.ReceiptPath!), Is.EqualTo("Succeeded"));
                Assert.That(proof, Is.Not.Null);
                Assert.That(document.FamilyManager.Types.Cast<FamilyType>().Select(type => type.AsString(proof)), Is.All.EqualTo("kept"));
            });
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); PodRunInputTests.DeletePod(pod); }
    }

    [Test]
    public void A_cancel_inside_the_first_family_edit_keeps_it_and_never_starts_the_second(UIApplication ui) {
        var (pod, source, applySpec) = PodRunInputTests.NewPod(ApplySpec);
        Document? project = null;
        try {
            project = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
            var first = Load(ui.Application, project, "Mid cancel first");
            var second = Load(ui.Application, project, "Mid cancel second");
            var plans = FamilyFoundryBridgeOps.PlanFamilies(applySpec, project, [first, second]).Families;
            var hashes = plans.ToDictionary(p => p.FamilyId, p => p.PlanHash);
            // Ordered: the first family is edited first, so the cancel lands inside its edit.
            var ordered = new Dictionary<long, string> { [first] = hashes[first], [second] = hashes[second] };
            var (result, changes) = CancelInsideEdit(ui.Application, cancellation => FamilyFoundryBridgeOps.ApplyWithReceipt(
                "families.apply", applySpec, source, ordered, project, null,
                new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false, LoadFamily = true, SaveFamilyToInternalPath = false, SaveFamilyToOutputDir = false },
                cancellationToken: cancellation));

            Assert.Multiple(() => {
                Assert.That(changes, Is.Not.Empty, "The cancel must land inside the first family's edit.");
                Assert.That(result.Receipts.Select(r => (r.FamilyId, r.Success)), Is.EqualTo(new[] { (first, true) }));
                Assert.That(result.Diagnostics.Single(d => d.Code == "Cancelled").Message, Does.Contain($"Not started: {second}"));
                Assert.That(Outcome(result.ReceiptPath!), Is.EqualTo("Cancelled"));
                Assert.That(ProofValues(project, "Mid cancel first"), Is.All.EqualTo("kept"), "Cancelled is not rollback.");
                Assert.That(ProofValues(project, "Mid cancel second"), Is.Null, "The second family never started.");
            });
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); PodRunInputTests.DeletePod(pod); }
    }

    /// <summary>Runs <paramref name="apply" /> and cancels its token on the first committed family-document change it causes.</summary>
    private static (FamilyFoundryApplyData Result, List<string> Changes) CancelInsideEdit(
        Autodesk.Revit.ApplicationServices.Application application, Func<CancellationToken, FamilyFoundryApplyData> apply) {
        using var cancellation = new CancellationTokenSource();
        var changes = new List<string>();
        void OnChanged(object? sender, DocumentChangedEventArgs args) {
            var document = args.GetDocument();
            if (!document.IsFamilyDocument) return;
            changes.Add($"{document.Title}: {string.Join(", ", args.GetTransactionNames())}");
            cancellation.Cancel();
        }
        application.DocumentChanged += OnChanged;
        try { return (apply(cancellation.Token), changes); }
        finally { application.DocumentChanged -= OnChanged; }
    }

    private static long Load(Autodesk.Revit.ApplicationServices.Application application, Document project, string name) {
        var family = PodRunInputTests.NewTwoTypeFamily(application, name);
        try { return family.LoadFamily(project, new DefaultFamilyLoadOptions()).Id.Value(); }
        finally { RevitFamilyFixtureHarness.CloseDocument(family); }
    }

    /// <summary>The Proof value of every type of the named loaded family, or null when it has no Proof parameter.</summary>
    private static List<string>? ProofValues(Document project, string name) {
        var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == name);
        var edit = project.EditFamily(family);
        try {
            var proof = edit.FamilyManager.get_Parameter("Proof");
            return proof is null ? null : edit.FamilyManager.Types.Cast<FamilyType>().Select(type => type.AsString(proof)).ToList();
        } finally { edit.Close(false); }
    }

    private static string Outcome(string receiptPath) => JObject.Parse(File.ReadAllText(receiptPath))["outcome"]!.Value<string>()!;
}
