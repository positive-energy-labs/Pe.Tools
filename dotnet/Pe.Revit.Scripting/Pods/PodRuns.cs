using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using System.Text;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Scripting.Pods;

/// <summary>One file a run consumed: its role, owning pod when it has one, logical address, run-relative path, and exact bytes.</summary>
public sealed record PodRunInputFile(string Role, string? Pod, string Address, string File, byte[] Bytes);

/// <summary>
///     One run per apply: `receipt.json` plus its output files in `&lt;state root&gt;\state\Runs\&lt;pod-id&gt;\&lt;run-id&gt;\`.
///     Run output is machine state (ADR 0037 rule 6): a pod may sit in a shared home, so a run writes no byte into it.
/// </summary>
public static class PodRuns {
    // Other processes may have in-flight writes in sibling folders under the shared user state root.
    private const int TemporaryFileStaleAgeHours = 1;

    private static readonly JsonSerializerSettings Json = new() {
        Formatting = Formatting.Indented,
        ContractResolver = new CamelCasePropertyNamesContractResolver()
    };

    private static readonly JsonSerializer Serializer = JsonSerializer.Create(Json);

    /// <summary>
    ///     A new empty run folder for the pod with this manifest id, or for no pod when it is null, for a caller
    ///     that must write its output before the receipt exists. Keyed on the id, never on where the pod sits.
    /// </summary>
    public static string NewRunFolder(string? podId) {
        var staleBefore = DateTime.UtcNow.AddHours(-TemporaryFileStaleAgeHours);
        var runFolder = ProductRuntimeLayout.Current.State.RunPath(podId, RunId());
        _ = Directory.CreateDirectory(runFolder);
        foreach (var folder in Directory.EnumerateDirectories(Path.GetDirectoryName(runFolder)!)) {
            if (string.Equals(folder, runFolder, StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var temporary in Directory.EnumerateFiles(folder, "*.tmp", SearchOption.AllDirectories)) {
                try {
                    if (File.GetLastWriteTimeUtc(temporary) < staleBefore) File.Delete(temporary);
                } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
                    Serilog.Log.Warning(exception, "Could not sweep abandoned run temporary file {Path}", temporary);
                }
            }
        }
        return runFolder;
    }

    /// <summary>
    ///     The native run edge: validates the captured composition, stores the run under the root's pod id, and
    ///     writes the run input before any effect. A failure here throws before the caller acts.
    /// </summary>
    public static (string Run, List<string> Inputs) StartComposedRun(PodComposedSource source, object metadata, string effectiveInput, string? planActionId = null, ScriptPodPreparationService? pods = null) {
        var files = ComposedInput(source, effectiveInput);
        // The run folder no longer needs the pod's folder, but a root pod the host cannot resolve still refuses here.
        if (source.Root.Id is { } pod) _ = (pods ?? new ScriptPodPreparationService()).ResolveFolder(pod);
        string run;
        try { run = NewRunFolder(source.Root.Id); }
        catch (ArgumentException exception) { throw new InvalidDataException(exception.Message, exception); }
        var input = WithReviewBasis(metadata, planActionId);
        input["source"] = JObject.FromObject(new {
            kind = "pod-composition", origin = source.Root.Origin.ToString(), pod = source.Root.Id, path = source.Root.Path, sha256 = source.Root.Sha256
        }, Serializer);
        return (run, WriteInputIn(run, input, files));
    }

    /// <summary>
    ///     The reviewed basis a run names: the host plan action whose journal preparation sealed this input, or,
    ///     for a direct call with no plan, the explicit gap. Never both.
    /// </summary>
    public static JObject WithReviewBasis(object metadata, string? planActionId) {
        var input = metadata as JObject ?? JObject.FromObject(metadata, Serializer);
        if (planActionId is null) {
            input["unavailableEvidence"] = new JArray("reviewed Work revision");
            return input;
        }
        input["plan"] = new JObject { ["actionId"] = planActionId, ["sealedIn"] = "host action journal preparation" };
        input["unavailableEvidence"] = new JArray();
        return input;
    }

