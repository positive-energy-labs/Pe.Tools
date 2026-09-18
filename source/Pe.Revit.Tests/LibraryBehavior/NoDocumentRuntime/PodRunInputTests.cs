using Newtonsoft.Json.Linq;
using Pe.App.Host;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodRunInputTests {
    [Test]
    public void Family_apply_retains_real_failed_and_zero_family_cancelled_inputs_and_input_failure_blocks_dispatch(UIApplication ui) {
        const string spec = "{\r\n  \"patch\": { \"parameters\": { \"Proof\": { \"dataType\": \"Text\", \"value\": \"kept\" } } }\r\n}";
        var pods = new ScriptPodPreparationService();
        var podId = "input-proof-" + Guid.NewGuid().ToString("N");
        var pod = Path.Combine(pods.PodsRoot, podId);
        var blockedId = podId + "-blocked";
        var blockedPod = Path.Combine(pods.PodsRoot, blockedId);
        Document? document = null;
        try {
            var source = WritePod(pod, podId, spec);
            var blockedSource = WritePod(blockedPod, blockedId, spec);
            document = FamilyModelBuild.Build(ui.Application, FamilyModelJson.Parse("""
                { "family": { "name": "Input proof", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
                  "types": { "default": {} }, "datums": { "Ref. Level": { "normal": "Z", "isLevel": true } } }
                """).Value!).Document;
            var familyId = document.OwnerFamily.Id.Value();

            var failed = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", spec, source,
                new Dictionary<long, string> { [familyId] = "wrong-plan-hash" }, document, null);
            AssertRun(failed.ReceiptPath!, "Failed", spec);

            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            var cancelResult = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", spec, source,
                new Dictionary<long, string> { [familyId] = "not-read-before-cancellation" }, document, null, cancellationToken: cancelled.Token);
            Assert.That(cancelResult.Receipts, Is.Empty, "Cancellation must occur before the first family effect.");
            AssertRun(cancelResult.ReceiptPath!, "Cancelled", spec);

            var inventory = Inventory(document);
            File.WriteAllText(Path.Combine(blockedPod, "output"), "block run directory creation");
            Assert.Throws<IOException>(() => FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", spec, blockedSource,
                new Dictionary<long, string> { [familyId] = "not-read-before-input" }, document, null));
            Assert.That(Inventory(document), Is.EqualTo(inventory));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (Directory.Exists(pod)) Directory.Delete(pod, true);
            if (Directory.Exists(blockedPod)) Directory.Delete(blockedPod, true);
        }
    }

    private static PodMemberSource WritePod(string folder, string id, string spec) {
        Directory.CreateDirectory(Path.Combine(folder, "settings"));
        File.WriteAllText(Path.Combine(folder, "pod.json"), $$"""{"schemaVersion":2,"id":"{{id}}","name":"Input proof","version":"1"}""");
        var member = Path.Combine(folder, "settings", "input.json");
        File.WriteAllText(member, spec, new UTF8Encoding(false));
        return new PodMemberSource(id, "settings/input.json", ScriptPodPreparationService.Sha256(File.ReadAllBytes(member)));
    }

    private static void AssertRun(string receiptPath, string outcome, string exact) {
        var run = Path.GetDirectoryName(receiptPath)!;
        var receipt = JObject.Parse(File.ReadAllText(receiptPath));
        Assert.Multiple(() => {
            Assert.That(receipt["outcome"]!.Value<string>(), Is.EqualTo(outcome));
            Assert.That(receipt["outputs"]!.Values<string>(), Does.Contain("input.json").And.Contain("effective-input.json"));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "effective-input.json")), Is.EqualTo(Encoding.UTF8.GetBytes(exact)));
        });
        if (Environment.GetEnvironmentVariable("PE_RUN_INPUT_PROOF_ROOT") is { } proofRoot) {
            var destination = Path.Combine(proofRoot, outcome.ToLowerInvariant());
            Directory.CreateDirectory(destination);
            foreach (var path in Directory.EnumerateFiles(run)) File.Copy(path, Path.Combine(destination, Path.GetFileName(path)), true);
        }
    }

    private static string Inventory(Document document) => string.Join("|",
        new FilteredElementCollector(document).WhereElementIsNotElementType().Select(element => element.Id.Value()).OrderBy(id => id));
}
