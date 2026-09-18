using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodRunInputTests {
    [Test]
    public void Generated_run_samples_keep_exact_input_and_list_it_for_every_outcome() {
        var root = Environment.GetEnvironmentVariable("PE_RUN_INPUT_PROOF_ROOT")
                   ?? Path.Combine(Path.GetTempPath(), "pe-run-input-proof-" + Guid.NewGuid().ToString("N"));
        var exact = "{\r\n  \"select\": []  \r\n}";

        foreach (var outcome in new[] { "Succeeded", "Failed", "Cancelled" }) {
            var run = PodRuns.NewRunFolder(Path.Combine(root, outcome.ToLowerInvariant()));
            var inputs = PodRuns.WriteInputIn(run, new { operation = "families.apply", selectedFamilyIds = Array.Empty<long>() }, exact);
            var receipt = PodRuns.WriteReceiptIn(run, new PodReceipt("proof", "sample.json", "sha", "families.apply", null, outcome, inputs,
                outcome == "Succeeded" ? null : outcome), []);
            var saved = JObject.Parse(File.ReadAllText(receipt));

            Assert.Multiple(() => {
                Assert.That(File.ReadAllBytes(Path.Combine(run, "effective-input.json")), Is.EqualTo(System.Text.Encoding.UTF8.GetBytes(exact)));
                Assert.That(saved["outputs"]!.Values<string>(), Does.Contain("input.json").And.Contain("effective-input.json"));
            });
        }

        TestContext.Out.WriteLine($"[PE_RUN_INPUT_PROOF_DIRECTORY] {root}");
    }

    [Test]
    public void Input_write_failure_stops_the_effect_boundary() {
        var pod = Path.Combine(Path.GetTempPath(), "pe-run-input-refusal-" + Guid.NewGuid().ToString("N"));
        try {
            var run = PodRuns.NewRunFolder(pod);
            _ = PodRuns.WriteInputIn(run, new { operation = "families.apply" }, "{}");
            var effects = 0;

            Assert.Throws<IOException>(() => {
                _ = PodRuns.WriteInputIn(run, new { operation = "families.apply" }, "changed");
                effects++;
            });
            Assert.That(effects, Is.Zero);
        } finally {
            if (Directory.Exists(pod)) Directory.Delete(pod, true);
        }
    }
}
