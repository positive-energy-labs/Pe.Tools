using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodReceiptTests {
    private string _podId = null!;
    private string RunsOfPod => Path.Combine(ProductRuntimeLayout.Current.State.RunsPath, this._podId);

    [SetUp]
    public void SetUp() => this._podId = "receipt-" + Guid.NewGuid().ToString("N");

    [TearDown]
    public void TearDown() {
        if (Directory.Exists(this.RunsOfPod)) Directory.Delete(this.RunsOfPod, true);
    }

    [Test]
    public void Receipt_survives_artifact_limit_and_identifies_the_member() {
        var writer = new ScriptArtifactWriter(this._podId);
        for (var index = 0; index < 100; index++) writer.WriteText($"{index}.txt", "output");
        Assert.Throws<InvalidOperationException>(() => writer.WriteText("overflow.txt", "output"));
        var receipt = writer.WriteReceipt(PodReceipt.ForSavedMember("sample", "src/Run.cs", "abc", "scripting.execute", null, PodRunOutcome.Failed, ["0.txt"], "Validation refused the operation."));
        var saved = JObject.Parse(File.ReadAllText(receipt.FullPath));
        var runFolder = Path.GetDirectoryName(receipt.FullPath)!;

        Assert.Multiple(() => {
            // Camel case, like every other receipt: `/pods` reads them all with one shape.
            Assert.That(saved["memberSha256"]!.Value<string>(), Is.EqualTo("abc"));
            Assert.That(saved["reason"]!.Value<string>(), Does.Contain("Validation refused"));
            Assert.That(receipt.Name, Is.EqualTo("receipt.json"));
            // state\Runs\<pod-id>\<run-id>\receipt.json, the same shape every apply writes.
            Assert.That(Path.GetFileName(receipt.FullPath), Is.EqualTo("receipt.json"));
            Assert.That(Path.GetDirectoryName(runFolder), Is.EqualTo(this.RunsOfPod));
            Assert.That(File.Exists(Path.Combine(runFolder, "0.txt")), Is.True);
        });
    }

    [Test]
    public void A_script_may_not_write_the_runs_own_receipt() {
        var writer = new ScriptArtifactWriter(this._podId);
        foreach (var name in new[] { "receipt.json", "Receipt.json", "nested/receipt.json" }) {
            var exception = Assert.Throws<ArgumentException>(() => writer.WriteText(name, "forged"));
            Assert.That(exception?.ParamName, Is.EqualTo("relativePath"));
        }
    }

    [Test]
    public void A_run_that_writes_nothing_leaves_no_folder() {
        _ = new ScriptArtifactWriter(this._podId);
        Assert.That(Directory.Exists(this.RunsOfPod), Is.False);
    }

    // An inline snippet has no pod: its run and receipt land in the pod-less runs, attributed to no pod.
    [Test]
    public void A_pod_less_run_lands_in_the_pod_less_runs() {
        var writer = new ScriptArtifactWriter(null);
        var receipt = writer.WriteReceipt(PodReceipt.ForOperation(null, "scripting.execute", null, PodRunOutcome.Succeeded, [], null));
        var runFolder = Path.GetDirectoryName(receipt.FullPath)!;
        try {
            Assert.That(Path.GetDirectoryName(runFolder), Is.EqualTo(ProductRuntimeLayout.Current.State.PodlessRunsPath));
            Assert.That(JObject.Parse(File.ReadAllText(receipt.FullPath))["podId"]!.Type, Is.EqualTo(JTokenType.Null));
        } finally {
            Directory.Delete(runFolder, true);
        }
    }

    [Test]
    public void Run_input_cannot_be_rewritten_by_a_receipt_output_or_a_script_artifact() {
        var writer = new ScriptArtifactWriter(this._podId);
        writer.WriteInput(new { operation = "test" }, [new PodRunInputFile("inline-script", null, "inline", "source/00-inline.csx", [1, 2, 3])]);
        var run = Path.GetDirectoryName(writer.WriteReceipt(PodReceipt.ForSavedMember("pod", "member", "sha", "test", null, PodRunOutcome.Failed, [], null)).FullPath)!;

        Assert.Multiple(() => {
            Assert.That(writer.Inputs, Is.EqualTo(new[] { "input.json", "source/00-inline.csx" }));
            Assert.Throws<ArgumentException>(() => writer.WriteText("source/00-inline.csx", "forged"));
            Assert.Throws<IOException>(() => PodRuns.WriteReceiptIn(run,
                PodReceipt.ForSavedMember("pod", "member", "sha", "test", null, PodRunOutcome.Failed, [], null), [("input.json", [0])]));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "source", "00-inline.csx")), Is.EqualTo(new byte[] { 1, 2, 3 }));
        });
    }
}
