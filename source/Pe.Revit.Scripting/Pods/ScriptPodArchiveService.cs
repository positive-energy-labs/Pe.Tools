using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Pods;
using Pe.Bcl.Compat;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.IO.Compression;
using System.Text;

namespace Pe.Revit.Scripting.Pods;

public sealed class ScriptPodArchiveService(
    ScriptWorkspaceBootstrapService bootstrapService,
    ScriptProjectGenerator projectGenerator,
    Func<string, string>? workspaceRootResolver = null
) {
    private const int MaxArchiveEntryCount = 200;
    private const long MaxArchiveEntryBytes = 512 * 1024;
    private const long MaxArchiveTotalBytes = 4 * 1024 * 1024;

    private readonly ScriptWorkspaceBootstrapService _bootstrapService = bootstrapService;
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;
    private readonly Func<string, string> _workspaceRootResolver = workspaceRootResolver ?? RevitScriptingStorageLocations.ResolveWorkspaceRoot;
    private readonly ScriptPodPreparationService _preparationService = new(workspaceRootResolver);

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
            var release = VerifyRelease(entries);
            var manifestEntry = entries.Single(entry => string.Equals(entry.RelativePath, ProductPathNames.PodManifestFileName, StringComparison.Ordinal));
            var initialManifest = PodManifestValidator.ValidateJson(ReadArchiveEntryText(manifestEntry.Entry));
            if (HasManifestErrors(initialManifest.Diagnostics))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, initialManifest.Diagnostics);
            if (release.PodId != initialManifest.Manifest!.Id || release.Version != initialManifest.Manifest.Version)
                throw new InvalidDataException("release.json identity does not match pod.json.");

            workspaceKey = string.IsNullOrWhiteSpace(request.WorkspaceKey)
                ? initialManifest.Manifest!.Id
                : ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.WorkspaceKey);
            var manifestResult = PodManifestValidator.ValidateJson(ReadArchiveEntryText(manifestEntry.Entry), workspaceKey);
            if (HasManifestErrors(manifestResult.Diagnostics))
                return CreateRejectedImport(archivePath, workspaceKey, archiveEntryPaths, manifestResult.Diagnostics);
            var manifest = manifestResult.Manifest!;

            var workspaceRoot = this._workspaceRootResolver(workspaceKey);
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
                runtimeAssemblyPath,
                preserveProject: true
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
                diagnostics,
                release
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

            workspaceRoot = this._workspaceRootResolver(workspaceKey);
            if (!Directory.Exists(workspaceRoot))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, $"Workspace does not exist: {workspaceRoot}");

            var manifestPath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.PodManifestFileName);
            if (!File.Exists(manifestPath))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, $"Pod export requires {ProductPathNames.PodManifestFileName}: {manifestPath}");

            var manifestResult = PodManifestValidator.ValidateJson(File.ReadAllText(manifestPath), workspaceKey);
            if (HasManifestErrors(manifestResult.Diagnostics))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, manifestResult.Diagnostics);
            var manifest = manifestResult.Manifest!;
            ValidateEntrypointFiles(workspaceRoot, manifest);

            var prepared = this._preparationService.Prepare(workspaceKey);
            if (!prepared.Success)
                return CreateRejectedExport(
                    archivePath,
                    workspaceKey,
                    workspaceRoot,
                    archiveEntryPaths,
                    prepared.Outcomes.Select(ToDiagnostic).ToList()
                );

            archivePath = Path.GetFullPath(request.ArchivePath);
            if (!archivePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                return CreateRejectedExport(archivePath, workspaceKey, workspaceRoot, archiveEntryPaths, $"Pod export archive path must end in .zip: {archivePath}");
            var archiveDirectory = Path.GetDirectoryName(archivePath);
            if (!string.IsNullOrWhiteSpace(archiveDirectory))
                _ = Directory.CreateDirectory(archiveDirectory);

            var entries = BuildReleaseEntries(prepared, workspaceRoot, targetFramework);
            ValidateExportEntryLimits(entries);
            archiveEntryPaths = entries.Select(entry => entry.RelativePath).ToList();
            tempArchivePath = CreateTempArchivePath(archivePath);
            using (var archive = ZipFile.Open(tempArchivePath, ZipArchiveMode.Create)) {
                foreach (var entry in entries) {
                    var archiveEntry = archive.CreateEntry(entry.RelativePath, CompressionLevel.Optimal);
                    using var output = archiveEntry.Open();
                    output.Write(entry.Bytes, 0, entry.Bytes.Length);
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
                diagnostics,
                BuildReleaseData(prepared, entries)
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

    private IReadOnlyList<FileEntry> BuildReleaseEntries(PreparedPod prepared, string workspaceRoot, string targetFramework) {
        var entries = prepared.Files.Values.ToDictionary(
            file => file.Path,
            file => file.Bytes,
            StringComparer.OrdinalIgnoreCase
        );
        if (entries.TryGetValue(ScriptingWorkspaceLayout.ProjectFileName, out var projectBytes))
            entries[ScriptingWorkspaceLayout.ProjectFileName] = Encoding.UTF8.GetBytes(this._projectGenerator.GeneratePortableProjectContent(
                Encoding.UTF8.GetString(projectBytes),
                workspaceRoot,
                targetFramework
            ));
        foreach (var document in prepared.ComposedSettings)
            entries[document.Key] = Encoding.UTF8.GetBytes(document.Value.Content);

        var inspectionRows = new JArray();
        foreach (var dependency in prepared.InspectionDependencies.OrderBy(item => item.PodId, StringComparer.Ordinal).ThenBy(item => item.SourcePath, StringComparer.Ordinal)) {
            var inspectionPath = $"inspection/{dependency.PodId}/{dependency.SourcePath}";
            entries[inspectionPath] = Encoding.UTF8.GetBytes(dependency.SourceContent ?? dependency.Content);
            inspectionRows.Add(new JObject {
                ["podId"] = dependency.PodId,
                ["releaseHash"] = dependency.ReleaseHash,
                ["sourcePath"] = dependency.SourcePath,
                ["inspectionPath"] = inspectionPath
            });
        }
        if (inspectionRows.Count > 0)
            entries["inspection/index.json"] = Encoding.UTF8.GetBytes(inspectionRows.ToString(Formatting.Indented) + Environment.NewLine);

        var releaseHash = ScriptPodPreparationService.ComputeReleaseHash(prepared.Manifest, entries);
        var releaseJson = new JObject {
            ["schemaVersion"] = 1,
            ["podId"] = prepared.Manifest.Id,
            ["version"] = prepared.Manifest.Version,
            ["contentHash"] = releaseHash,
            ["parent"] = prepared.Manifest.Parent is null ? null : JObject.FromObject(new {
                podId = prepared.Manifest.Parent.Id,
                contentHash = prepared.Manifest.Parent.ReleaseHash,
                prepared.Manifest.Parent.Version
            }),
            ["files"] = new JArray(entries.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => new JObject {
                ["path"] = pair.Key,
                ["sha256"] = ScriptPodPreparationService.Sha256(pair.Value)
            }))
        };
        entries["release.json"] = Encoding.UTF8.GetBytes(releaseJson.ToString(Formatting.Indented) + Environment.NewLine);
        return entries.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
            .Select(pair => new FileEntry(pair.Key, pair.Value))
            .ToList();
    }

    private static void ValidateExportEntryLimits(IReadOnlyList<FileEntry> entries) {
        if (entries.Count > MaxArchiveEntryCount)
            throw new InvalidDataException($"Pod export contains {entries.Count} entries; the limit is {MaxArchiveEntryCount}.");

        var totalBytes = 0L;
        foreach (var entry in entries) {
            var length = entry.Bytes.LongLength;
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
        if (!IsAllowedArchivePath(relativePath))
            throw new InvalidDataException($"Pod archive entry is outside the portable pod release selection: {relativePath}");
    }

    private static bool IsAllowedArchivePath(string relativePath) =>
        relativePath is "pod.json" or "release.json" or "PeScripts.csproj"
        || relativePath.StartsWith("src/", StringComparison.OrdinalIgnoreCase)
        || relativePath.StartsWith("settings/", StringComparison.OrdinalIgnoreCase)
        || relativePath.StartsWith("composed/", StringComparison.OrdinalIgnoreCase)
        || relativePath.StartsWith("assets/", StringComparison.OrdinalIgnoreCase)
        || relativePath.StartsWith("inspection/", StringComparison.OrdinalIgnoreCase);

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

    private static byte[] ReadArchiveEntryBytes(ZipArchiveEntry entry) {
        using var input = entry.Open();
        using var output = new MemoryStream();
        input.CopyTo(output);
        return output.ToArray();
    }

    private static ScriptPodReleaseData VerifyRelease(IReadOnlyList<ArchiveEntry> entries) {
        var releaseEntry = entries.SingleOrDefault(entry => string.Equals(entry.RelativePath, "release.json", StringComparison.Ordinal));
        if (releaseEntry is null)
            throw new InvalidDataException("Portable pod archive is missing release.json.");
        var release = JObject.Parse(ReadArchiveEntryText(releaseEntry.Entry));
        if (release["schemaVersion"]?.Value<int>() != 1)
            throw new InvalidDataException("release.json has an unsupported schemaVersion.");
        var podId = release["podId"]?.Value<string>() ?? throw new InvalidDataException("release.json is missing podId.");
        var version = release["version"]?.Value<string>() ?? throw new InvalidDataException("release.json is missing version.");
        var expectedHash = release["contentHash"]?.Value<string>() ?? throw new InvalidDataException("release.json is missing contentHash.");
        var fileRows = release["files"] as JArray ?? throw new InvalidDataException("release.json is missing files.");
        var entryBytes = entries.Where(entry => entry.RelativePath != "release.json")
            .ToDictionary(entry => entry.RelativePath, entry => ReadArchiveEntryBytes(entry.Entry), StringComparer.Ordinal);
        var releasedPaths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in fileRows.OfType<JObject>()) {
            var path = row["path"]?.Value<string>() ?? throw new InvalidDataException("release.json contains a file without path.");
            var expectedFileHash = row["sha256"]?.Value<string>() ?? throw new InvalidDataException($"release.json file '{path}' has no sha256.");
            if (!releasedPaths.Add(path))
                throw new InvalidDataException($"release.json contains duplicate file row '{path}'.");
            if (!entryBytes.TryGetValue(path, out var bytes))
                throw new InvalidDataException($"Portable pod archive is missing hashed file '{path}'.");
            var actualFileHash = ScriptPodPreparationService.Sha256(bytes);
            if (!string.Equals(actualFileHash, expectedFileHash, StringComparison.Ordinal))
                throw new InvalidDataException($"Portable pod archive file '{path}' hash mismatch.");
        }
        if (entryBytes.Count != fileRows.Count)
            throw new InvalidDataException("Portable pod archive contains an unhashed file or duplicate release row.");

        var manifestJson = Encoding.UTF8.GetString(entryBytes["pod.json"]);
        var manifestResult = PodManifestValidator.ValidateJson(manifestJson);
        if (!manifestResult.Success)
            throw new InvalidDataException("Portable pod release contains an invalid pod.json.");
        var actualHash = ScriptPodPreparationService.ComputeReleaseHash(manifestResult.Manifest!, entryBytes);
        if (!string.Equals(actualHash, expectedHash, StringComparison.Ordinal))
            throw new InvalidDataException($"Portable pod release content hash mismatch: expected '{expectedHash}', computed '{actualHash}'.");

        var parent = release["parent"] is JObject parentObject
            ? new ScriptPodReleaseReferenceData(
                parentObject["podId"]?.Value<string>() ?? string.Empty,
                parentObject["contentHash"]?.Value<string>() ?? string.Empty,
                parentObject["version"]?.Value<string>())
            : null;
        return new ScriptPodReleaseData(
            podId,
            version,
            actualHash,
            parent,
            fileRows.OfType<JObject>().Select(row => new ScriptPodFileHashData(row["path"]!.Value<string>()!, row["sha256"]!.Value<string>()!)).ToList(),
            []
        );
    }

    private static ScriptPodReleaseData BuildReleaseData(PreparedPod prepared, IReadOnlyList<FileEntry> entries) {
        var release = JObject.Parse(Encoding.UTF8.GetString(entries.Single(entry => entry.RelativePath == "release.json").Bytes));
        return new ScriptPodReleaseData(
            prepared.Manifest.Id,
            prepared.Manifest.Version,
            release["contentHash"]!.Value<string>()!,
            prepared.Manifest.Parent is null ? null : new ScriptPodReleaseReferenceData(prepared.Manifest.Parent.Id, prepared.Manifest.Parent.ReleaseHash, prepared.Manifest.Parent.Version),
            ((JArray)release["files"]!).OfType<JObject>().Select(row => new ScriptPodFileHashData(row["path"]!.Value<string>()!, row["sha256"]!.Value<string>()!)).ToList(),
            prepared.Outcomes.Select(outcome => new ScriptPodGateOutcomeData(outcome.Code, outcome.Location, outcome.Reason, outcome.Remedy, outcome.Severity)).ToList()
        );
    }

    private static ScriptDiagnostic ToDiagnostic(PodGateOutcome outcome) =>
        new(outcome.Code, outcome.Severity, outcome.Remedy is null ? outcome.Reason : $"{outcome.Reason} Remedy: {outcome.Remedy}", outcome.Location);

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
    private sealed record FileEntry(string RelativePath, byte[] Bytes);
}
