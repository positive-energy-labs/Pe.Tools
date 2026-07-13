using Newtonsoft.Json;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Bcl.Compat;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Scripting.Storage;

public sealed class ScriptArtifactWriter {
    private const int MaxArtifactCount = 100;
    private const long MaxArtifactBytes = 10 * 1024 * 1024;
    private const long MaxTotalArtifactBytes = 50 * 1024 * 1024;

    private readonly List<ScriptArtifactData> _artifacts = [];
    private readonly string _runRoot;
    private long _totalBytes;

    public ScriptArtifactWriter(string executionId, string? runName = null) {
        var safeRunName = SanitizeFileName(string.IsNullOrWhiteSpace(runName) ? executionId : runName!);
        this._runRoot = Path.Combine(
            ProductUserContentLayout.ForCurrentUser().Output.RootPath,
            "scripts",
            safeRunName
        );
    }

    public IReadOnlyList<ScriptArtifactData> Artifacts => this._artifacts;

    public ScriptArtifactData WriteText(string relativePath, string content, string contentType = "text/plain") =>
        this.WriteArtifact(relativePath, content ?? string.Empty, contentType);

    public ScriptArtifactData WriteJson<T>(string relativePath, T value) =>
        this.WriteArtifact(
            EnsureExtension(relativePath, ".json"),
            JsonConvert.SerializeObject(value, Formatting.Indented),
            "application/json"
        );

    public ScriptArtifactData WriteCsv(string relativePath, IEnumerable<string> lines) =>
        this.WriteArtifact(
            EnsureExtension(relativePath, ".csv"),
            string.Join(Environment.NewLine, lines ?? []),
            "text/csv"
        );

    private ScriptArtifactData WriteArtifact(string relativePath, string content, string contentType) {
        if (this._artifacts.Count >= MaxArtifactCount)
            throw new InvalidOperationException($"A script may write at most {MaxArtifactCount} artifacts.");

        var byteCount = System.Text.Encoding.UTF8.GetByteCount(content);
        if (byteCount > MaxArtifactBytes)
            throw new InvalidOperationException("A script artifact may not exceed 10 MiB.");
        if (this._totalBytes + byteCount > MaxTotalArtifactBytes)
            throw new InvalidOperationException("Script artifacts may not exceed 50 MiB total per execution.");

        var fullPath = this.ResolveArtifactPath(relativePath);
        _ = Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        File.WriteAllText(fullPath, content);

        var artifact = new ScriptArtifactData(
            Path.GetFileName(fullPath),
            BclCompat.GetRelativePath(this._runRoot, fullPath).Replace(Path.DirectorySeparatorChar, '/'),
            fullPath,
            contentType,
            new FileInfo(fullPath).Length
        );
        this._artifacts.Add(artifact);
        this._totalBytes += artifact.SizeBytes;
        return artifact;
    }

    private string ResolveArtifactPath(string relativePath) {
        if (Path.IsPathRooted(relativePath ?? string.Empty))
            throw new ArgumentException("Artifact paths must be relative to the script output run directory.", nameof(relativePath));

        var normalized = SettingsPathing.NormalizeRelativePath(relativePath, nameof(relativePath));
        if (string.IsNullOrWhiteSpace(normalized))
            throw new ArgumentException("Artifact relative path is required.", nameof(relativePath));

        var root = Path.GetFullPath(this._runRoot);
        var fullPath = Path.GetFullPath(Path.Combine(root, normalized.Replace('/', Path.DirectorySeparatorChar)));
        EnsurePathUnderRoot(fullPath, root, nameof(relativePath));
        return fullPath;
    }

    private static string EnsureExtension(string relativePath, string extension) =>
        Path.HasExtension(relativePath) ? relativePath : relativePath + extension;

    private static void EnsurePathUnderRoot(string path, string rootPath, string paramName) {
        var normalizedRoot = Path.GetFullPath(rootPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var normalizedPath = Path.GetFullPath(path);
        if (!normalizedPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Artifact path escapes the script output run directory.", paramName);
    }

    private static string SanitizeFileName(string value) {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var chars = value
            .Trim()
            .Select(character => invalid.Contains(character) ? '-' : character)
            .ToArray();
        var sanitized = new string(chars).Trim('-', '.', ' ');
        return string.IsNullOrWhiteSpace(sanitized) ? "run" : sanitized;
    }
}
