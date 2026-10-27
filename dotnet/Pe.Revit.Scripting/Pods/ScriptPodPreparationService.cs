using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Bcl.Compat;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Scripting.Execution;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Pods;
using Pe.Shared.StorageRuntime;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.Scripting.Pods;

/// <summary>One file in a pod. `Schema` is the member's `$schema` when it parses as a JSON object that declares one.</summary>
public sealed record PodMember(string Path, string Sha256, string? Schema);

/// <summary>A pod gated on manifest structure and entrypoint source only. Members are listed either way, never validated here.</summary>
public abstract record PodPreparation(
    string Folder,
    IReadOnlyList<PodMember> Members,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);

/// <summary>Manifest and entrypoints passed; any diagnostics are warnings.</summary>
public sealed record PreparedPod(
    string Folder,
    PodManifest Manifest,
    IReadOnlyList<PodMember> Members,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
) : PodPreparation(Folder, Members, Diagnostics) {
    public IReadOnlyList<PodContribution> Contributions { get; init; } = [];
}

/// <summary>The manifest or an entrypoint failed; the error diagnostics say which.</summary>
public sealed record RefusedPod(
    string Folder,
    IReadOnlyList<PodMember> Members,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
) : PodPreparation(Folder, Members, Diagnostics) {
    public string Reason => string.Join("; ", this.Diagnostics
        .Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error)
        .Select(diagnostic => $"{diagnostic.Source}: {diagnostic.Message}"));
}

/// <summary>One member composed on request: its composed JSON (null on error), its own diagnostics, and consumed fragments.</summary>
public sealed record PodMemberComposition(
    string? Composed,
    PodCapturedSource Source,
    IReadOnlyList<ScriptDiagnostic> Diagnostics,
    IReadOnlyList<PodConsumedDependency> Dependencies
) {
    /// <summary>The consumed bytes as wire data: what a run keeps and what the bridge returns.</summary>
    public PodComposedSource ToSource() => new(
        new PodCapturedSourceData(this.Source.Id, this.Source.Path, this.Source.Sha256, Convert.ToBase64String(this.Source.Bytes), this.Source.Origin),
        [.. this.Dependencies.Select(d => new PodConsumedSourceData(d.PodId, d.Path, d.Sha256, Convert.ToBase64String(d.Bytes)))]);
}

public sealed record PodCapturedSource(
    string? Id,
    string Path,
    string Sha256,
    byte[] Bytes,
    string Content,
    PodRunOrigin Origin
);

public sealed record PodContribution(string Key, string Kind, string MemberPath);
public sealed record PodCapture(string Id, string Folder, string Directory, IReadOnlyList<PodContribution> Contributions, ScriptPodSourceBundle MemberBundle, ScriptPodSourceBundle SourceBundle);
public sealed record PodCaptureResult(PodCapture? Capture, string? Code, string? Reason);

/// <summary>Native composition and bundle validation. The host alone admits package membership.</summary>
public sealed class ScriptPodPreparationService(string? podsRoot = null, Func<string, object, JObject>? admission = null) {
    public const string Stage = "pod";
    private const long MaxFileBytes = ScriptPodMemberBounds.MaxFileBytes;
    public string PodsRoot { get; } = podsRoot ?? RevitScriptingStorageLocations.GetDefaultBasePath();

    // These two reads are host-local; neither may enter the Revit bridge while native code awaits it.
    private JObject ReadAdmission(string key, object request) {
        try {
            return admission is null
                ? TsHostCallClient.Call<JObject>(key, request, TimeSpan.FromSeconds(10))
                : admission(key, request);
        } catch (OperationCanceledException exception) {
            // This dependency owns only its HTTP deadline, never the script's cancellation token.
            throw new InvalidDataException($"Host admission '{key}' exceeded its 10s dependency deadline.", exception);
        }
    }

