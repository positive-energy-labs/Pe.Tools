using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Pods;
using Pe.Bcl.Compat;
using System.IO.Compression;

namespace Pe.Revit.Scripting.Pods;

public sealed class ScriptPodArchiveService(
    ScriptWorkspaceBootstrapService bootstrapService,
    ScriptProjectGenerator projectGenerator
) {
    private const int MaxArchiveEntryCount = 1000;
    private const long MaxArchiveEntryBytes = 10 * 1024 * 1024;
    private const long MaxArchiveTotalBytes = 50 * 1024 * 1024;

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
        var archivePath = request.ArchivePath ?? string.Empty;
        var workspaceKey = default(string?);
        var archiveEntryPaths = new List<string>();
        var tempRoot = string.Empty;

        try {
            if (string.IsNullOrWhiteSpace(request.ArchivePath))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, "ArchivePath is required.");

            archivePath = Path.GetFullPath(request.ArchivePath);
            if (Directory.Exists(archivePath))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, $"Pod archive path is a directory; pods import from .zip archives only: {archivePath}");
            if (!archivePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, $"Pod archives must be .zip files: {archivePath}");
            if (!File.Exists(archivePath))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, $"Pod archive does not exist: {archivePath}");

            using var archive = ZipFile.OpenRead(archivePath);
            var entries = ValidateArchiveEntries(archive, requireManifest: true);
            archiveEntryPaths = entries.Select(entry => entry.RelativePath).ToList();
            var manifestEntry = entries.Single(entry => string.Equals(entry.RelativePath, ProductPathNames.PodManifestFileName, StringComparison.Ordinal));
            var initialManifest = PodManifestValidator.ValidateJson(ReadArchiveEntryText(manifestEntry.Entry));
            if (HasManifestErrors(initialManifest.Diagnostics))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, initialManifest.Diagnostics);

            workspaceKey = string.IsNullOrWhiteSpace(request.WorkspaceKey)
                ? initialManifest.Manifest!.Id
                : ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.WorkspaceKey);
            var manifestResult = PodManifestValidator.ValidateJson(ReadArchiveEntryText(manifestEntry.Entry), workspaceKey);
            if (HasManifestErrors(manifestResult.Diagnostics))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, manifestResult.Diagnostics);
            var manifest = manifestResult.Manifest!;

            var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
            if (Directory.Exists(workspaceRoot))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, $"Workspace '{workspaceKey}' already exists: {workspaceRoot}");

            tempRoot = CreateTempDirectory();
            ExtractEntries(entries, tempRoot);
            ValidateEntrypointFiles(tempRoot, manifest);

            _ = Directory.CreateDirectory(Path.GetDirectoryName(workspaceRoot)!);
            MoveDirectory(tempRoot, workspaceRoot);
            tempRoot = string.Empty;

            var bootstrapResult = this._bootstrapService.Bootstrap(
                workspaceKey,
                createSampleScript: false,
                revitVersion,
                targetFramework,
                runtimeAssemblyPath
            );
            var diagnostics = manifestResult.Diagnostics.ToList();

            return new ScriptPodImportData(
                ScriptPodTransferStatus.Succeeded,
                workspaceKey,
                workspaceRoot,
                archivePath,
                ToSummary(manifest),
                archiveEntryPaths,
                bootstrapResult.GeneratedFiles,
                diagnostics
            );
        } catch (Exception ex) when (IsExpectedTransferFailure(ex)) {
            return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, ex.Message);
        } finally {
            if (!string.IsNullOrWhiteSpace(tempRoot) && Directory.Exists(tempRoot))
                Directory.Delete(tempRoot, true);
        }
    }

    public ScriptPodExportData Export(
        ScriptPodExportRequest request,
        string targetFramework,
        string? revitVersion = null
    ) {
        var archivePath = request.ArchivePath ?? string.Empty;
        var workspaceKey = default(string?);
        var workspaceRoot = default(string?);
        var archiveEntryPaths = new List<string>();
        var tempArchivePath = default(string?);

        try {
            workspaceKey = ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.WorkspaceKey);
            if (string.IsNullOrWhiteSpace(request.ArchivePath))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, "ArchivePath is required.");

            workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
            if (!Directory.Exists(workspaceRoot))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, $"Workspace does not exist: {workspaceRoot}");

            var manifestPath = RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey);
            if (!File.Exists(manifestPath))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, $"Pod export requires {ProductPathNames.PodManifestFileName}: {manifestPath}");

            var manifestResult = PodManifestValidator.ValidateJson(File.ReadAllText(manifestPath), workspaceKey);
            if (HasManifestErrors(manifestResult.Diagnostics))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, manifestResult.Diagnostics);
            var manifest = manifestResult.Manifest!;
            ValidateEntrypointFiles(workspaceRoot, manifest);

            archivePath = Path.GetFullPath(request.ArchivePath);
            if (!archivePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, $"Pod export archive path must end in .zip: {archivePath}");
            var archiveDirectory = Path.GetDirectoryName(archivePath);
            if (!string.IsNullOrWhiteSpace(archiveDirectory))
                _ = Directory.CreateDirectory(archiveDirectory);

            var entries = CollectExportEntries(workspaceRoot);
            ValidateExportEntryLimits(entries);
            archiveEntryPaths = entries.Select(entry => entry.RelativePath).ToList();
            tempArchivePath = CreateTempArchivePath(archivePath);
            using (var archive = ZipFile.Open(tempArchivePath, ZipArchiveMode.Create)) {
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

            ReplaceArchive(tempArchivePath, archivePath);
            tempArchivePath = null;
            var diagnostics = manifestResult.Diagnostics.ToList();

            return new ScriptPodExportData(
                ScriptPodTransferStatus.Succeeded,
                workspaceKey,
                workspaceRoot,
                archivePath,
                ToSummary(manifest),
                archiveEntryPaths,
                diagnostics
            );
        } catch (Exception ex) when (IsExpectedTransferFailure(ex)) {
            return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, ex.Message);
        } finally {
            if (!string.IsNullOrWhiteSpace(tempArchivePath) && File.Exists(tempArchivePath))
                File.Delete(tempArchivePath);
        }
    }

    private static IReadOnlyList<ArchiveEntry> ValidateArchiveEntries(ZipArchive archive, bool requireManifest) {
        var entries = new List<ArchiveEntry>();
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var totalBytes = 0L;
        foreach (var entry in archive.Entries) {
            var relativePath = NormalizeArchiveEntryPath(entry.FullName);
            if (relativePath is null)
                continue;
            ValidatePortableRelativePath(relativePath);
            if (!seenPaths.Add(relativePath))
                throw new InvalidDataException($"Pod archive contains duplicate entry path: {relativePath}");
            if (entry.Length > MaxArchiveEntryBytes)
                throw new InvalidDataException($"Pod archive entry exceeds the {MaxArchiveEntryBytes} byte limit: {relativePath}");
            totalBytes += entry.Length;
            if (totalBytes > MaxArchiveTotalBytes)
                throw new InvalidDataException($"Pod archive exceeds the {MaxArchiveTotalBytes} byte uncompressed size limit.");
            entries.Add(new ArchiveEntry(entry, relativePath));
        }

        if (entries.Count > MaxArchiveEntryCount)
            throw new InvalidDataException($"Pod archive contains {entries.Count} entries; the limit is {MaxArchiveEntryCount}.");

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
            .Select(path => new FileEntry(path, BclCompat.GetRelativePath(workspaceFullPath, path).Replace('\\', '/')))
            .Where(entry => !IsExcludedPath(entry.RelativePath))
            .Select(entry => {
                ValidatePortableRelativePath(entry.RelativePath);
                return entry;
            })
            .OrderBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static void ValidateExportEntryLimits(IReadOnlyList<FileEntry> entries) {
        if (entries.Count > MaxArchiveEntryCount)
            throw new InvalidDataException($"Pod export contains {entries.Count} entries; the limit is {MaxArchiveEntryCount}.");

        var totalBytes = 0L;
        foreach (var entry in entries) {
            var length = new FileInfo(entry.FullPath).Length;
            if (length > MaxArchiveEntryBytes)
                throw new InvalidDataException($"Pod export entry exceeds the {MaxArchiveEntryBytes} byte limit: {entry.RelativePath}");
            totalBytes += length;
            if (totalBytes > MaxArchiveTotalBytes)
                throw new InvalidDataException($"Pod export exceeds the {MaxArchiveTotalBytes} byte uncompressed size limit.");
        }
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

    private static bool HasManifestErrors(IReadOnlyList<ScriptDiagnostic> diagnostics) =>
        diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error);

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

    private static void MoveDirectory(string source, string destination) {
        try {
            Directory.Move(source, destination);
        } catch (IOException) {
            // Directory.Move cannot cross volumes (TEMP and a redirected Documents often differ);
            // fall back to copy + delete.
            CopyDirectory(source, destination);
            Directory.Delete(source, true);
        }
    }

    private static void CopyDirectory(string source, string destination) {
        _ = Directory.CreateDirectory(destination);
        foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
            _ = Directory.CreateDirectory(Path.Combine(destination, BclCompat.GetRelativePath(source, directory)));
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            File.Copy(file, Path.Combine(destination, BclCompat.GetRelativePath(source, file)), overwrite: false);
    }

    private static string CreateTempDirectory() {
        var path = Path.Combine(Path.GetTempPath(), "Pe.Tools", "pods", Guid.NewGuid().ToString("N"));
        _ = Directory.CreateDirectory(path);
        return path;
    }

    private static string CreateTempArchivePath(string archivePath) {
        var directory = Path.GetDirectoryName(archivePath);
        var filename = Path.GetFileName(archivePath);
        return Path.Combine(
            string.IsNullOrWhiteSpace(directory) ? "." : directory,
            $".{filename}.{Guid.NewGuid():N}.tmp"
        );
    }

    private static void ReplaceArchive(string tempArchivePath, string archivePath) {
        if (File.Exists(archivePath)) {
            File.Replace(tempArchivePath, archivePath, null);
            return;
        }

        File.Move(tempArchivePath, archivePath);
    }

    private static bool IsExpectedTransferFailure(Exception ex) =>
        ex is ArgumentException or InvalidDataException or IOException or UnauthorizedAccessException or System.Xml.XmlException;

    private static ScriptPodImportData CreateRejectedImport(
        string archivePath,
        string? workspaceKey,
        IReadOnlyList<string> archiveEntries,
        string message
    ) => CreateRejectedImport(
        archivePath,
        workspaceKey,
        archiveEntries,
        [ScriptDiagnosticFactory.Error("pod-import", message)]
    );

    private static ScriptPodImportData CreateRejectedImport(
        string archivePath,
        string? workspaceKey,
        IReadOnlyList<string> archiveEntries,
        IReadOnlyList<ScriptDiagnostic> diagnostics
    ) => new(
        ScriptPodTransferStatus.Rejected,
        workspaceKey,
        workspaceKey is null ? null : RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey),
        archivePath,
        null,
        archiveEntries.ToList(),
        [],
        diagnostics.ToList()
    );

    private static ScriptPodExportData CreateRejectedExport(
        string archivePath,
        string? workspaceKey,
        string? workspaceRoot,
        IReadOnlyList<string> archiveEntries,
        string message
    ) => CreateRejectedExport(
        archivePath,
        workspaceKey,
        workspaceRoot,
        archiveEntries,
        [ScriptDiagnosticFactory.Error("pod-export", message)]
    );

    private static ScriptPodExportData CreateRejectedExport(
        string archivePath,
        string? workspaceKey,
        string? workspaceRoot,
        IReadOnlyList<string> archiveEntries,
        IReadOnlyList<ScriptDiagnostic> diagnostics
    ) => new(
        ScriptPodTransferStatus.Rejected,
        workspaceKey,
        workspaceRoot,
        archivePath,
        null,
        archiveEntries.ToList(),
        diagnostics.ToList()
    );

    internal static ScriptPodManifestSummaryData ToSummary(PodManifest manifest) => new(
        manifest.SchemaVersion,
        manifest.Id,
        manifest.Name,
        manifest.Version,
        manifest.Description,
        manifest.Entrypoints
            .Select(entrypoint => new ScriptPodEntrypointData(
                entrypoint.Id,
                entrypoint.SourcePath,
                entrypoint.Name,
                entrypoint.Description
            ))
            .ToList()
    );

    private sealed record ArchiveEntry(ZipArchiveEntry Entry, string RelativePath);
    private sealed record FileEntry(string FullPath, string RelativePath);
}
