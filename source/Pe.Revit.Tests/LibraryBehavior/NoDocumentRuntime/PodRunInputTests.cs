using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.App.Host;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Schedules;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodRunInputTests {
    private const string ApplySpec = "{\r\n  \"patch\": { \"parameters\": { \"Proof\": { \"dataType\": \"Text\", \"value\": \"kept\" } } }\r\n}";

    [Test]
    public void Family_apply_success_changes_native_state_and_retains_exact_input(UIApplication ui) {
        var (pod, source) = NewPod(ApplySpec);
        Document? document = null;
        try {
            document = NewTwoTypeFamily(ui.Application, "Input apply success");
            var familyId = document.OwnerFamily.Id.Value();
            var plan = FamilyFoundryBridgeOps.PlanFamilies(ApplySpec, document).Families.Single();
            var result = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", ApplySpec, source,
                new Dictionary<long, string> { [familyId] = plan.PlanHash }, document, null);
            var proof = document.FamilyManager.get_Parameter("Proof");
            Assert.Multiple(() => {
                Assert.That(result.Receipts.Single().Success, Is.True);
                Assert.That(proof, Is.Not.Null);
                Assert.That(document.FamilyManager.Types.Size, Is.EqualTo(2));
                Assert.That(document.FamilyManager.Types.Cast<FamilyType>().Select(type => type.AsString(proof)), Is.All.EqualTo("kept"));
            });
            AssertRun(result.ReceiptPath!, "Succeeded", ApplySpec, "success");
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); DeletePod(pod); }
    }

    [Test]
    public void Family_apply_refusal_cancel_and_input_failure_leave_full_native_state_unchanged(UIApplication ui) {
        var (pod, source) = NewPod(ApplySpec);
        var (blockedPod, blockedSource) = NewPod(ApplySpec);
        Document? document = null;
        try {
            document = NewTwoTypeFamily(ui.Application, "Input apply refusals");
            var familyId = document.OwnerFamily.Id.Value();
            var baseline = FamilyState(document);
            var failed = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", ApplySpec, source,
                new Dictionary<long, string> { [familyId] = "wrong-plan-hash" }, document, null);
            AssertRun(failed.ReceiptPath!, "Failed", ApplySpec, "failure");
            AssertUnchanged(document, baseline);
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            var cancelledResult = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", ApplySpec, source,
                new Dictionary<long, string> { [familyId] = "not-read-before-cancellation" }, document, null, cancellationToken: cancelled.Token);
            Assert.That(cancelledResult.Receipts, Is.Empty);
            AssertRun(cancelledResult.ReceiptPath!, "Cancelled", ApplySpec, "cancelled");
            AssertUnchanged(document, baseline);
            var validPlanHash = FamilyFoundryBridgeOps.PlanFamilies(ApplySpec, document).Families.Single().PlanHash;
            File.WriteAllText(Path.Combine(blockedPod, "output"), "block run directory creation");
            Assert.Throws<IOException>(() => FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", ApplySpec, blockedSource,
                new Dictionary<long, string> { [familyId] = validPlanHash }, document, null));
            AssertUnchanged(document, baseline);
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); DeletePod(pod); DeletePod(blockedPod); }
    }

    [Test]
    public void Family_build_success_retains_exact_input_and_saved_native_value(UIApplication ui) {
        const string spec = "{\r\n  \"family\": { \"name\": \"Input build proof\", \"category\": \"GenericModels\", \"template\": \"Generic Model\", \"placement\": \"OneLevelBased\" },\r\n  \"parameters\": { \"Proof\": { \"dataType\": \"Text\", \"value\": \"built\" } },\r\n  \"types\": { \"A\": {}, \"B\": {} }, \"datums\": { \"Ref. Level\": { \"normal\": \"Z\", \"isLevel\": true } }\r\n}";
        var (pod, source) = NewPod(spec);
        Document? reopened = null;
        try {
            var result = FamilyFoundryBridgeOps.BuildWithReceipt(ui.Application, new FamilyBuildRequest(spec, source));
            reopened = ui.Application.OpenDocumentFile(result.OutputPath);
            var proof = reopened.FamilyManager.get_Parameter("Proof");
            Assert.Multiple(() => {
                Assert.That(result.Converged, Is.True);
                Assert.That(reopened.FamilyManager.Types.Size, Is.EqualTo(2));
                Assert.That(reopened.FamilyManager.Types.Cast<FamilyType>().Select(type => type.AsString(proof)), Is.All.EqualTo("built"));
            });
            AssertRun(result.ReceiptPath, "Succeeded", spec, "build-success");
        } finally { RevitFamilyFixtureHarness.CloseDocument(reopened); DeletePod(pod); }
    }

    [Test]
    public void Schedule_apply_success_creates_native_schedule_and_retains_exact_input(UIApplication ui) {
        const string specJson = "{\r\n  \"name\": \"Input proof schedule\",\r\n  \"categoryName\": \"Generic Models\",\r\n  \"fields\": []\r\n}";
        var (pod, source) = NewPod(specJson);
        Document? document = null;
        try {
            document = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
            var profile = ModuleSettingsStorage<ScheduleProfile>.ReadPrepared(specJson, specJson, "input-proof:settings/input.json");
            var applied = ScheduleBridgeOps.ApplySpec(document, profile, specJson, source);
            var schedule = document.GetElement(new ElementId(applied.Data.ScheduleId)) as ViewSchedule;
            Assert.Multiple(() => {
                Assert.That(schedule, Is.Not.Null);
                Assert.That(schedule!.Name, Is.EqualTo("Input proof schedule"));
                Assert.That(applied.Result.Schedule.Id.Value(), Is.EqualTo(applied.Data.ScheduleId));
            });
            AssertRun(applied.Data.ReceiptPath, "Succeeded", specJson, "schedule-success");
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); DeletePod(pod); }
    }

    private static Document NewTwoTypeFamily(Autodesk.Revit.ApplicationServices.Application application, string name) {
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

    private static (string Folder, PodMemberSource Source) NewPod(string spec) {
        var pods = new ScriptPodPreparationService();
        var id = "input-proof-" + Guid.NewGuid().ToString("N");
        var folder = Path.Combine(pods.PodsRoot, id);
        Directory.CreateDirectory(Path.Combine(folder, "settings"));
        File.WriteAllText(Path.Combine(folder, "pod.json"), $$"""{"schemaVersion":2,"id":"{{id}}","name":"Input proof","version":"1"}""");
        var member = Path.Combine(folder, "settings", "input.json");
        File.WriteAllText(member, spec, new UTF8Encoding(false));
        return (folder, new PodMemberSource(id, "settings/input.json", ScriptPodPreparationService.Sha256(File.ReadAllBytes(member))));
    }

    private static void AssertRun(string receiptPath, string outcome, string exact, string sample) {
        var run = Path.GetDirectoryName(receiptPath)!;
        var receipt = JObject.Parse(File.ReadAllText(receiptPath));
        var metadata = JObject.Parse(File.ReadAllText(Path.Combine(run, "input.json")));
        Assert.Multiple(() => {
            Assert.That(receipt["outcome"]!.Value<string>(), Is.EqualTo(outcome));
            Assert.That(receipt["outputs"]!.Values<string>(), Does.Contain("input.json").And.Contain("effective-input.json"));
            Assert.That(metadata["operation"]?.Value<string>(), Is.Not.Empty);
            Assert.That(metadata["source"]?["pod"]?.Value<string>(), Is.Not.Empty);
            Assert.That(metadata["target"]?["process"]?["processId"]?.Value<int>(), Is.GreaterThan(0));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "effective-input.json")), Is.EqualTo(Encoding.UTF8.GetBytes(exact)));
        });
        if (Environment.GetEnvironmentVariable("PE_RUN_INPUT_PROOF_ROOT") is { } root) {
            var destination = Path.Combine(root, sample);
            Directory.CreateDirectory(destination);
            foreach (var path in Directory.EnumerateFiles(run)) File.Copy(path, Path.Combine(destination, Path.GetFileName(path)), true);
        }
    }

    private static void DeletePod(string pod) { if (Directory.Exists(pod)) Directory.Delete(pod, true); }
}
