using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Bcl.Compat;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Pods;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.Scripting.Pods;

/// <summary>One file in a pod. `Schema` is the member's `$schema` when it parses as a JSON object that declares one.</summary>
public sealed record PodMember(string Path, string Sha256, string? Schema);

/// <summary>A pod gated on manifest structure and entrypoint source only. Members are listed, never validated here.</summary>
public sealed record PodPreparation(
    string Folder,
    PodManifest? Manifest,
    IReadOnlyList<PodMember> Members,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
) {
    public bool Success => this.Manifest is not null && this.Diagnostics.All(diagnostic => diagnostic.Severity != ScriptDiagnosticSeverity.Error);
}

/// <summary>One member composed on request: its composed JSON (null on error), its own diagnostics, and consumed fragments.</summary>
public sealed record PodMemberComposition(
    string? Composed,
    IReadOnlyList<ScriptDiagnostic> Diagnostics,
    IReadOnlyList<PodConsumedDependency> Dependencies
);

/// <summary>
///     Reads pods under the pods root. A pod's folder is an address; its manifest `id` is lineage and
///     `@&lt;id&gt;/...` references resolve by scanning installed manifests. Member SHA-256 is derived, never stored.
/// </summary>
public sealed class ScriptPodPreparationService(string? podsRoot = null) {
    public const string Stage = "pod";
    public const string ImportedFileName = "imported.json";
    private const long MaxFileBytes = 512 * 1024;
    private const long MaxTotalBytes = 4 * 1024 * 1024;
    private const int MaxFileCount = 200;
    private const int MaxDirectoryCount = 256;
    private static readonly string[] RootFiles = ["pod.json", "PeScripts.csproj", ImportedFileName];
    private static readonly string[] MemberDirectories = ["src", "settings", "assets"];

    public string PodsRoot { get; } = podsRoot ?? RevitScriptingStorageLocations.GetDefaultBasePath();

    public IReadOnlyList<PodPreparation> List() => Directory.Exists(this.PodsRoot)
        ? Directory.EnumerateDirectories(this.PodsRoot)
            .Where(folder => File.Exists(Path.Combine(folder, "pod.json")))
            .OrderBy(folder => folder, StringComparer.OrdinalIgnoreCase)
            .Select(Prepare)
            .ToList()
        : [];

    public static PodPreparation Prepare(string folder) {
        var diagnostics = new List<ScriptDiagnostic>();
        var files = Capture(folder, diagnostics);
        return Prepare(folder, files, diagnostics);
    }

