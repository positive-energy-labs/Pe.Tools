using Newtonsoft.Json;
using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Scripting;
using Pe.Bcl.Compat;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Scripting.Storage;

public sealed class ScriptArtifactWriter {
    private const int MaxArtifactCount = 100;
    private const long MaxArtifactBytes = 10 * 1024 * 1024;
    private const long MaxTotalArtifactBytes = 50 * 1024 * 1024;

    private readonly List<ScriptArtifactData> _artifacts = [];
    private readonly string _podFolder;
    private string? _resolvedRunRoot;
    private long _totalBytes;

    /// <summary>One run in the pod the script ran from; pod-less runs act from the default pod.</summary>
    public ScriptArtifactWriter(string podFolder) => this._podFolder = string.IsNullOrWhiteSpace(podFolder)
        ? throw new ArgumentException("A run needs the pod folder it acts from.", nameof(podFolder))
        : podFolder;

    public IReadOnlyList<ScriptArtifactData> Artifacts => this._artifacts;

    /// <summary>The run-relative names of the consumed input, written before compilation.</summary>
    public IReadOnlyList<string> Inputs { get; private set; } = [];

    private string RunRoot => this._resolvedRunRoot ??= PodRuns.NewRunFolder(this._podFolder);

    /// <summary>Writes the exact consumed script source before anything compiles or runs; a failure throws before any effect.</summary>
    internal void WriteInput(object metadata, IReadOnlyList<PodRunInputFile> files) =>
        this.Inputs = PodRuns.WriteInputIn(this.RunRoot, metadata, files);

    internal ScriptArtifactData WriteReceipt(PodReceipt receipt) {
        var path = PodRuns.WriteReceiptIn(this.RunRoot, receipt, []);
        return new ScriptArtifactData("receipt.json", "receipt.json", path, "application/json", new FileInfo(path).Length);
    }

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
            BclCompat.GetRelativePath(this.RunRoot, fullPath).Replace(Path.DirectorySeparatorChar, '/'),
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
        // The run owns its receipt; a script must not be able to forge or overwrite one.
        if (string.Equals(Path.GetFileName(normalized), "receipt.json", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("receipt.json is the run's own file; name the artifact something else.", nameof(relativePath));
        if (this.Inputs.Any(input => string.Equals(input, normalized, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException($"{normalized} is the run's consumed input; name the artifact something else.", nameof(relativePath));

        var root = Path.GetFullPath(this.RunRoot);
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
}
