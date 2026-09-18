using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodReceiptTests {
    [Test]
    public void Receipt_survives_artifact_limit_and_identifies_the_member() {
        var pod = Path.Combine(Path.GetTempPath(), "pe-pod-receipt-" + Guid.NewGuid().ToString("N"));
        try {
            var writer = new ScriptArtifactWriter(pod);
            for (var index = 0; index < 100; index++) writer.WriteText($"{index}.txt", "output");
            Assert.Throws<InvalidOperationException>(() => writer.WriteText("overflow.txt", "output"));
            var receipt = writer.WriteReceipt(new PodReceipt(
                "sample", "src/Run.cs", "abc", "scripting.execute", null, "Failed", ["0.txt"], "Validation refused the operation."));
            var saved = JObject.Parse(File.ReadAllText(receipt.FullPath));
            var runFolder = Path.GetDirectoryName(receipt.FullPath)!;

            Assert.Multiple(() => {
                // Camel case, like every other receipt: `/pods` reads them all with one shape.
                Assert.That(saved["memberSha256"]!.Value<string>(), Is.EqualTo("abc"));
                Assert.That(saved["reason"]!.Value<string>(), Does.Contain("Validation refused"));
                Assert.That(receipt.Name, Is.EqualTo("receipt.json"));
                // output/<runId>/receipt.json in the pod, the same shape every apply writes.
                Assert.That(Path.GetFileName(receipt.FullPath), Is.EqualTo("receipt.json"));
                Assert.That(Path.GetDirectoryName(runFolder), Is.EqualTo(Path.Combine(pod, "output")));
                Assert.That(File.Exists(Path.Combine(runFolder, "0.txt")), Is.True);
            });
        } finally {
            if (Directory.Exists(pod)) Directory.Delete(pod, true);
        }
    }

    [Test]
    public void A_script_may_not_write_the_runs_own_receipt() {
        var pod = Path.Combine(Path.GetTempPath(), "pe-pod-receipt-" + Guid.NewGuid().ToString("N"));
        try {
            var writer = new ScriptArtifactWriter(pod);
            foreach (var name in new[] { "receipt.json", "Receipt.json", "nested/receipt.json" }) {
                var exception = Assert.Throws<ArgumentException>(() => writer.WriteText(name, "forged"));
                Assert.That(exception?.ParamName, Is.EqualTo("relativePath"));
            }
        } finally {
            if (Directory.Exists(pod)) Directory.Delete(pod, true);
        }
    }

    [Test]
    public void A_run_that_writes_nothing_leaves_no_folder() {
        var pod = Path.Combine(Path.GetTempPath(), "pe-pod-receipt-" + Guid.NewGuid().ToString("N"));
        _ = new ScriptArtifactWriter(pod);
        Assert.That(Directory.Exists(Path.Combine(pod, "output")), Is.False);
    }

    [Test]
    public void Run_input_cannot_be_rewritten_by_a_receipt_output_or_a_script_artifact() {
        var pod = Path.Combine(Path.GetTempPath(), "pe-pod-input-" + Guid.NewGuid().ToString("N"));
        try {
            var writer = new ScriptArtifactWriter(pod);
            writer.WriteInput(new { operation = "test" }, [new PodRunInputFile("inline-script", null, "inline", "source/00-inline.csx", [1, 2, 3])]);
            var run = Path.GetDirectoryName(writer.WriteReceipt(new PodReceipt("pod", "member", "sha", "test", null, "Failed", [], null)).FullPath)!;

            Assert.Multiple(() => {
                Assert.That(writer.Inputs, Is.EqualTo(new[] { "input.json", "source/00-inline.csx" }));
                Assert.Throws<ArgumentException>(() => writer.WriteText("source/00-inline.csx", "forged"));
                Assert.Throws<IOException>(() => PodRuns.WriteReceiptIn(run,
                    new PodReceipt("pod", "member", "sha", "test", null, "Failed", [], null), [("input.json", [0])]));
                Assert.That(File.ReadAllBytes(Path.Combine(run, "source", "00-inline.csx")), Is.EqualTo(new byte[] { 1, 2, 3 }));
            });
        } finally {
            if (Directory.Exists(pod)) Directory.Delete(pod, true);
        }
    }
}
