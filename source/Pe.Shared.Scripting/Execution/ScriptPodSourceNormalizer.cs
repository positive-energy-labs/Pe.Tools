using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;

namespace Pe.Shared.Scripting.Execution;

public sealed record NormalizedPodSource(ScriptSourceSet SourceSet, PodManifest Manifest, string? ProjectSeed);

/// <summary>Decodes captured authored inputs only. References and explicit script file reads remain runtime inputs.</summary>
public static class ScriptPodSourceNormalizer {
    public const int MaxFiles = 200;
    public const int MaxFileBytes = 512 * 1024;
    public const int MaxSourceBytes = 2 * 1024 * 1024;

    public static NormalizedPodSource Normalize(ScriptPodSourceBundle bundle, string workspaceKey, string sourcePath) {
        if (bundle?.Files is null || bundle.Dependencies is null)
            throw new ArgumentException("Pod source bundle requires captured files and dependencies.");
        var selected = ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath, "Pod entrypoint");
        var captured = bundle.Files.ToDictionary(file => file.Path.Replace('\\', '/'), StringComparer.OrdinalIgnoreCase);
        if (!captured.TryGetValue("pod.json", out var manifestFile))
            throw new ArgumentException("Captured Pod lacks pod.json.", PodManifestValidator.DiagnosticStage);
        var manifest = PodManifestValidator.ValidateJson(Decode(manifestFile.BytesBase64, out _));
        if (!manifest.Success || manifest.Manifest is null)
            throw new ArgumentException(string.Join("; ", manifest.Diagnostics.Select(d => d.Message)), PodManifestValidator.DiagnosticStage);
        if (!manifest.Manifest.Entrypoints.Any(e => string.Equals(e.SourcePath, selected, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException("pod.json does not declare the requested entrypoint.", PodManifestValidator.DiagnosticStage);
        var project = captured.TryGetValue("PeScripts.csproj", out var projectFile) ? Decode(projectFile.BytesBase64, out _) : null;
        var sources = bundle.Files.Where(file => file.Path.Replace('\\', '/').StartsWith("src/", StringComparison.OrdinalIgnoreCase)).ToList();
        if (sources.Count is < 1 or > MaxFiles)
            throw new ArgumentException($"Pod source requires 1 to {MaxFiles} files.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var files = new List<ScriptSourceFile>();
        var total = 0;
        foreach (var file in sources) {
            if (file is null) throw new ArgumentException("Pod source file cannot be null.");
            if (file.Path is null || file.Path.Length > 1024)
                throw new ArgumentException("Pod source path exceeds 1024 characters.");
            var path = ScriptingSourcePath.NormalizeWorkspaceSourcePath(file.Path, "Pod source");
            if (!names.Add(path)) throw new ArgumentException($"Duplicate Pod source: {path}");
            var content = Decode(file.BytesBase64, out var size);
            total += size;
            if (total > MaxSourceBytes) throw new ArgumentException("Pod source exceeds 2 MiB.");
            files.Add(new ScriptSourceFile(path.Substring(4), content));
        }
        if (!names.Contains(selected)) throw new ArgumentException("Captured Pod source lacks the selected entrypoint.");
        return new NormalizedPodSource(new ScriptSourceSet(files, selected.Substring(4)), manifest.Manifest, project);
    }

    private static string Decode(string encoded, out int size) {
        if (encoded is null || encoded.Length > ((MaxFileBytes + 2) / 3) * 4)
            throw new ArgumentException("Captured Pod file exceeds 512 KiB.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(encoded); }
        catch (FormatException ex) { throw new ArgumentException("Captured Pod file is not Base64.", ex); }
        size = bytes.Length;
        if (size > MaxFileBytes) throw new ArgumentException("Captured Pod file exceeds 512 KiB.");
        // Same BOM detection and default UTF-8 decoding as File.ReadAllText.
        using var stream = new MemoryStream(bytes, false);
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
