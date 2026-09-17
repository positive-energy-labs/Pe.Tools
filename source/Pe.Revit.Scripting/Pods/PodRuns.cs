// SHIM: w1-pod-core owns this file
using Newtonsoft.Json;

namespace Pe.Revit.Scripting.Pods;

public sealed record PodReceipt(
    string PodId,
    string MemberPath,
    string MemberSha256,
    string Operation,
    string? PlanHash,
    string Outcome,
    IReadOnlyList<string> Outputs,
    string? Reason = null
);

public static class PodRuns {
    /// <summary>Create `output/&lt;runId&gt;/` in the pod, write the outputs and `receipt.json`, return the receipt path.</summary>
    public static string WriteReceipt(string podFolder, PodReceipt receipt, IEnumerable<(string name, byte[] bytes)> outputs) {
        var runDir = Path.Combine(podFolder, "output", $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}");
        _ = Directory.CreateDirectory(runDir);
        foreach (var (name, bytes) in outputs) {
            var path = Path.Combine(runDir, name);
            _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, bytes);
        }
        var receiptPath = Path.Combine(runDir, "receipt.json");
        File.WriteAllText(receiptPath, JsonConvert.SerializeObject(receipt, Formatting.Indented));
        return receiptPath;
    }
}
