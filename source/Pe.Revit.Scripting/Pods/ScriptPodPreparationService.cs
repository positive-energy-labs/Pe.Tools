using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Bcl.Compat;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.Scripting.Pods;

public sealed record PodGateOutcome(
    string Code,
    string Location,
    string Reason,
    string? Remedy,
    ScriptDiagnosticSeverity Severity = ScriptDiagnosticSeverity.Error
);

public sealed record PreparedPodFile(string Path, byte[] Bytes, string Sha256);

public sealed record PreparedPod(
    PodManifest Manifest,
    string ContentHash,
    IReadOnlyDictionary<string, PreparedPodFile> Files,
    IReadOnlyDictionary<string, PodComposedDocument> ComposedSettings,
    IReadOnlyList<PodConsumedDependency> InspectionDependencies,
    IReadOnlyList<PodGateOutcome> Outcomes
) {
    public bool Success => this.Outcomes.All(outcome => outcome.Severity != ScriptDiagnosticSeverity.Error);
    /// <summary>The verified release hash when this snapshot uses shipped release bytes unchanged; otherwise null.</summary>
    public string? ReleaseHash { get; init; }
}

/// <summary>
///     Captures and prepares one immutable in-memory pod snapshot. Content identity is SHA-256 over
///     sorted `path + NUL + file SHA-256 + LF` rows. The rows contain the manifest's execution
///     semantics plus authored scripts/settings/assets/config and freshly composed settings. They
///     exclude display metadata, origin, ancestry, outputs, inspection copies, and release.json.
/// </summary>
public sealed class ScriptPodPreparationService(
    Func<string, string>? workspaceRootResolver = null
) {
    private const long MaxFileBytes = 512 * 1024;
    private const long MaxTotalBytes = 4 * 1024 * 1024;
    private const int MaxFileCount = 200;
    private const int MaxDirectoryCount = 256;
    private static readonly string[] SettingsSuffixes = [".family.json", ".patch.json", ".schedule.json", ".batch.json", ".settings.json"];
    private readonly Func<string, string> _workspaceRootResolver = workspaceRootResolver ?? RevitScriptingStorageLocations.ResolveWorkspaceRoot;

    public PreparedPod Prepare(string workspaceKey) =>
        this.Prepare(workspaceKey, new Dictionary<string, PreparedPod>(StringComparer.Ordinal), new HashSet<string>(StringComparer.Ordinal));

    public PreparedPod Prepare(string workspaceKey, ScriptPodSourceBundle bundle) {
        var captureRoot = Path.Combine(Path.GetTempPath(), "Pe.Tools", "pod-captures", Guid.NewGuid().ToString("N"));
        _ = Directory.CreateDirectory(captureRoot);
        try {
            WriteCapture(workspaceKey, bundle.Files);
            var dependencyIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var dependency in bundle.Dependencies) {
                if (string.Equals(dependency.Id, workspaceKey, StringComparison.Ordinal))
                    throw new InvalidDataException($"Captured dependency '{dependency.Id}' cannot overwrite the root pod capture.");
                if (!dependencyIds.Add(dependency.Id))
                    throw new InvalidDataException($"Captured pod dependency is duplicated: {dependency.Id}");
                WriteCapture(dependency.Id, dependency.Files);
            }
            return new ScriptPodPreparationService(id => Path.Combine(captureRoot, id)).Prepare(workspaceKey);
        } finally {
            if (Directory.Exists(captureRoot))
                Directory.Delete(captureRoot, true);
        }

        void WriteCapture(string id, IReadOnlyList<ScriptPodSourceFile> files) {
            _ = Pe.Shared.Product.ScriptingWorkspaceLayout.NormalizeWorkspaceKey(id);
            var root = Path.Combine(captureRoot, id);
            _ = Directory.CreateDirectory(root);
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var totalBytes = 0L;
            foreach (var file in files) {
                var relative = file.Path.Replace('\\', '/');
                if (relative.StartsWith("/", StringComparison.Ordinal) || relative.Split('/').Any(segment => segment is "" or "." or ".."))
                    throw new InvalidDataException($"Captured pod path is unsafe: {relative}");
                var path = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
                var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (!path.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"Captured pod path escapes its root: {relative}");
                var bytes = Convert.FromBase64String(file.BytesBase64);
                if (bytes.LongLength > MaxFileBytes)
                    throw new InvalidDataException($"Captured pod file exceeds {MaxFileBytes} bytes: {relative}");
                if (!paths.Add(relative))
                    throw new InvalidDataException($"Captured pod path is duplicated: {relative}");
                if ((totalBytes += bytes.LongLength) > MaxTotalBytes)
                    throw new InvalidDataException($"Captured pod exceeds {MaxTotalBytes} bytes: {id}");
                _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllBytes(path, bytes);
            }
        }
    }

    private PreparedPod Prepare(
        string workspaceKey,
        IDictionary<string, PreparedPod> prepared,
        ISet<string> visiting
    ) {
        if (prepared.TryGetValue(workspaceKey, out var cached))
            return cached;
        if (!visiting.Add(workspaceKey))
            return Failed(workspaceKey, "pod.dependency.cycle", "pod.json", $"Dependency cycle through pod '{workspaceKey}'.", "Remove the cyclic requires entry.");

        try {
            var workspaceRoot = this._workspaceRootResolver(workspaceKey);
            if (Directory.Exists(workspaceRoot) && (File.GetAttributes(workspaceRoot) & FileAttributes.ReparsePoint) != 0)
                return Failed(workspaceKey, "pod.directory.link", workspaceRoot, "Pod roots cannot be linked directories.", "Use a regular local pod folder.");
            var manifestPath = Path.Combine(workspaceRoot, "pod.json");
            if (!File.Exists(manifestPath))
                return Failed(workspaceKey, "pod.manifest.missing", "pod.json", $"Pod '{workspaceKey}' has no pod.json.", "Create pod.json before preparing or executing the pod.");

            var manifestBytes = ReadBoundedFile(manifestPath);
            var manifestResult = PodManifestValidator.ValidateJson(Encoding.UTF8.GetString(manifestBytes));
            if (!manifestResult.Success)
                return new PreparedPod(
                    manifestResult.Manifest ?? EmptyManifest(workspaceKey),
                    string.Empty,
                    new Dictionary<string, PreparedPodFile>(),
                    new Dictionary<string, PodComposedDocument>(),
                    [],
                    manifestResult.Diagnostics.Select(diagnostic => new PodGateOutcome(
                        "pod.manifest.invalid",
                        diagnostic.Source ?? "pod.json",
                        diagnostic.Message,
                        "Correct pod.json and prepare again.",
                        diagnostic.Severity
                    )).ToList()
                );

            var manifest = manifestResult.Manifest!;
            var outcomes = new List<PodGateOutcome> {
                new("pod.manifest.valid", "pod.json", "Manifest structure and lineage identity are valid; the local folder is only an address.", null, ScriptDiagnosticSeverity.Info)
            };
            var files = CaptureFiles(workspaceRoot, outcomes);
            if (!outcomes.Any(outcome => outcome.Severity == ScriptDiagnosticSeverity.Error))
                outcomes.Add(new("pod.capture.valid", workspaceRoot, $"Captured {files.Count} bounded regular files from the portable input roots.", null, ScriptDiagnosticSeverity.Info));
            var released = TryUseVerifiedRelease(manifest, files, outcomes, out var originRelease);
            if (released is not null) {
                prepared[workspaceKey] = released;
                return released;
            }
            var editedRelease = files.ContainsKey("release.json");
            if (originRelease is not null) {
                manifest = manifest with { Parent = originRelease };
                files = files.Where(pair => IsAuthoredPath(pair.Key))
                    .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
            }
            var dependencies = new Dictionary<string, PreparedPod>(StringComparer.Ordinal);
            foreach (var requirement in manifest.Requires) {
                PreparedPod dependency;
                try {
                    var dependencyKey = ResolveDependencyWorkspaceKey(workspaceRoot, requirement);
                    dependency = this.Prepare(dependencyKey, prepared, visiting);
                } catch (InvalidDataException exception) {
                    outcomes.Add(new PodGateOutcome(editedRelease ? "pod.dependency.missing-after-release-edit" : "pod.dependency.resolve", $"pod.json#requires/{requirement.Id}", exception.Message,
                        "Install the exact required release or select an unambiguous local copy."));
                    continue;
                }
                dependencies[requirement.Id] = dependency;
                if (!dependency.Success) {
                    outcomes.Add(new PodGateOutcome(
                        editedRelease ? "pod.dependency.missing-after-release-edit" : "pod.dependency.invalid",
                        $"pod.json#requires/{requirement.Id}",
                        $"Required pod '{requirement.Id}' is not prepared and valid.",
                        $"Prepare or reinstall '{requirement.Id}' and retry."
                    ));
                } else if (!string.Equals(dependency.ContentHash, requirement.ReleaseHash, StringComparison.Ordinal)) {
                    outcomes.Add(new PodGateOutcome(
                        "pod.dependency.hash-mismatch",
                        $"pod.json#requires/{requirement.Id}",
                        $"Required pod '{requirement.Id}' has content hash '{dependency.ContentHash}', not '{requirement.ReleaseHash}'.",
                        "Install the exact required release or update the requirement explicitly."
                    ));
                }
            }

            ValidateEntrypoints(manifest, files, outcomes);
            var composed = new Dictionary<string, PodComposedDocument>(StringComparer.OrdinalIgnoreCase);
            var inspection = new Dictionary<string, PodConsumedDependency>(StringComparer.Ordinal);
            foreach (var file in files.Values.Where(file => file.Path.StartsWith("settings/", StringComparison.OrdinalIgnoreCase))) {
                if (!SettingsSuffixes.Any(suffix => file.Path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))) {
                    outcomes.Add(new PodGateOutcome(
                        "pod.settings.suffix",
                        file.Path,
                        "Settings documents must use a known typed suffix.",
                        $"Rename the file to end in {string.Join(", ", SettingsSuffixes)}."
                    ));
                    continue;
                }

                var result = PodComposer.Compose(file.Path, Encoding.UTF8.GetString(file.Bytes), Resolve);
                foreach (var diagnostic in result.Diagnostics)
                    outcomes.Add(new PodGateOutcome(diagnostic.Stage, diagnostic.Source ?? file.Path, diagnostic.Message, "Correct the directive or referenced document."));
                if (result.Document is null)
                    continue;
                var composedPath = "composed/" + file.Path["settings/".Length..];
                composed[composedPath] = result.Document with { Path = composedPath };
                foreach (var dependency in result.Document.Dependencies)
                    inspection[$"{dependency.PodId}\0{dependency.SourcePath}"] = dependency;

                bool Resolve(string reference, out PodConsumedDependency dependency, out string reason) {
                    dependency = null!;
                    reason = string.Empty;
                    if (!TryParseReference(reference, out var podId, out var relativePath, out reason))
                        return false;
                    if (podId == "local") {
                        var localPath = "settings/" + relativePath;
                        if (!files.TryGetValue(localPath, out var localFile)) {
                            reason = $"Reference '{reference}' does not name an authored settings file in pod '{manifest.Id}'.";
                            return false;
                        }
                        dependency = new PodConsumedDependency(manifest.Id, string.Empty, localPath, Encoding.UTF8.GetString(localFile.Bytes));
                        return true;
                    }
                    if (!manifest.Requires.Any(requirement => requirement.Id == podId)) {
                        reason = $"Reference '{reference}' names undeclared pod '{podId}'.";
                        return false;
                    }
                    if (!dependencies.TryGetValue(podId, out var foreign) || !foreign.Success) {
                        reason = $"Reference '{reference}' requires pod '{podId}', which is not prepared and valid.";
                        return false;
                    }
                    var foreignPath = "composed/" + relativePath;
                    if (!foreign.ComposedSettings.TryGetValue(foreignPath, out var foreignDocument)
                        || !foreign.Files.TryGetValue("settings/" + relativePath, out var foreignSource)) {
                        reason = $"Reference '{reference}' does not name a composed document in release '{foreign.ContentHash}'.";
                        return false;
                    }
                    dependency = new PodConsumedDependency(
                        podId,
                        foreign.ContentHash,
                        "settings/" + relativePath,
                        foreignDocument.Content,
                        Encoding.UTF8.GetString(foreignSource.Bytes),
                        foreignDocument.Dependencies
                    );
                    return true;
                }
            }

            foreach (var requirement in manifest.ExternalRequirements)
                outcomes.Add(new PodGateOutcome(
                    "pod.external.runtime-required",
                    $"pod.json#externalRequirements/{requirement.Code}/{requirement.ResourceId}",
                    $"An operation consuming '{requirement.Code}' resource '{requirement.ResourceId}' must resolve its current authority.",
                    "Connect the owning service. Cached definitions are not a fallback.",
                    ScriptDiagnosticSeverity.Info
                ));

            var hashFiles = new Dictionary<string, byte[]>(StringComparer.Ordinal) {
                ["pod.semantic.json"] = Encoding.UTF8.GetBytes(ManifestSemantics(manifest))
            };
            foreach (var file in files.Values.Where(file => file.Path != "pod.json" && IsAuthoredPath(file.Path)))
                hashFiles[file.Path] = file.Bytes;
            foreach (var document in composed)
                hashFiles[document.Key] = Encoding.UTF8.GetBytes(document.Value.Content);
            var contentHash = ComputeContentHash(hashFiles);

            if (!outcomes.Any(outcome => outcome.Severity == ScriptDiagnosticSeverity.Error))
                outcomes.Add(new("pod.prepared", "pod.json", $"Source composition and entrypoint checks passed for snapshot '{contentHash}'.", null, ScriptDiagnosticSeverity.Info));

            var resultPod = new PreparedPod(manifest, contentHash, files, composed, inspection.Values.ToList(), outcomes);
            prepared[workspaceKey] = resultPod;
            return resultPod;
        } finally {
            _ = visiting.Remove(workspaceKey);
        }
    }

    private static Dictionary<string, PreparedPodFile> CaptureFiles(string workspaceRoot, ICollection<PodGateOutcome> outcomes) {
        var files = new Dictionary<string, PreparedPodFile>(StringComparer.OrdinalIgnoreCase);
        var total = 0L;
        foreach (var path in PositiveFiles(workspaceRoot, outcomes)) {
            var relative = BclCompat.GetRelativePath(workspaceRoot, path).Replace('\\', '/');
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) {
                outcomes.Add(new PodGateOutcome("pod.file.link", relative, "Release inputs cannot be links.", "Replace the link with a regular file."));
                continue;
            }
            var info = new FileInfo(path);
            if (files.Count >= MaxFileCount || info.Length > MaxFileBytes || (total += info.Length) > MaxTotalBytes) {
                outcomes.Add(new PodGateOutcome("pod.file.limit", relative, "Pod release input exceeds the bounded file or total size.", "Remove or reduce the execution asset."));
                continue;
            }
            var bytes = ReadBoundedFile(path);
            files[relative] = new PreparedPodFile(relative, bytes, Sha256(bytes));
        }
        return files;
    }

    private static IEnumerable<string> PositiveFiles(string workspaceRoot, ICollection<PodGateOutcome> outcomes) {
        foreach (var name in new[] { "pod.json", "release.json", "PeScripts.csproj" }) {
            var path = Path.Combine(workspaceRoot, name);
            if (File.Exists(path))
                yield return path;
        }
        var directoryCount = 1;
        foreach (var name in new[] { "src", "settings", "composed", "assets", "inspection" }) {
            var root = Path.Combine(workspaceRoot, name);
            if (!Directory.Exists(root))
                continue;
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) {
                outcomes.Add(new PodGateOutcome("pod.directory.link", name, "Release input directories cannot be links.", "Replace the link with a regular directory."));
                continue;
            }
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0) {
                var directory = pending.Pop();
                if (++directoryCount > MaxDirectoryCount) {
                    outcomes.Add(new PodGateOutcome("pod.directory.limit", name, $"Pod input exceeds {MaxDirectoryCount} directories.", "Reduce the pod directory count."));
                    break;
                }
                foreach (var child in Directory.EnumerateDirectories(directory)) {
                    if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) != 0) {
                        outcomes.Add(new PodGateOutcome("pod.directory.link", BclCompat.GetRelativePath(workspaceRoot, child).Replace('\\', '/'), "Release input directories cannot be links.", "Replace the link with a regular directory."));
                        continue;
                    }
                    pending.Push(child);
                }
                foreach (var path in Directory.EnumerateFiles(directory))
                    yield return path;
            }
        }
    }

    private static PreparedPod? TryUseVerifiedRelease(
        PodManifest manifest,
        IReadOnlyDictionary<string, PreparedPodFile> files,
        ICollection<PodGateOutcome> outcomes,
        out PodReleaseReference? originRelease
    ) {
        originRelease = null;
        if (!files.TryGetValue("release.json", out var releaseFile))
            return null;

        try {
            var release = JObject.Parse(Encoding.UTF8.GetString(releaseFile.Bytes));
            var podId = release["podId"]?.Value<string>() ?? throw new InvalidDataException("release.json is missing podId.");
            var version = release["version"]?.Value<string>() ?? throw new InvalidDataException("release.json is missing version.");
            var contentHash = release["contentHash"]?.Value<string>() ?? throw new InvalidDataException("release.json is missing contentHash.");
            var rows = release["files"] as JArray ?? throw new InvalidDataException("release.json is missing files.");
            if (release["schemaVersion"]?.Value<int>() != 1)
                throw new InvalidDataException("release.json has an unsupported schemaVersion.");
            originRelease = new PodReleaseReference(podId, contentHash, version);

            if (contentHash.Length != 64)
                throw new InvalidDataException("release.json contentHash is not a SHA-256 digest.");
            var expected = ReadReleaseFileHashes(rows);
            var actual = files.Where(pair => pair.Key != "release.json").ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
            var actualHash = ComputeReleaseHash(manifest, actual.ToDictionary(pair => pair.Key, pair => pair.Value.Bytes, StringComparer.OrdinalIgnoreCase));
            var fileRowsMatch = expected.Count == actual.Count
                && expected.All(pair => actual.TryGetValue(pair.Key, out var file) && file.Sha256 == pair.Value);
            var authoredChanged = expected.Where(pair => IsAuthoredPath(pair.Key)).Any(pair => !actual.TryGetValue(pair.Key, out var file) || file.Sha256 != pair.Value)
                || actual.Keys.Where(IsAuthoredPath).Any(path => !expected.ContainsKey(path));
            if (authoredChanged)
                return null;

            if (!fileRowsMatch && actualHash == contentHash)
                throw new InvalidDataException("release.json file rows do not match the released files.");
            if (podId != manifest.Id || version != manifest.Version)
                throw new InvalidDataException("release.json identity does not match unchanged pod.json.");
            if (!fileRowsMatch || actualHash != contentHash)
                throw new InvalidDataException("Released file integrity or content identity does not match release.json.");

            var inspection = ReadInspection(actual);
            var composed = actual.Values.Where(file => file.Path.StartsWith("composed/", StringComparison.OrdinalIgnoreCase))
                .ToDictionary(file => file.Path, file => new PodComposedDocument(file.Path, Encoding.UTF8.GetString(file.Bytes), inspection), StringComparer.OrdinalIgnoreCase);
            foreach (var requirement in manifest.ExternalRequirements)
                outcomes.Add(new PodGateOutcome(
                    "pod.external.runtime-required",
                    $"pod.json#externalRequirements/{requirement.Code}/{requirement.ResourceId}",
                    $"An operation consuming '{requirement.Code}' resource '{requirement.ResourceId}' must resolve its current authority.",
                    "Connect the owning service. Cached definitions are not a fallback.",
                    ScriptDiagnosticSeverity.Info
                ));
            outcomes.Add(new("pod.release.verified", "release.json", $"Released file integrity and content identity match '{contentHash}'; authoring dependencies are not needed.", null, ScriptDiagnosticSeverity.Info));
            return new PreparedPod(manifest, contentHash, files, composed, inspection, outcomes.ToList()) { ReleaseHash = contentHash };
        } catch (Exception exception) when (exception is JsonException or InvalidDataException or ArgumentException) {
            outcomes.Add(new PodGateOutcome("pod.release.integrity", "release.json", exception.Message, "Restore or re-import the exact release before execution."));
            return new PreparedPod(manifest, string.Empty, files, new Dictionary<string, PodComposedDocument>(), [], outcomes.ToList());
        }
    }

    internal static bool HasExactReleasedFileSet(IReadOnlyDictionary<string, byte[]> files) {
        try {
            if (!files.TryGetValue("release.json", out var releaseBytes))
                return false;
            var release = JObject.Parse(Encoding.UTF8.GetString(releaseBytes));
            var rows = release["files"] as JArray;
            if (release["schemaVersion"]?.Value<int>() != 1 || rows is null)
                return false;
            var expected = ReadReleaseFileHashes(rows);
            var actual = files.Where(pair => pair.Key != "release.json").ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
            return expected.Count == actual.Count
                && expected.All(pair => actual.TryGetValue(pair.Key, out var bytes) && Sha256(bytes) == pair.Value);
        } catch (Exception exception) when (exception is JsonException or InvalidDataException or ArgumentException) {
            return false;
        }
    }

    private static Dictionary<string, string> ReadReleaseFileHashes(JArray rows) {
        var expected = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var token in rows) {
            if (token is not JObject row)
                throw new InvalidDataException("release.json contains a non-object file row.");
            var path = row["path"]?.Value<string>() ?? throw new InvalidDataException("release.json contains a file without path.");
            var hash = row["sha256"]?.Value<string>() ?? throw new InvalidDataException("release.json contains a file without sha256.");
            if (hash.Length != 64 || !expected.TryAdd(path, hash))
                throw new InvalidDataException($"release.json contains an invalid or duplicate file row '{path}'.");
        }
        return expected;
    }

    private static IReadOnlyList<PodConsumedDependency> ReadInspection(IReadOnlyDictionary<string, PreparedPodFile> files) {
        if (!files.TryGetValue("inspection/index.json", out var index))
            return [];
        var rows = JArray.Parse(Encoding.UTF8.GetString(index.Bytes));
        var dependencies = new List<PodConsumedDependency>();
        foreach (var token in rows) {
            if (token is not JObject row)
                throw new InvalidDataException("Release inspection index contains a non-object row.");
            var podId = row["podId"]?.Value<string>() ?? throw new InvalidDataException("Release inspection row is missing podId.");
            var releaseHash = row["releaseHash"]?.Value<string>() ?? throw new InvalidDataException("Release inspection row is missing releaseHash.");
            var sourcePath = row["sourcePath"]?.Value<string>() ?? throw new InvalidDataException("Release inspection row is missing sourcePath.");
            var inspectionPath = row["inspectionPath"]?.Value<string>() ?? throw new InvalidDataException("Release inspection row is missing inspectionPath.");
            if (!files.TryGetValue(inspectionPath, out var source))
                throw new InvalidDataException($"Release inspection source is missing: {inspectionPath}");
            dependencies.Add(new PodConsumedDependency(podId, releaseHash, sourcePath, Encoding.UTF8.GetString(source.Bytes)));
        }
        return dependencies;
    }

    private static bool IsAuthoredPath(string path) => path is "pod.json" or "PeScripts.csproj"
        || path.StartsWith("src/", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("settings/", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("assets/", StringComparison.OrdinalIgnoreCase);

    private static void ValidateEntrypoints(PodManifest manifest, IReadOnlyDictionary<string, PreparedPodFile> files, ICollection<PodGateOutcome> outcomes) {
        foreach (var entrypoint in manifest.Entrypoints) {
            if (!files.TryGetValue(entrypoint.SourcePath, out var source)) {
                outcomes.Add(new PodGateOutcome("pod.entrypoint.missing", entrypoint.SourcePath, $"Entrypoint '{entrypoint.Id}' has no source file.", "Add the source file or remove the entrypoint."));
                continue;
            }
            var types = new Pe.Shared.Scripting.Analysis.ScriptEntryPointResolver("PeScriptContainer")
                .ResolveContainerTypeNames(Encoding.UTF8.GetString(source.Bytes));
            if (types.Count != 1)
                outcomes.Add(new PodGateOutcome("pod.entrypoint.count", entrypoint.SourcePath, $"Entrypoint '{entrypoint.Id}' must declare exactly one non-abstract PeScriptContainer; found {types.Count}.", "Keep one concrete PeScriptContainer in the entrypoint file."));
        }
    }

    private static bool TryParseReference(string reference, out string podId, out string path, out string reason) {
        podId = string.Empty;
        path = string.Empty;
        reason = string.Empty;
        if (string.IsNullOrWhiteSpace(reference) || reference[0] != '@') {
            reason = $"Directive reference '{reference}' must use '@local/<typed-file>' or '@<pod-id>/<typed-file>'.";
            return false;
        }
        var separator = reference.IndexOf('/');
        if (separator < 2 || separator == reference.Length - 1) {
            reason = $"Directive reference '{reference}' is incomplete.";
            return false;
        }
        podId = reference[1..separator];
        path = reference[(separator + 1)..].Replace('\\', '/');
        var hasTypedSuffix = false;
        foreach (var suffix in SettingsSuffixes)
            hasTypedSuffix |= path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase);
        if ((podId != "local" && !Pe.Shared.Product.ScriptingWorkspaceLayout.IsWorkspaceSlug(podId))
            || path.StartsWith("/", StringComparison.Ordinal)
            || path.Split('/').Any(segment => segment is "" or "." or "..")
            || !hasTypedSuffix) {
            reason = $"Directive reference '{reference}' must name an exact typed settings filename.";
            return false;
        }
        return true;
    }

    internal static string ManifestSemantics(PodManifest manifest) {
        var semantic = JObject.FromObject(new {
            schemaVersion = manifest.SchemaVersion,
            id = manifest.Id,
            entrypoints = manifest.Entrypoints.Select(entrypoint => new { entrypoint.Id, entrypoint.SourcePath }),
            requires = manifest.Requires.Select(requirement => new { requirement.Id, requirement.ReleaseHash }),
            externalRequirements = manifest.ExternalRequirements.Select(requirement => new { requirement.Code, requirement.ResourceId, requirement.CollectionId })
        });
        return Canonicalize(semantic).ToString(Formatting.None);
    }

    private static JToken Canonicalize(JToken token) => token switch {
        JObject obj => new JObject(obj.Properties().OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => new JProperty(property.Name, Canonicalize(property.Value)))),
        JArray array => new JArray(array.Select(Canonicalize)),
        _ => token.DeepClone()
    };

    internal static string ComputeContentHash(IReadOnlyDictionary<string, byte[]> files) {
        var rows = files.OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => pair.Key + "\0" + Sha256(pair.Value) + "\n");
        return Sha256(Encoding.UTF8.GetBytes(string.Concat(rows)));
    }

    internal static string ComputeReleaseHash(PodManifest manifest, IReadOnlyDictionary<string, byte[]> files) {
        var hashed = new Dictionary<string, byte[]>(StringComparer.Ordinal) {
            ["pod.semantic.json"] = Encoding.UTF8.GetBytes(ManifestSemantics(manifest))
        };
        foreach (var file in files.Where(pair => pair.Key != "pod.json"
            && pair.Key != "release.json"
            && !pair.Key.StartsWith("inspection/", StringComparison.OrdinalIgnoreCase)))
            hashed[file.Key] = file.Value;
        return ComputeContentHash(hashed);
    }

    internal static string Sha256(byte[] bytes) {
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", string.Empty).ToLowerInvariant();
    }

    private static byte[] ReadBoundedFile(string path) {
        var bytes = File.ReadAllBytes(path);
        if (bytes.LongLength > MaxFileBytes)
            throw new InvalidDataException($"Pod file exceeds {MaxFileBytes} bytes: {path}");
        return bytes;
    }

    internal static string ResolveDependencyWorkspaceKey(string ownerRoot, PodRequirement requirement) {
        var parent = Path.GetDirectoryName(ownerRoot)!;
        var candidates = new List<(string Key, bool ExactRelease)>();
        foreach (var directory in Directory.EnumerateDirectories(parent).OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
            var path = Path.Combine(directory, "pod.json");
            if (!File.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) continue;
            try {
                var manifest = PodManifestValidator.ValidateJson(Encoding.UTF8.GetString(ReadBoundedFile(path)));
                if (!manifest.Success || manifest.Manifest!.Id != requirement.Id) continue;
                var releasePath = Path.Combine(directory, "release.json");
                var exact = File.Exists(releasePath) && (File.GetAttributes(releasePath) & FileAttributes.ReparsePoint) == 0
                    && JObject.Parse(Encoding.UTF8.GetString(ReadBoundedFile(releasePath)))["contentHash"]?.Value<string>() == requirement.ReleaseHash;
                candidates.Add((Path.GetFileName(directory), exact));
            } catch (Exception exception) when (exception is JsonException or IOException or UnauthorizedAccessException) {
                // Unreadable unrelated pods cannot block resolution; the selected pod is validated in full.
            }
        }
        var exactCandidates = candidates.Where(candidate => candidate.ExactRelease).ToList();
        var selected = exactCandidates.Count > 0 ? exactCandidates : candidates;
        if (selected.Count == 1) return selected[0].Key;
        throw new InvalidDataException(selected.Count == 0
            ? $"No local pod has identity '{requirement.Id}' for release '{requirement.ReleaseHash}'."
            : $"Pod '{requirement.Id}' is ambiguous between local folders: {string.Join(", ", selected.Select(candidate => candidate.Key))}.");
    }

    private static PreparedPod Failed(string id, string code, string location, string reason, string remedy) =>
        new(EmptyManifest(id), string.Empty, new Dictionary<string, PreparedPodFile>(), new Dictionary<string, PodComposedDocument>(), [], [new PodGateOutcome(code, location, reason, remedy)]);

    private static PodManifest EmptyManifest(string id) => new(PodManifestValidator.CurrentSchemaVersion, id, id, string.Empty, null, [], [], null, null, []);
}
