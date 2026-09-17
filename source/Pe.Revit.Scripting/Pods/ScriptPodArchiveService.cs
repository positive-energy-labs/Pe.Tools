using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Bcl.Compat;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.Scripting.Pods;

/// <summary>
///     Archive transport. Export vendors every consumed foreign fragment under `settings/_vendor/&lt;id&gt;/` and
///     rewrites its reference to `@local/_vendor/&lt;id&gt;/...`, so a published pod composes from its own bytes.
///     Import extracts bytes unchanged and writes one non-semantic `imported.json`.
/// </summary>
public sealed class ScriptPodArchiveService(
    ScriptWorkspaceBootstrapService bootstrapService,
    ScriptProjectGenerator projectGenerator,
    ScriptPodPreparationService pods
) {
    public const string VendorDirectory = "_vendor";
    private const int MaxArchiveEntryCount = 200;
    private const long MaxArchiveEntryBytes = 512 * 1024;
    private const long MaxArchiveTotalBytes = 4 * 1024 * 1024;

    public PodImportData Import(PodImportRequest request, string revitVersion, string targetFramework, string runtimeAssemblyPath) {
        var archivePath = Path.GetFullPath(request.ArchivePath);
        if (!archivePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || !File.Exists(archivePath))
            throw new InvalidDataException($"Pod archive must be an existing .zip file: {archivePath}");

        using var archive = ZipFile.OpenRead(archivePath);
        var entries = ReadEntries(archive);
        if (!entries.TryGetValue("pod.json", out var manifestBytes))
            throw new InvalidDataException("Pod archive must contain pod.json at the archive root.");
        var manifest = PodManifestValidator.ValidateJson(Encoding.UTF8.GetString(manifestBytes));
        if (manifest.Manifest is null || !manifest.Success)
            throw new InvalidDataException("Pod archive has an invalid pod.json: " + string.Join("; ", manifest.Diagnostics.Select(diagnostic => diagnostic.Message)));

        var folderName = Pe.Shared.Product.ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.Folder ?? manifest.Manifest.Id);
        var folder = Path.Combine(pods.PodsRoot, folderName);
        if (Directory.Exists(folder))
            throw new InvalidDataException($"Pod folder already exists: {folder}");

        var staging = folder + ".importing-" + Guid.NewGuid().ToString("N");
        try {
            foreach (var entry in entries) {
                var path = ScriptPodPreparationService.FullPath(staging, entry.Key);
                _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllBytes(path, entry.Value);
            }
            File.WriteAllText(Path.Combine(staging, ScriptPodPreparationService.ImportedFileName), new JObject {
                ["archiveSha256"] = Sha256File(archivePath),
                ["locator"] = archivePath,
                ["date"] = DateTimeOffset.UtcNow.ToString("O")
            }.ToString(Formatting.Indented) + "\n");
            Directory.Move(staging, folder);
        } finally {
            if (Directory.Exists(staging))
                Directory.Delete(staging, true);
        }

        if (manifest.Manifest.Entrypoints.Count > 0)
            _ = bootstrapService.Bootstrap(folderName, createSampleScript: false, revitVersion, targetFramework, runtimeAssemblyPath, preserveProject: true);
        return new PodImportData(manifest.Manifest.Id, folder);
    }

    public PodExportData Export(PodExportRequest request, string targetFramework) {
        var archivePath = Path.GetFullPath(request.ArchivePath);
        if (!archivePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"Pod export archive path must end in .zip: {archivePath}");
        var folder = pods.ResolveFolder(request.Pod);
        var diagnostics = new List<ScriptDiagnostic>();
        var files = ScriptPodPreparationService.Capture(folder, diagnostics);
        var preparation = ScriptPodPreparationService.Prepare(folder);
        if (!preparation.Success)
            throw new InvalidDataException($"Pod '{request.Pod}' is not exportable: " + string.Join("; ", preparation.Diagnostics
                .Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error)
                .Select(diagnostic => $"{diagnostic.Source}: {diagnostic.Message}")));

        _ = files.Remove(ScriptPodPreparationService.ImportedFileName);
        if (files.TryGetValue("PeScripts.csproj", out var project))
            files["PeScripts.csproj"] = Encoding.UTF8.GetBytes(projectGenerator.GeneratePortableProjectContent(Encoding.UTF8.GetString(project), folder, targetFramework));
        var vendored = this.Vendor(request.Pod, files);
        if (files.Count > MaxArchiveEntryCount || files.Values.Sum(bytes => bytes.LongLength) > MaxArchiveTotalBytes)
            throw new InvalidDataException($"Pod export exceeds {MaxArchiveEntryCount} entries or {MaxArchiveTotalBytes} bytes.");

        _ = Directory.CreateDirectory(Path.GetDirectoryName(archivePath)!);
        var temp = archivePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var archive = ZipFile.Open(temp, ZipArchiveMode.Create))
                foreach (var file in files.OrderBy(pair => pair.Key, StringComparer.Ordinal)) {
                    using var output = archive.CreateEntry(file.Key, CompressionLevel.Optimal).Open();
                    output.Write(file.Value, 0, file.Value.Length);
                }
            if (File.Exists(archivePath))
                File.Replace(temp, archivePath, null);
            else
                File.Move(temp, archivePath);
        } finally {
            if (File.Exists(temp))
                File.Delete(temp);
        }
        return new PodExportData(archivePath, vendored);
    }

    /// <summary>
    ///     Rewrites foreign references in `files` to `@local/_vendor/&lt;id&gt;/...` and adds each consumed fragment,
    ///     transitively. A vendored fragment is byte-identical unless it carries references of its own.
    /// </summary>
    private List<PodDependencyData> Vendor(string podId, Dictionary<string, byte[]> files) {
        var vendored = new List<PodDependencyData>();
        var pending = new Queue<(string OwnerId, string Path)>();
        foreach (var path in files.Keys.Where(IsSettingsJson).ToList())
            files[path] = Rewrite(path, files[path], ownerId: null);

        while (pending.Count > 0) {
            var (ownerId, path) = pending.Dequeue();
            var vendorPath = VendorPath(ownerId, path);
            if (files.ContainsKey(vendorPath))
                continue;
            var bytes = File.ReadAllBytes(ScriptPodPreparationService.FullPath(pods.ResolveFolder(ownerId), path));
            files[vendorPath] = Rewrite($"@{ownerId}/{path}", bytes, ownerId);
            vendored.Add(new PodDependencyData(ownerId, path, ScriptPodPreparationService.Sha256(bytes)));
        }
        return vendored;

        // ownerId is null for this pod's own members; otherwise the vendored fragment's pod, whose `@local` means itself.
        byte[] Rewrite(string source, byte[] bytes, string? ownerId) {
            JToken root;
            try {
                root = JToken.Parse(Encoding.UTF8.GetString(bytes));
            } catch (JsonException exception) {
                throw new InvalidDataException($"Cannot publish '{source}': it is not valid JSON ({exception.Message}).");
            }
            var changed = false;
            foreach (var reference in PodComposer.DirectiveReferences(root).ToList()) {
                var text = reference.Value<string>()!;
                if (!ScriptPodPreparationService.TryParseReference(text, out var referencedId, out var referencedPath, out var reason))
                    throw new InvalidDataException($"Cannot publish '{source}': {reason}");
                var foreignId = referencedId == "local" ? ownerId : referencedId == podId && ownerId is null ? null : referencedId;
                if (foreignId is null)
                    continue;
                pending.Enqueue((foreignId, referencedPath));
                reference.Value = PodComposer.LocalPrefix + VendorPath(foreignId, referencedPath).Substring("settings/".Length);
                changed = true;
            }
            return changed ? Encoding.UTF8.GetBytes(root.ToString(Formatting.Indented) + "\n") : bytes;
        }
    }

    private static string VendorPath(string podId, string settingsPath) =>
        $"settings/{VendorDirectory}/{podId}/{settingsPath.Substring("settings/".Length)}";

    private static bool IsSettingsJson(string path) =>
        path.StartsWith("settings/", StringComparison.OrdinalIgnoreCase) && path.EndsWith(".json", StringComparison.OrdinalIgnoreCase);

    private static Dictionary<string, byte[]> ReadEntries(ZipArchive archive) {
        var entries = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        var total = 0L;
        foreach (var entry in archive.Entries) {
            if (entry.FullName.EndsWith("/", StringComparison.Ordinal))
                continue;
            var path = ScriptPodPreparationService.NormalizeMemberPath(entry.FullName);
            if (path == ScriptPodPreparationService.ImportedFileName)
                throw new InvalidDataException($"Pod archives never carry {ScriptPodPreparationService.ImportedFileName}.");
            if (entry.Length > MaxArchiveEntryBytes || (total += entry.Length) > MaxArchiveTotalBytes || entries.Count >= MaxArchiveEntryCount)
                throw new InvalidDataException($"Pod archive exceeds {MaxArchiveEntryCount} entries, {MaxArchiveEntryBytes} bytes per entry, or {MaxArchiveTotalBytes} bytes total.");
            using var input = entry.Open();
            using var buffer = new MemoryStream();
            input.CopyTo(buffer);
            if (!entries.TryAdd(path, buffer.ToArray()))
                throw new InvalidDataException($"Pod archive contains duplicate entry path: {path}");
        }
        return entries;
    }

    private static string Sha256File(string path) {
        using var sha = SHA256.Create();
        using var stream = File.OpenRead(path);
        return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", string.Empty).ToLowerInvariant();
    }
}