    public static PodPreparation Prepare(string folder, ScriptPodSourceBundle bundle) {
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in bundle.Files) {
            var path = NormalizeMemberPath(file.Path);
            var bytes = Convert.FromBase64String(file.BytesBase64);
            if (bytes.LongLength > MaxFileBytes)
                throw new InvalidDataException($"Captured pod file exceeds {MaxFileBytes} bytes: {path}");
            if (!files.TryAdd(path, bytes))
                throw new InvalidDataException($"Captured pod path is duplicated: {path}");
        }
        if (files.Count > MaxFileCount || files.Values.Sum(bytes => bytes.LongLength) > MaxTotalBytes)
            throw new InvalidDataException($"Captured pod exceeds {MaxFileCount} files or {MaxTotalBytes} bytes.");
        return Prepare(folder, files, []);
    }

    private static PodPreparation Prepare(string folder, IReadOnlyDictionary<string, byte[]> files, List<ScriptDiagnostic> diagnostics) {
        var members = files.OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => new PodMember(pair.Key, Sha256(pair.Value), ReadSchema(pair.Key, pair.Value)))
            .ToList();
        if (!files.TryGetValue("pod.json", out var manifestBytes)) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, "Pod has no pod.json.", "pod.json"));
            return new PodPreparation(folder, null, members, diagnostics);
        }
        var manifest = PodManifestValidator.ValidateJson(Encoding.UTF8.GetString(manifestBytes));
        diagnostics.AddRange(manifest.Diagnostics);
        if (manifest.Manifest is null)
            return new PodPreparation(folder, null, members, diagnostics);

        foreach (var entrypoint in manifest.Manifest.Entrypoints) {
            if (!files.TryGetValue(entrypoint.SourcePath, out var source)) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, $"Entrypoint '{entrypoint.Id}' has no source file.", entrypoint.SourcePath));
                continue;
            }
            var types = new Pe.Shared.Scripting.Analysis.ScriptEntryPointResolver("PeScriptContainer")
                .ResolveContainerTypeNames(Encoding.UTF8.GetString(source));
            if (types.Count != 1)
                diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, $"Entrypoint '{entrypoint.Id}' must declare exactly one non-abstract PeScriptContainer; found {types.Count}.", entrypoint.SourcePath));
        }
        return new PodPreparation(folder, manifest.Manifest, members, diagnostics);
    }

    /// <summary>The one installed pod folder whose manifest id matches. Zero or several matches fail and name the folders.</summary>
    public string ResolveFolder(string podId) {
        var matches = Directory.Exists(this.PodsRoot)
            ? Directory.EnumerateDirectories(this.PodsRoot)
                .Where(folder => (File.GetAttributes(folder) & FileAttributes.ReparsePoint) == 0 && ReadId(folder) == podId)
                .OrderBy(folder => folder, StringComparer.OrdinalIgnoreCase)
                .ToList()
            : [];
        return matches.Count switch {
            1 => matches[0],
            0 => throw new InvalidDataException($"No installed pod has id '{podId}' under {this.PodsRoot}."),
            _ => throw new InvalidDataException($"Pod id '{podId}' is ambiguous between folders: {string.Join(", ", matches)}.")
        };

        static string? ReadId(string folder) {
            var path = Path.Combine(folder, "pod.json");
            if (!File.Exists(path) || new FileInfo(path).Length > MaxFileBytes)
                return null;
            try {
                return JObject.Parse(File.ReadAllText(path))["id"]?.Value<string>();
            } catch (JsonException) {
                return null; // ponytail: an unparseable neighbour cannot own an id; pod.list reports it.
            }
        }
    }

    public (string Content, string Sha256) ReadMember(string podId, string path) {
        var bytes = ReadBoundedFile(this.MemberFullPath(podId, path));
        return (Encoding.UTF8.GetString(bytes), Sha256(bytes));
    }

    /// <summary>Creates a new member. Never overwrites: capture always creates.</summary>
    public string WriteMember(string podId, string path, string content) {
        var fullPath = this.MemberFullPath(podId, path);
        var bytes = Encoding.UTF8.GetBytes(content);
        if (bytes.LongLength > MaxFileBytes)
            throw new InvalidDataException($"Member exceeds {MaxFileBytes} bytes: {path}");
        _ = Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        using (var stream = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write))
            stream.Write(bytes, 0, bytes.Length);
        return Sha256(bytes);
    }

    /// <summary>Composes one member from the draft when given, else from disk. Only this member's diagnostics return.</summary>
    public PodMemberComposition Compose(string podId, string path, string? draftContent) {
        var folder = this.ResolveFolder(podId);
        path = NormalizeMemberPath(path);
        var source = draftContent ?? Encoding.UTF8.GetString(ReadBoundedFile(FullPath(folder, path)));
        var result = PodComposer.Compose(path, source, Resolve);
        return new PodMemberComposition(result.Document?.Content, result.Diagnostics, result.Document?.Dependencies ?? []);

        bool Resolve(string reference, out PodConsumedDependency dependency, out string reason) {
            dependency = null!;
            if (!TryParseReference(reference, out var referencedId, out var referencedPath, out reason))
                return false;
            try {
                var owner = referencedId == "local" ? podId : referencedId;
                var ownerFolder = referencedId == "local" ? folder : this.ResolveFolder(referencedId);
                var fullPath = FullPath(ownerFolder, referencedPath);
                if (!File.Exists(fullPath)) {
                    reason = $"Reference '{reference}' names no member '{referencedPath}' in pod '{owner}' ({ownerFolder}).";
                    return false;
                }
                var bytes = ReadBoundedFile(fullPath);
                dependency = new PodConsumedDependency(owner, referencedPath, Sha256(bytes), Encoding.UTF8.GetString(bytes));
                return true;
            } catch (Exception exception) when (exception is InvalidDataException or IOException or UnauthorizedAccessException) {
                reason = $"Reference '{reference}': {exception.Message}";
                return false;
            }
        }
    }

    /// <summary>`@&lt;id&gt;/&lt;path&gt;` names `settings/&lt;path&gt;` in that pod; `.json` is implied when absent.</summary>
    public static bool TryParseReference(string reference, out string podId, out string path, out string reason) {
        podId = string.Empty;
        path = string.Empty;
        reason = string.Empty;
        var separator = reference.IndexOf('/');
        if (reference.Length == 0 || reference[0] != '@' || separator < 2 || separator == reference.Length - 1) {
            reason = $"Directive reference '{reference}' must be '@local/<path>' or '@<pod-id>/<path>'.";
            return false;
        }
        podId = reference.Substring(1, separator - 1);
        var relative = reference.Substring(separator + 1).Replace('\\', '/');
        if ((podId != "local" && !Pe.Shared.Product.ScriptingWorkspaceLayout.IsWorkspaceSlug(podId))
            || relative.StartsWith("/", StringComparison.Ordinal)
            || relative.Split('/').Any(segment => segment is "" or "." or "..")) {
            reason = $"Directive reference '{reference}' is not a safe pod reference.";
            return false;
        }
        path = "settings/" + (relative.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? relative : relative + ".json");
        return true;
    }

    public static string Sha256(byte[] bytes) {
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", string.Empty).ToLowerInvariant();
    }

    public static string NormalizeMemberPath(string path) {
        var relative = (path ?? string.Empty).Replace('\\', '/');
        var inRoot = RootFiles.Contains(relative, StringComparer.OrdinalIgnoreCase)
            || MemberDirectories.Any(directory => relative.StartsWith(directory + "/", StringComparison.OrdinalIgnoreCase));
        if (!inRoot || relative.Split('/').Any(segment => segment is "" or "." or ".." || segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
            throw new InvalidDataException($"'{path}' is not a pod member path (pod.json, PeScripts.csproj, {ImportedFileName}, src/, settings/, assets/).");
        return relative;
    }

    private string MemberFullPath(string podId, string path) => FullPath(this.ResolveFolder(podId), NormalizeMemberPath(path));

    public static string FullPath(string folder, string path) {
        var fullPath = Path.GetFullPath(Path.Combine(folder, path.Replace('/', Path.DirectorySeparatorChar)));
        var root = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"Member path escapes the pod folder: {path}");
        return fullPath;
    }

    private static string? ReadSchema(string path, byte[] bytes) {
        if (!path.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            return null;
        try {
            return JToken.Parse(Encoding.UTF8.GetString(bytes)) is JObject obj && obj["$schema"] is JValue { Type: JTokenType.String } schema
                ? schema.Value<string>()
                : null;
        } catch (JsonException) {
            return null;
        }
    }

    internal static Dictionary<string, byte[]> Capture(string folder, ICollection<ScriptDiagnostic> diagnostics) {
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        if ((File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, "Pod folders cannot be links.", folder));
            return files;
        }
        var total = 0L;
        foreach (var path in MemberFiles(folder, diagnostics)) {
            var relative = BclCompat.GetRelativePath(folder, path).Replace('\\', '/');
            var info = new FileInfo(path);
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, "Pod members cannot be links.", relative));
                continue;
            }
            if (files.Count >= MaxFileCount || info.Length > MaxFileBytes || (total += info.Length) > MaxTotalBytes) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, $"Pod exceeds {MaxFileCount} files, {MaxFileBytes} bytes per file, or {MaxTotalBytes} bytes total.", relative));
                continue;
            }
            files[relative] = ReadBoundedFile(path);
        }
        return files;
    }

    private static IEnumerable<string> MemberFiles(string folder, ICollection<ScriptDiagnostic> diagnostics) {
        foreach (var name in RootFiles) {
            var path = Path.Combine(folder, name);
            if (File.Exists(path))
                yield return path;
        }
        var directoryCount = 1;
        foreach (var name in MemberDirectories) {
            var pending = new Stack<string>();
            var root = Path.Combine(folder, name);
            if (Directory.Exists(root))
                pending.Push(root);
            while (pending.Count > 0) {
                var directory = pending.Pop();
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) {
                    diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, "Pod directories cannot be links.", BclCompat.GetRelativePath(folder, directory).Replace('\\', '/')));
                    continue;
                }
                if (++directoryCount > MaxDirectoryCount) {
                    diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, $"Pod exceeds {MaxDirectoryCount} directories.", name));
                    yield break;
                }
                foreach (var child in Directory.EnumerateDirectories(directory))
                    pending.Push(child);
                foreach (var path in Directory.EnumerateFiles(directory))
                    yield return path;
            }
        }
    }

    private static byte[] ReadBoundedFile(string path) {
        if (new FileInfo(path).Length > MaxFileBytes)
            throw new InvalidDataException($"Pod file exceeds {MaxFileBytes} bytes: {path}");
        return File.ReadAllBytes(path);
    }
}
