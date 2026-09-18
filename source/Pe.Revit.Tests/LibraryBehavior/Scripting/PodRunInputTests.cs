using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.App.Host;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Operations;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodRunInputTests {
    private const string ApplySpec = "{\r\n  \"patch\": { \"parameters\": { \"Proof\": { \"dataType\": \"Text\", \"value\": \"kept\" } } }\r\n}";

    [Test]
    public void Family_apply_success_changes_native_state_and_retains_exact_input(UIApplication ui) {
        var (pod, source, applySpec) = NewPod(ApplySpec);
        Document? document = null;
        try {
            document = NewTwoTypeFamily(ui.Application, "Input apply success");
            var familyId = document.OwnerFamily.Id.Value();
            var plan = FamilyFoundryBridgeOps.PlanFamilies(applySpec, document).Families.Single();
            var result = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", applySpec, source,
                new Dictionary<long, string> { [familyId] = plan.PlanHash }, document, null, plan: "plan-action-proof");
            var proof = document.FamilyManager.get_Parameter("Proof");
            Assert.Multiple(() => {
                Assert.That(result.Receipts.Single().Success, Is.True);
                Assert.That(proof, Is.Not.Null);
                Assert.That(document.FamilyManager.Types.Size, Is.EqualTo(2));
                Assert.That(document.FamilyManager.Types.Cast<FamilyType>().Select(type => type.AsString(proof)), Is.All.EqualTo("kept"));
            });
            AssertRun(result.ReceiptPath!, "Succeeded", applySpec, "success", "plan-action-proof");
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); DeletePod(pod); }
    }

    [Test]
    public void Family_apply_refusal_cancel_and_input_failure_leave_full_native_state_unchanged(UIApplication ui) {
        var (pod, source, applySpec) = NewPod(ApplySpec);
        var (blockedPod, blockedSource, _) = NewPod(ApplySpec);
        Document? document = null;
        try {
            document = NewTwoTypeFamily(ui.Application, "Input apply refusals");
            var familyId = document.OwnerFamily.Id.Value();
            var baseline = FamilyState(document);
            var failed = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", applySpec, source,
                new Dictionary<long, string> { [familyId] = "wrong-plan-hash" }, document, null);
            AssertRun(failed.ReceiptPath!, "Failed", applySpec, "failure");
            AssertUnchanged(document, baseline);
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            var cancelledResult = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", applySpec, source,
                new Dictionary<long, string> { [familyId] = "not-read-before-cancellation" }, document, null, cancellationToken: cancelled.Token);
            Assert.That(cancelledResult.Receipts, Is.Empty);
            AssertRun(cancelledResult.ReceiptPath!, "Cancelled", applySpec, "cancelled");
            AssertUnchanged(document, baseline);
            var validPlanHash = FamilyFoundryBridgeOps.PlanFamilies(applySpec, document).Families.Single().PlanHash;
            File.WriteAllText(Path.Combine(blockedPod, "output"), "block run directory creation");
            Assert.Throws<IOException>(() => FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", applySpec, blockedSource,
                new Dictionary<long, string> { [familyId] = validPlanHash }, document, null));
            AssertUnchanged(document, baseline);
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); DeletePod(pod); DeletePod(blockedPod); }
    }

    [Test]
    public void Family_build_success_retains_exact_input_and_saved_native_value(UIApplication ui) {
        const string spec = "{\r\n  \"family\": { \"name\": \"Input build proof\", \"category\": \"GenericModels\", \"template\": \"Generic Model\", \"placement\": \"OneLevelBased\" },\r\n  \"parameters\": { \"Proof\": { \"dataType\": \"Text\", \"value\": \"built\" } },\r\n  \"types\": { \"A\": {}, \"B\": {} }, \"datums\": { \"Ref. Level\": { \"normal\": \"Z\", \"isLevel\": true } }\r\n}";
        var (pod, source, composed) = NewPod(spec);
        Document? reopened = null;
        try {
            var result = FamilyFoundryBridgeOps.BuildWithReceipt(ui.Application, new FamilyBuildRequest(composed, source));
            reopened = ui.Application.OpenDocumentFile(result.OutputPath);
            var proof = reopened.FamilyManager.get_Parameter("Proof");
            Assert.Multiple(() => {
                Assert.That(result.Converged, Is.True);
                Assert.That(reopened.FamilyManager.Types.Size, Is.EqualTo(2));
                Assert.That(reopened.FamilyManager.Types.Cast<FamilyType>().Select(type => type.AsString(proof)), Is.All.EqualTo("built"));
            });
            AssertRun(result.ReceiptPath!, "Succeeded", composed, "build-success");
        } finally { RevitFamilyFixtureHarness.CloseDocument(reopened); DeletePod(pod); }
    }

    [Test]
    public void Schedule_apply_success_creates_native_schedule_and_retains_exact_input(UIApplication ui) {
        const string specJson = "{\r\n  \"Name\": \"Input proof schedule\",\r\n  \"CategoryName\": \"Generic Models\",\r\n  \"Fields\": []\r\n}";
        var (pod, source, composed) = NewPod(specJson);
        Document? document = null;
        try {
            document = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
            var applied = ScheduleBridgeOps.ApplySpec(document, composed, source);
            var schedule = document.GetElement(new ElementId(applied.Data.ScheduleId)) as ViewSchedule;
            Assert.Multiple(() => {
                Assert.That(schedule, Is.Not.Null);
                Assert.That(schedule!.Name, Is.EqualTo("Input proof schedule"));
                Assert.That(applied.Result.Schedule.Id.Value(), Is.EqualTo(applied.Data.ScheduleId));
            });
            AssertRun(applied.Data.ReceiptPath!, "Succeeded", composed, "schedule-success");
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); DeletePod(pod); }
    }

    internal static Document NewTwoTypeFamily(Autodesk.Revit.ApplicationServices.Application application, string name) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(application, BuiltInCategory.OST_GenericModel, name);
        using var transaction = new Transaction(document, "Seed input proof");
        transaction.Start();
        var manager = document.FamilyManager;
        var basis = manager.AddParameter("Basis", GroupTypeId.Geometry, SpecTypeId.Length, false);
        var derived = manager.AddParameter("Derived", GroupTypeId.Geometry, SpecTypeId.Length, false);
        foreach (var (typeName, value) in new[] { ("A", 1d), ("B", 2d) }) {
            manager.CurrentType = manager.NewType(typeName);
            manager.Set(basis, value);
        }
        manager.SetFormula(derived, "Basis * 2");
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return document;
    }

    private static string FamilyState(Document document) {
        var manager = document.FamilyManager;
        var parameters = manager.Parameters.Cast<FamilyParameter>().OrderBy(p => p.Definition.Name, StringComparer.Ordinal).ToList();
        var types = manager.Types.Cast<FamilyType>().OrderBy(t => t.Name, StringComparer.Ordinal).ToList();
        return JsonConvert.SerializeObject(new {
            parameterCount = parameters.Count, typeCount = types.Count,
            parameters = parameters.Select(parameter => new {
                name = parameter.Definition.Name, parameter.IsInstance, parameter.Formula,
                values = types.Select(type => new { type = type.Name, value = Value(type, parameter) }).ToList()
            }).ToList()
        });
    }

    private static object? Value(FamilyType type, FamilyParameter parameter) => parameter.StorageType switch {
        StorageType.Double => type.AsDouble(parameter), StorageType.Integer => type.AsInteger(parameter),
        StorageType.String => type.AsString(parameter), StorageType.ElementId => type.AsElementId(parameter)?.Value(), _ => null
    };

    private static void AssertUnchanged(Document document, string baseline) => Assert.Multiple(() => {
        Assert.That(document.FamilyManager.get_Parameter("Proof"), Is.Null);
        Assert.That(FamilyState(document), Is.EqualTo(baseline));
    });

    /// <summary>
    ///     A pod whose member presets its first section from a dependency, so the run must keep the root and the
    ///     dependency bytes. The composed JSON is the effective input every caller passes.
    /// </summary>
    internal static (string Folder, PodComposedSource Source, string Composed) NewPod(string spec) {
        var pods = new ScriptPodPreparationService();
        var id = "input-proof-" + Guid.NewGuid().ToString("N");
        var folder = Path.Combine(pods.PodsRoot, id);
        Directory.CreateDirectory(Path.Combine(folder, "settings"));
        File.WriteAllText(Path.Combine(folder, "pod.json"), $$"""{"schemaVersion":2,"id":"{{id}}","name":"Input proof","version":"1"}""");
        var member = JObject.Parse(spec);
        var first = member.Properties().First();
        first.Remove();
        member.AddFirst(new JProperty("$preset", "@local/base.json"));
        File.WriteAllText(Path.Combine(folder, "settings", "base.json"), new JObject(first) + "  \r\n", new UTF8Encoding(true));
        File.WriteAllText(Path.Combine(folder, "settings", "input.json"), member.ToString(), new UTF8Encoding(false));
        var composition = pods.Compose(id, "settings/input.json", null);
        Assert.That(composition.Composed, Is.Not.Null, string.Join("; ", composition.Diagnostics.Select(d => d.Message)));
        return (folder, composition.ToSource(), composition.Composed!);
    }

    private static void AssertRun(string receiptPath, string outcome, string exact, string sample, string? plan = null) {
        var run = Path.GetDirectoryName(receiptPath)!;
        var receipt = JObject.Parse(File.ReadAllText(receiptPath));
        var metadata = JObject.Parse(File.ReadAllText(Path.Combine(run, "input.json")));
        var pod = Path.GetDirectoryName(Path.GetDirectoryName(run))!;
        Assert.Multiple(() => {
            Assert.That(receipt["outcome"]!.Value<string>(), Is.EqualTo(outcome));
            Assert.That(receipt["outputs"]!.Values<string>(), Is.SupersetOf(new[] { "input.json", "effective-input.json", "source/00-input.json", "source/01-base.json" }));
            Assert.That(metadata["operation"]?.Value<string>(), Is.Not.Empty);
            Assert.That(metadata["source"]?["origin"]?.Value<string>(), Is.EqualTo("SavedMember"));
            Assert.That(receipt["origin"]?.Value<string>(), Is.EqualTo("SavedMember"));
            Assert.That(metadata["plan"]?["actionId"]?.Value<string>(), Is.EqualTo(plan));
            Assert.That(metadata["unavailableEvidence"]!.Values<string>(), plan is null ? Is.EqualTo(new[] { "reviewed Work revision" }) : Is.Empty);
            Assert.That(metadata["target"]?["process"]?["processId"]?.Value<int>(), Is.GreaterThan(0));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "effective-input.json")), Is.EqualTo(Encoding.UTF8.GetBytes(exact)));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "source", "00-input.json")), Is.EqualTo(File.ReadAllBytes(Path.Combine(pod, "settings", "input.json"))));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "source", "01-base.json")), Is.EqualTo(File.ReadAllBytes(Path.Combine(pod, "settings", "base.json"))));
        });
        if (Environment.GetEnvironmentVariable("PE_RUN_INPUT_PROOF_ROOT") is { } root) {
            var destination = Path.Combine(root, sample);
            Directory.CreateDirectory(destination);
            foreach (var path in Directory.EnumerateFiles(run, "*", SearchOption.AllDirectories))
                File.Copy(path, Path.Combine(destination, Path.GetRelativePath(run, path).Replace(Path.DirectorySeparatorChar, '_')), true);
        }
    }

    internal static void DeletePod(string pod) { if (Directory.Exists(pod)) Directory.Delete(pod, true); }
}