    /// <summary>The exact effective input, then the root, then each dependency in consumed order; every hash is checked against its bytes.</summary>
    public static List<PodRunInputFile> ComposedInput(PodComposedSource source, string effectiveInput) {
        var root = source.Root;
        if (root.Origin == PodRunOrigin.SavedMember && root.Id is null)
            throw new InvalidDataException("A saved composition root requires its pod id.");
        return [
            new("effective", null, "effective-input.json", "effective-input.json", Encoding.UTF8.GetBytes(effectiveInput)),
            new(root.Origin == PodRunOrigin.SavedMember ? "saved-member" : "supplied-draft", root.Id, root.Path,
                $"source/00-{Path.GetFileName(root.Path)}", Decode(root.Id, root.Path, root.Sha256, root.BytesBase64)),
            .. source.Dependencies.Select((dependency, index) => new PodRunInputFile("dependency", dependency.Id, dependency.Path,
                $"source/{index + 1:D2}-{Path.GetFileName(dependency.Path)}", Decode(dependency.Id, dependency.Path, dependency.Sha256, dependency.BytesBase64)))
        ];
    }

    private static byte[] Decode(string? pod, string path, string sha256, string bytesBase64) {
        byte[] bytes;
        try { bytes = Convert.FromBase64String(bytesBase64); }
        catch (FormatException) { throw new InvalidDataException($"{Address(pod, path)} captured bytes are not base64."); }
        return string.Equals(ScriptPodPreparationService.Sha256(bytes), sha256, StringComparison.OrdinalIgnoreCase)
            ? bytes
            : throw new InvalidDataException($"{Address(pod, path)} captured bytes do not match SHA-256 {sha256}.");
    }

    private static string Address(string? pod, string path) => pod is null ? path : $"{pod}:{path}";

    private static string RunId() => $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}";

    /// <summary>
    ///     Writes each consumed file, then `input.json` listing role, address, SHA-256, and run path for each. All or
    ///     nothing: a partial input is deleted before the error returns. Returns the run-relative names written.
    /// </summary>
    public static List<string> WriteInputIn(string runFolder, object metadata, IReadOnlyList<PodRunInputFile> files) {
        var written = new List<string>();
        try {
            foreach (var file in files) {
                var path = Path.Combine(runFolder, file.File.Replace('/', Path.DirectorySeparatorChar));
                _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                StoredFile.WriteAtomic(path, file.Bytes);
                written.Add(file.File);
            }
            var input = JObject.FromObject(metadata, Serializer);
            input["files"] = JArray.FromObject(files.Select(file => new {
                file.Role, file.Pod, file.Address, Sha256 = ScriptPodPreparationService.Sha256(file.Bytes), file.File
            }), Serializer);
            StoredFile.WriteAtomic(Path.Combine(runFolder, "input.json"), Encoding.UTF8.GetBytes(input.ToString(Formatting.Indented)));
            written.Insert(0, "input.json");
            return written;
        } catch {
            foreach (var file in written) File.Delete(Path.Combine(runFolder, file.Replace('/', Path.DirectorySeparatorChar)));
            throw;
        }
    }

    /// <summary>
    ///     The receipt after a native effect. A write failure never erases the known outcome and never implies
    ///     rollback, so the reason returns in place of the path.
    /// </summary>
    public static (string? Path, string? Unsaved) SettleReceiptIn(string runFolder, PodReceipt receipt, IEnumerable<(string name, byte[] bytes)> outputs) {
        try { return (WriteReceiptIn(runFolder, receipt, outputs), null); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException) {
            return (null, $"The native outcome stands, but its run output was not saved: {exception.Message}");
        }
    }

    /// <summary>Writes the outputs and the receipt; returns the receipt's full path. Output names are appended to `receipt.Outputs`.</summary>
    public static string WriteReceipt(string? podId, PodReceipt receipt, IEnumerable<(string name, byte[] bytes)> outputs) =>
        WriteReceiptIn(NewRunFolder(podId), receipt, outputs);

    /// <summary>The same, into a run folder <see cref="NewRunFolder" /> already handed out.</summary>
    public static string WriteReceiptIn(string runFolder, PodReceipt receipt, IEnumerable<(string name, byte[] bytes)> outputs) {
        _ = Directory.CreateDirectory(runFolder);
        var written = new List<string>();
        foreach (var (name, bytes) in outputs) {
            if (string.IsNullOrWhiteSpace(name) || name != Path.GetFileName(name) || string.Equals(name, "receipt.json", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException($"Run output name must be a plain file name other than receipt.json: '{name}'.", nameof(outputs));
            var outputPath = Path.Combine(runFolder, name);
            StoredFile.WriteAtomic(outputPath, bytes);
            written.Add(name);
        }
        var path = Path.Combine(runFolder, "receipt.json");
        StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(receipt with { Outputs = [.. receipt.Outputs, .. written] }, Json)));
        return path;
    }
}
