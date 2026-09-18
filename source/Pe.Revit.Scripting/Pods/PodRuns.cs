using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Scripting;
using System.Text;

namespace Pe.Revit.Scripting.Pods;

/// <summary>One run per apply: `output/&lt;runId&gt;/receipt.json` plus its output files, inside the pod the apply came from.</summary>
public static class PodRuns {
    private static readonly JsonSerializerSettings Json = new() {
        Formatting = Formatting.Indented,
        ContractResolver = new CamelCasePropertyNamesContractResolver()
    };

    /// <summary>A new empty run folder in the pod, for a caller that must write its output before the receipt exists.</summary>
    public static string NewRunFolder(string podFolder) {
        var runId = $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}";
        var runFolder = Path.Combine(podFolder, "output", runId);
        _ = Directory.CreateDirectory(runFolder);
        return runFolder;
    }

    /// <summary>Writes immutable run metadata and the exact effective JSON bytes before any native effect.</summary>
    public static List<string> WriteInputIn(string runFolder, object metadata, string effectiveInput) {
        _ = Directory.CreateDirectory(runFolder);
        var metadataPath = Path.Combine(runFolder, "input.json");
        var effectivePath = Path.Combine(runFolder, "effective-input.json");
        using (var stream = new FileStream(metadataPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
        using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
            writer.Write(JsonConvert.SerializeObject(metadata, Json));
        try {
            using var stream = new FileStream(effectivePath, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            var bytes = Encoding.UTF8.GetBytes(effectiveInput);
            stream.Write(bytes, 0, bytes.Length);
        } catch {
            File.Delete(metadataPath);
            throw;
        }
        return ["input.json", "effective-input.json"];
    }

    /// <summary>Writes the outputs and the receipt; returns the receipt's full path. Output names are appended to `receipt.Outputs`.</summary>
    public static string WriteReceipt(string podFolder, PodReceipt receipt, IEnumerable<(string name, byte[] bytes)> outputs) =>
        WriteReceiptIn(NewRunFolder(podFolder), receipt, outputs);

    /// <summary>The same, into a run folder <see cref="NewRunFolder" /> already handed out.</summary>
    public static string WriteReceiptIn(string runFolder, PodReceipt receipt, IEnumerable<(string name, byte[] bytes)> outputs) {
        _ = Directory.CreateDirectory(runFolder);
        var written = new List<string>();
        foreach (var (name, bytes) in outputs) {
            if (string.IsNullOrWhiteSpace(name) || name != Path.GetFileName(name) || name == "receipt.json")
                throw new ArgumentException($"Run output name must be a plain file name other than receipt.json: '{name}'.", nameof(outputs));
            var outputPath = Path.Combine(runFolder, name);
            if ((string.Equals(name, "input.json", StringComparison.OrdinalIgnoreCase)
                 || string.Equals(name, "effective-input.json", StringComparison.OrdinalIgnoreCase))
                && File.Exists(outputPath))
                throw new IOException($"Run input '{name}' is immutable.");
            File.WriteAllBytes(outputPath, bytes);
            written.Add(name);
        }
        var path = Path.Combine(runFolder, "receipt.json");
        File.WriteAllText(path, JsonConvert.SerializeObject(receipt with { Outputs = [.. receipt.Outputs, .. written] }, Json));
        return path;
    }
}
