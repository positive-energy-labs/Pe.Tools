using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Scripting.Pods;

/// <summary>One run per apply: `output/&lt;runId&gt;/receipt.json` plus its output files, inside the pod the apply came from.</summary>
public static class PodRuns {
    private static readonly JsonSerializerSettings Json = new() {
        Formatting = Formatting.Indented,
        ContractResolver = new CamelCasePropertyNamesContractResolver()
    };

    /// <summary>Writes the outputs and the receipt; returns the receipt's full path. Output names are appended to `receipt.Outputs`.</summary>
    public static string WriteReceipt(string podFolder, PodReceipt receipt, IEnumerable<(string name, byte[] bytes)> outputs) {
        var runId = $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}";
        var runFolder = Path.Combine(podFolder, "output", runId);
        _ = Directory.CreateDirectory(runFolder);
        var written = new List<string>();
        foreach (var (name, bytes) in outputs) {
            if (string.IsNullOrWhiteSpace(name) || name != Path.GetFileName(name) || name == "receipt.json")
                throw new ArgumentException($"Run output name must be a plain file name other than receipt.json: '{name}'.", nameof(outputs));
            File.WriteAllBytes(Path.Combine(runFolder, name), bytes);
            written.Add(name);
        }
        var path = Path.Combine(runFolder, "receipt.json");
        File.WriteAllText(path, JsonConvert.SerializeObject(receipt with { Outputs = [.. receipt.Outputs, .. written] }, Json));
        return path;
    }
}
