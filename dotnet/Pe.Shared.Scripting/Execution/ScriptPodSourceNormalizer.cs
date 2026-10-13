using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;
using System.Text.RegularExpressions;

namespace Pe.Shared.Scripting.Execution;

public sealed record NormalizedPodSource(ScriptSourceSet SourceSet, PodManifest Manifest, string? ProjectSeed);

/// <summary>Decodes captured authored inputs only. References and explicit script file reads remain runtime inputs.</summary>
public static class ScriptPodSourceNormalizer {
    private const int MaxFiles = ScriptPodSourceBounds.MaxFileCount;
    private const int MaxFileBytes = ScriptPodMemberBounds.MaxFileBytes;

    public static NormalizedPodSource Normalize(ScriptPodSourceBundle bundle, string workspaceKey, string sourcePath) {
        var captured = DecodeFiles(bundle);
        var selected = ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath, "Pod entrypoint");
        if (!captured.TryGetValue("pod.json", out var manifestBytes))
            throw new ArgumentException("Captured Pod lacks pod.json.", PodManifestValidator.DiagnosticStage);
        var manifest = PodManifestValidator.ValidateJson(Text(manifestBytes));
        if (!manifest.Success || manifest.Manifest is null)
            throw new ArgumentException(string.Join("; ", manifest.Diagnostics.Select(d => d.Message)), PodManifestValidator.DiagnosticStage);
        var project = captured.TryGetValue("PeScripts.csproj", out var projectBytes) ? Text(projectBytes) : null;
        var sources = captured.Where(file => file.Key.StartsWith("src/", StringComparison.Ordinal)
            && file.Key.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)).ToList();
        if (sources.Count is < 1 or > MaxFiles)
            throw new ArgumentException($"Pod source requires 1 to {MaxFiles} files.");
        var directories = sources.SelectMany(file => file.Key.Split('/').Select((_, i) => string.Join("/", file.Key.Split('/').Take(i)))).Distinct().Count();
        if (directories > ScriptPodSourceBounds.MaxDirectoryCount) throw new ArgumentException("Pod source exceeds its directory bound.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var files = new List<ScriptSourceFile>();
        var total = 0;
        foreach (var file in sources) {
            var path = ScriptingSourcePath.NormalizeWorkspaceSourcePath(file.Key, "Pod source");
            if (!names.Add(path)) throw new ArgumentException($"Duplicate Pod source: {path}");
            var content = Text(file.Value);
            total += file.Value.Length;
            if (file.Value.Length > ScriptPodSourceBounds.MaxFileBytes || total > ScriptPodSourceBounds.MaxTotalBytes)
                throw new ArgumentException("Pod source exceeds its byte bounds.");
            files.Add(new ScriptSourceFile(path.Substring(4), content));
        }
        if (!names.Contains(selected)) throw new ArgumentException("Captured Pod source lacks the selected entrypoint.");
        return new NormalizedPodSource(new ScriptSourceSet(files, selected.Substring(4)), manifest.Manifest, project);
    }

    /// <summary>Validate the untrusted bundle envelope, never infer filesystem membership here.</summary>
    public static IReadOnlyDictionary<string, byte[]> DecodeFiles(ScriptPodSourceBundle bundle) {
        if (bundle?.Files is null || bundle.Files.Count > ScriptPodMemberBounds.MaxFileCount)
            throw new ArgumentException($"Pod capture requires at most {ScriptPodMemberBounds.MaxFileCount} files.");
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        var directories = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { [""] = "" };
        var total = 0;
        foreach (var file in bundle.Files) {
            if (file is null) throw new ArgumentException("Pod source file cannot be null.");
            var path = ValidateMemberPath(file.Path);
            if (file.BytesBase64 is null || file.BytesBase64.Length > ((MaxFileBytes + 2) / 3) * 4)
                throw new ArgumentException("Captured Pod file exceeds membership bounds.");
            var bytes = Convert.FromBase64String(file.BytesBase64);
            if (bytes.Length > MaxFileBytes || (total += bytes.Length) > ScriptPodMemberBounds.MaxTotalBytes)
                throw new ArgumentException("Captured Pod exceeds its byte bounds.");
            if (files.ContainsKey(path)) throw new ArgumentException($"Duplicate Pod source: {path}");
            files.Add(path, bytes);
            for (var slash = path.IndexOf('/'); slash >= 0; slash = path.IndexOf('/', slash + 1)) {
                var directory = path.Substring(0, slash);
                if (directories.TryGetValue(directory, out var prior) && prior != directory)
                    throw new ArgumentException($"Case-colliding Pod directory: {directory}");
                directories[directory] = directory;
            }
        }
        if (directories.Count > ScriptPodMemberBounds.MaxDirectoryCount)
            throw new ArgumentException("Captured Pod exceeds its directory bound.");
        if (directories.Keys.Any(directory => files.ContainsKey(directory)))
            throw new ArgumentException("Captured Pod path is both file and directory.");
        return files;
    }

    public static string ValidateMemberPath(string path) {
        if (string.IsNullOrEmpty(path) || path.Length > 1024 || path.Normalize() != path
            || path.Any(character => character < 32 || character == 127 || "\\<>:\"|?*%#".Contains(character))
            || path.Split('/').Any(segment => segment is "" or "." or ".." || segment.Trim() != segment || segment.EndsWith(".", StringComparison.Ordinal)
                || Regex.IsMatch(segment, @"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)", RegexOptions.IgnoreCase)))
            throw new ArgumentException($"Invalid captured Pod path: {path}");
        return path;
    }

    private static string Text(byte[] bytes) {
        using var stream = new MemoryStream(bytes, false);
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
