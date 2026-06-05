using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Pods;
using System.IO.Compression;

namespace Pe.Revit.Scripting.Pods;

public sealed class ScriptPodArchiveService(
    ScriptWorkspaceBootstrapService bootstrapService,
    ScriptProjectGenerator projectGenerator
) {
    private static readonly HashSet<string> ExcludedRootNames = new(StringComparer.OrdinalIgnoreCase) {
        ".git",
        ".vscode",
        ".zed",
        ".editorconfig",
        "bin",
        "obj",
        ProductPathNames.OutputDirectoryName,
        ProductPathNames.InlineScriptsDirectoryName,
        ProductPathNames.StateDirectoryName
    };

    private static readonly HashSet<string> ExcludedExtensions = new(StringComparer.OrdinalIgnoreCase) {
        ".dll",
        ".exe",
        ".pdb"
    };

    private readonly ScriptWorkspaceBootstrapService _bootstrapService = bootstrapService;
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;

    public ScriptPodImportData Import(
        ScriptPodImportRequest request,
        string revitVersion,
        string targetFramework,
        string runtimeAssemblyPath
    ) {
        if (string.IsNullOrWhiteSpace(request.ArchivePath))
            throw new ArgumentException("ArchivePath is required.", nameof(request));

        var archivePath = Path.GetFullPath(request.ArchivePath);
        if (!File.Exists(archivePath))
            throw new FileNotFoundException($"Pod archive does not exist: {archivePath}", archivePath);

        var tempRoot = CreateTempDirectory();
        try {
            using var archive = ZipFile.OpenRead(archivePath);
            var entries = ValidateArchiveEntries(archive, requireManifest: true);
            var manifestEntry = entries.Single(entry => string.Equals(entry.RelativePath, ProductPathNames.PodManifestFileName, StringComparison.Ordinal));
            using var manifestStream = manifestEntry.Entry.Open();
            using var manifestReader = new StreamReader(manifestStream);
            var initialManifest = PodManifestValidator.ValidateJson(manifestReader.ReadToEnd());
            EnsureNoManifestErrors(initialManifest.Diagnostics);

            var workspaceKey = string.IsNullOrWhiteSpace(request.WorkspaceKey)
                ? initialManifest.Manifest!.Id
                : ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.WorkspaceKey);
            var manifestResult = PodManifestValidator.ValidateJson(ReadArchiveEntryText(manifestEntry.Entry), workspaceKey);
            EnsureNoManifestErrors(manifestResult.Diagnostics);
            var manifest = manifestResult.Manifest!;

            var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
            if (Directory.Exists(workspaceRoot))
                throw new IOException($"Workspace '{workspaceKey}' already exists: {workspaceRoot}");

            ExtractEntries(entries, tempRoot);
            ValidateEntrypointFiles(tempRoot, manifest);

            _ = Directory.CreateDirectory(Path.GetDirectoryName(workspaceRoot)!);
            Directory.Move(tempRoot, workspaceRoot);
            tempRoot = string.Empty;

            var bootstrapResult = this._bootstrapService.Bootstrap(
                workspaceKey,
                createSampleScript: false,
                revitVersion,
                targetFramework,
                runtimeAssemblyPath
            );

            return new ScriptPodImportData(
                workspaceKey,
                workspaceRoot,
                archivePath,
                ToSummary(manifest),
                entries.Select(entry => entry.RelativePath).ToList(),
                bootstrapResult.GeneratedFiles,
                manifestResult.Diagnostics.ToList()
            );
        } finally {
            if (!string.IsNullOrWhiteSpace(tempRoot) && Directory.Exists(tempRoot))
                Directory.Delete(tempRoot, true);
        }
    }

    public ScriptPodExportData Export(
        ScriptPodExportRequest request,
        string targetFramework
    ) {
        var workspaceKey = ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.WorkspaceKey);
        if (string.IsNullOrWhiteSpace(request.ArchivePath))
            throw new ArgumentException("ArchivePath is required.", nameof(request));

        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        if (!Directory.Exists(workspaceRoot))
            throw new DirectoryNotFoundException($"Workspace does not exist: {workspaceRoot}");

        var manifestPath = RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey);
        if (!File.Exists(manifestPath))
            throw new FileNotFoundException($"Pod export requires {ProductPathNames.PodManifestFileName}: {manifestPath}", manifestPath);

        var manifestResult = PodManifestValidator.ValidateJson(File.ReadAllText(manifestPath), workspaceKey);
        EnsureNoManifestErrors(manifestResult.Diagnostics);
        var manifest = manifestResult.Manifest!;
        ValidateEntrypointFiles(workspaceRoot, manifest);

        var archivePath = Path.GetFullPath(request.ArchivePath);
        var archiveDirectory = Path.GetDirectoryName(archivePath);
        if (!string.IsNullOrWhiteSpace(archiveDirectory))
            _ = Directory.CreateDirectory(archiveDirectory);
        if (File.Exists(archivePath))
            File.Delete(archivePath);

        var entries = CollectExportEntries(workspaceRoot);
        using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create)) {
            foreach (var entry in entries) {
                var archiveEntry = archive.CreateEntry(entry.RelativePath, CompressionLevel.Optimal);
                using var output = archiveEntry.Open();
                if (string.Equals(entry.RelativePath, ScriptingWorkspaceLayout.ProjectFileName, StringComparison.Ordinal)) {
                    var portableProject = this._projectGenerator.GeneratePortableProjectContent(
                        File.ReadAllText(entry.FullPath),
                        workspaceRoot,
                        targetFramework
                    );
                    using var writer = new StreamWriter(output);
                    writer.Write(portableProject);
                } else {
                    using var input = File.OpenRead(entry.FullPath);
                    input.CopyTo(output);
                }
            }
        }

        return new ScriptPodExportData(
            workspaceKey,
            workspaceRoot,
            archivePath,
            ToSummary(manifest),
            entries.Select(entry => entry.RelativePath).ToList(),
            manifestResult.Diagnostics.ToList()
        );
    }

    private static IReadOnlyList<ArchiveEntry> ValidateArchiveEntries(ZipArchive archive, bool requireManifest) {
        var entries = new List<ArchiveEntry>();
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archive.Entries) {
            var relativePath = NormalizeArchiveEntryPath(entry.FullName);
            if (relativePath is null)
                continue;
            ValidatePortableRelativePath(relativePath);
            if (!seenPaths.Add(relativePath))
                throw new InvalidDataException($"Pod archive contains duplicate entry path: {relativePath}");
            entries.Add(new ArchiveEntry(entry, relativePath));
        }

        if (requireManifest && entries.All(entry => !string.Equals(entry.RelativePath, ProductPathNames.PodManifestFileName, StringComparison.Ordinal)))
            throw new InvalidDataException($"Pod archive must contain {ProductPathNames.PodManifestFileName} at the archive root.");

        return entries
            .OrderBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static void ExtractEntries(IReadOnlyList<ArchiveEntry> entries, string tempRoot) {
        foreach (var entry in entries) {
            var destinationPath = Path.GetFullPath(Path.Combine(
                tempRoot,
                entry.RelativePath.Replace('/', Path.DirectorySeparatorChar)
            ));
            EnsurePathUnderRoot(destinationPath, tempRoot, entry.RelativePath);
            _ = Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            entry.Entry.ExtractToFile(destinationPath, overwrite: false);
        }
    }

    private static IReadOnlyList<FileEntry> CollectExportEntries(string workspaceRoot) {
        var workspaceFullPath = Path.GetFullPath(workspaceRoot);
        return Directory
            .EnumerateFiles(workspaceRoot, "*", SearchOption.AllDirectories)
            .Select(path => new FileEntry(path, Path.GetRelativePath(workspaceFullPath, path).Replace('\\', '/')))
            .Where(entry => !IsExcludedPath(entry.RelativePath))
            .Select(entry => {
                ValidatePortableRelativePath(entry.RelativePath);
                return entry;
            })
            .OrderBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string? NormalizeArchiveEntryPath(string entryName) {
        var normalized = entryName.Replace('\\', '/').Trim();
        if (string.IsNullOrWhiteSpace(normalized) || normalized.EndsWith("/", StringComparison.Ordinal))
            return null;
        return normalized;
    }

    private static void ValidatePortableRelativePath(string relativePath) {
        if (Path.IsPathRooted(relativePath) || relativePath.StartsWith("/", StringComparison.Ordinal) || relativePath.Contains(":", StringComparison.Ordinal))
            throw new InvalidDataException($"Pod archive entry must be relative: {relativePath}");

        var segments = relativePath.Split('/');
        if (segments.Any(segment => string.IsNullOrWhiteSpace(segment) || segment == "." || segment == ".." || segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
            throw new InvalidDataException($"Pod archive entry contains an unsafe path segment: {relativePath}");
        if (IsExcludedPath(relativePath))
            throw new InvalidDataException($"Pod archive entry is not portable and is excluded from Pods v1: {relativePath}");
    }

    private static bool IsExcludedPath(string relativePath) {
        var segments = relativePath.Split('/');
        if (segments.Length == 0)
            return true;
        if (ExcludedRootNames.Contains(segments[0]))
            return true;
        return ExcludedExtensions.Contains(Path.GetExtension(segments[^1]));
    }

    private static void ValidateEntrypointFiles(string workspaceRoot, PodManifest manifest) {
        foreach (var entrypoint in manifest.Entrypoints) {
            var entrypointPath = Path.GetFullPath(Path.Combine(
                workspaceRoot,
                entrypoint.SourcePath.Replace('/', Path.DirectorySeparatorChar)
            ));
            EnsurePathUnderRoot(entrypointPath, workspaceRoot, entrypoint.SourcePath);
            if (!File.Exists(entrypointPath))
                throw new FileNotFoundException($"Pod entrypoint source file does not exist: {entrypoint.SourcePath}", entrypointPath);
        }
    }

    private static void EnsureNoManifestErrors(IReadOnlyList<ScriptDiagnostic> diagnostics) {
        var errors = diagnostics
            .Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error)
            .Select(diagnostic => diagnostic.Message)
            .ToList();
        if (errors.Count != 0)
            throw new InvalidDataException(string.Join(Environment.NewLine, errors));
    }

    private static void EnsurePathUnderRoot(string path, string rootPath, string source) {
        var normalizedRoot = Path.GetFullPath(rootPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var normalizedPath = Path.GetFullPath(path);
        if (!normalizedPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"Pod archive path escapes the workspace root: {source}");
    }

    private static string ReadArchiveEntryText(ZipArchiveEntry entry) {
        using var stream = entry.Open();
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static string CreateTempDirectory() {
        var path = Path.Combine(Path.GetTempPath(), "Pe.Tools", "pods", Guid.NewGuid().ToString("N"));
        _ = Directory.CreateDirectory(path);
        return path;
    }

    private static ScriptPodManifestSummaryData ToSummary(PodManifest manifest) => new(
        manifest.SchemaVersion,
        manifest.Id,
        manifest.Name,
        manifest.Description,
        manifest.Entrypoints
            .Select(entrypoint => new ScriptPodEntrypointData(entrypoint.Id, entrypoint.SourcePath, entrypoint.Name))
            .ToList()
    );

    private sealed record ArchiveEntry(ZipArchiveEntry Entry, string RelativePath);
    private sealed record FileEntry(string FullPath, string RelativePath);
}