    public PodCaptureResult Capture(string podId) {
        try {
            var capture = this.ReadAdmission("pod.capture", new { pod = podId }).ToObject<PodCapture>()
                ?? throw new InvalidDataException("Host returned no package capture.");
            if (capture.Id != podId || !string.Equals(Path.GetFullPath(capture.Directory), Path.GetFullPath(FullPath(this.PodsRoot, capture.Folder)), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Host package capture identity or local folder disagrees.");
            return new(capture, null, null);
        } catch (Exception exception) {
            return new(null, "package.unavailable", exception.Message);
        }
    }

    public IReadOnlyList<PodPreparation> List() {
        JObject listing;
        try { listing = this.ReadAdmission("pod.list", new { }); }
        catch (Exception exception) {
            Serilog.Log.Warning(exception, "package.unavailable: host admission could not list Pods");
            return [new RefusedPod(this.PodsRoot, [], [ScriptDiagnosticFactory.Error("package.unavailable", exception.Message)])];
        }
        var pods = new List<PodPreparation>();
        foreach (var row in listing["pods"] ?? new JArray()) {
            var id = row.Value<string>("id") ?? throw new InvalidDataException("Host package lacks identity.");
            var result = this.Capture(id);
            if (result.Capture is not { } capture) {
                pods.Add(new RefusedPod(row.Value<string>("folder") ?? id, [], [ScriptDiagnosticFactory.Error(result.Code!, result.Reason!)]));
                continue;
            }
            var prepared = Prepare(capture.Directory, capture.MemberBundle);
            pods.Add(prepared is PreparedPod pod ? pod with { Contributions = capture.Contributions } : prepared);
        }
        return pods;
    }

    public static PodPreparation Prepare(string folder, ScriptPodSourceBundle bundle) =>
        Prepare(folder, ScriptPodSourceNormalizer.DecodeFiles(bundle), []);

    private static PodPreparation Prepare(string folder, IReadOnlyDictionary<string, byte[]> files, List<ScriptDiagnostic> diagnostics) {
        var members = files.OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => new PodMember(pair.Key, Sha256(pair.Value), ReadSchema(pair.Key, pair.Value)))
            .ToList();
        if (!files.TryGetValue("pod.json", out var manifestBytes)) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, "Pod has no pod.json.", "pod.json"));
            return new RefusedPod(folder, members, diagnostics);
        }
        var manifest = PodManifestValidator.ValidateUtf8(manifestBytes);
        diagnostics.AddRange(manifest.Diagnostics);
        if (manifest.Manifest is null)
            return new RefusedPod(folder, members, diagnostics);

        foreach (var entrypoint in manifest.Manifest.Entrypoints) {
            if (!files.TryGetValue(entrypoint.SourcePath, out var source)) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, $"Entrypoint '{entrypoint.SourcePath}' has no source file.", entrypoint.SourcePath));
                continue;
            }
            var types = new Pe.Shared.Scripting.Analysis.ScriptEntryPointResolver("PeScriptContainer")
                .ResolveContainerTypeNames(Encoding.UTF8.GetString(source));
            if (types.Count != 1)
                diagnostics.Add(ScriptDiagnosticFactory.Error(Stage, $"Entrypoint '{entrypoint.SourcePath}' must declare exactly one non-abstract PeScriptContainer; found {types.Count}.", entrypoint.SourcePath));
        }
        return diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error)
            ? new RefusedPod(folder, members, diagnostics)
            : new PreparedPod(folder, manifest.Manifest, members, diagnostics);
    }

    /// <summary>The one installed pod folder whose manifest id matches. Zero or several matches fail and name the folders.</summary>
    public string ResolveFolder(string podId) {
        var matches = (this.ReadAdmission("pod.list", new { })["pods"] ?? new JArray())
            .Where(row => row.Value<string>("id") == podId).Select(row => row.Value<string>("folder")!).ToList();
        return matches.Count switch {
            1 => FullPath(this.PodsRoot, matches[0]),
            0 => throw new InvalidDataException($"No installed pod has id '{podId}'."),
            _ => throw new InvalidDataException($"Pod id '{podId}' is ambiguous between folders: {string.Join(", ", matches)}.")
        };
    }

    /// <summary>Resolve a local output folder through the same admitted host inventory.</summary>
    public string ResolveId(string folder) {
        var relative = BclCompat.GetRelativePath(this.PodsRoot, folder).Replace('\\', '/');
        _ = FullPath(this.PodsRoot, relative);
        var response = this.ReadAdmission("pod.list", new { projection = "identity", folder = relative });
        var identity = response["identity"];
        if (response.Value<string>("projection") != "identity" || identity?.Value<string>("id") is not { } id
            || identity.Value<string>("folder") is not { } selected
            || !string.Equals(FullPath(this.PodsRoot, selected), Path.GetFullPath(folder), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"No unique admitted pod owns output folder '{folder}'.");
        return id;
    }

    internal static PodCapturedSource CaptureComposeSource(PodMemberComposeRequest request) {
        var source = request.Source ?? throw new InvalidDataException("Captured compose source is required.");
        if (source.Origin is not (PodRunOrigin.SavedMember or PodRunOrigin.SuppliedDraft))
            throw new InvalidDataException("Captured compose source must be a saved member or supplied draft.");
        var content = request.Content ?? throw new InvalidDataException("Captured compose source requires content.");
        var bytes = Convert.FromBase64String(source.BytesBase64);
        if (source.Id != request.Pod || source.Path != request.Path || source.Sha256 != Sha256(bytes)
            || !bytes.SequenceEqual(Encoding.UTF8.GetBytes(content)))
            throw new InvalidDataException("Captured compose source bytes, hash, pod, path, and content disagree.");
        return new PodCapturedSource(source.Id, source.Path, source.Sha256, bytes, content, source.Origin);
    }

    /// <summary>Native schedule capture writes a new settings member into a host-resolved pod.</summary>
    public string WriteSettingsMember(string podId, string path, string content) {
        path = NormalizeMemberPath(path);
        if (!path.StartsWith("settings/", StringComparison.Ordinal))
            throw new InvalidDataException("A settings capture must name settings/<path>.");
        var fullPath = FullPath(this.ResolveFolder(podId), path);
        var bytes = Encoding.UTF8.GetBytes(content);
        if (bytes.LongLength > MaxFileBytes) throw new InvalidDataException($"Settings capture exceeds {MaxFileBytes} bytes.");
        var parent = Path.GetDirectoryName(fullPath);
        while (parent is not null && parent.Length >= this.PodsRoot.Length) {
            if (Directory.Exists(parent) && (File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Settings capture cannot follow directory links.");
            parent = Path.GetDirectoryName(parent);
        }
        _ = Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        using var stream = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write);
        stream.Write(bytes, 0, bytes.Length);
        return Sha256(bytes);
    }

    /// <summary>Composes one member from the draft when given, else from disk. Only this member's diagnostics return.</summary>
    public PodMemberComposition Compose(string? podId, string path, string? draftContent, PodCapturedSource? capturedSource = null) {
        if (podId is null && draftContent is null)
            throw new InvalidDataException("A saved member requires a pod id.");
        path = podId is null
            ? SettingsPathing.NormalizeRelativePath(path, nameof(path))
            : NormalizeMemberPath(path);
        if (path.Length == 0)
            throw new InvalidDataException("A draft path is required.");
        var snapshots = new Dictionary<string, IReadOnlyDictionary<string, byte[]>>(StringComparer.Ordinal);
        byte[] ReadMember(string owner, string memberPath) {
            if (!snapshots.TryGetValue(owner, out var files)) {
                var admitted = this.Capture(owner);
                if (admitted.Capture is not { } capture) throw new InvalidDataException($"{admitted.Code}: {admitted.Reason}");
                files = ScriptPodSourceNormalizer.DecodeFiles(capture.MemberBundle);
                snapshots.Add(owner, files);
            }
            return files.TryGetValue(memberPath, out var bytes) ? bytes
                : throw new InvalidDataException($"No admitted member '{memberPath}' in pod '{owner}'.");
        }
        var source = capturedSource ?? CaptureRoot();
        var result = PodComposer.Compose(path, source.Content, Resolve);
        return new PodMemberComposition(result.Content, source, result.Diagnostics, result.Dependencies);

        PodCapturedSource CaptureRoot() {
            var bytes = draftContent is null
                ? ReadMember(podId!, path)
                : Encoding.UTF8.GetBytes(draftContent);
            return new PodCapturedSource(
                podId,
                path,
                Sha256(bytes),
                bytes,
                draftContent ?? Encoding.UTF8.GetString(bytes),
                draftContent is null ? PodRunOrigin.SavedMember : PodRunOrigin.SuppliedDraft);
        }

        bool Resolve(string reference, out PodConsumedDependency dependency, out string reason) {
            dependency = null!;
            if (!TryParseReference(reference, out var referencedId, out var referencedPath, out reason))
                return false;
            try {
                if (referencedId == "local" && podId is null) {
                    reason = $"Reference '{reference}' needs a pod context; choose a pod or use an explicit @<id>/ reference.";
                    return false;
                }
                var owner = referencedId == "local" ? podId! : referencedId;
                var bytes = ReadMember(owner, referencedPath);
                dependency = new PodConsumedDependency(owner, referencedPath, Sha256(bytes), bytes, Encoding.UTF8.GetString(bytes));
                return true;
            } catch (Exception exception) when (exception is InvalidDataException or IOException or UnauthorizedAccessException or InvalidOperationException) {
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
        try { return ScriptPodSourceNormalizer.ValidateMemberPath(path); }
        catch (ArgumentException exception) { throw new InvalidDataException(exception.Message, exception); }
    }

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

}
