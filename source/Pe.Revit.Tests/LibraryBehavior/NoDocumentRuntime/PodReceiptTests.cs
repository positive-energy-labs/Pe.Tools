using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodReceiptTests {
    [Test]
    public void Receipt_survives_artifact_limit_and_identifies_the_actual_run() {
        var root = Path.Combine(Path.GetTempPath(), "pe-pod-receipt-" + Guid.NewGuid().ToString("N"));
        try {
            var writer = new ScriptArtifactWriter("run", outputRoot: root);
            for (var index = 0; index < 100; index++) writer.WriteText($"{index}.txt", "output");
            Assert.Throws<InvalidOperationException>(() => writer.WriteText("overflow.txt", "output"));
            var receipt = writer.WriteReceipt(new PodExecutionAttributionData(
                "sample", "1", "snapshot", null, "src/Run.cs", "scripting.execute", "run", "Failed",
                [new ScriptOutputReferenceData("artifact", "0.txt")], [], "Validation refused the operation."));
            var saved = JObject.Parse(File.ReadAllText(receipt.FullPath));
            Assert.That(saved["RunId"]!.Value<string>(), Is.EqualTo("run"));
            Assert.That(saved["Reason"]!.Value<string>(), Does.Contain("Validation refused"));
            Assert.That(receipt.FullPath, Is.EqualTo(Path.Combine(root, "scripts", "run", "pod-receipt.json")));
        } finally {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
