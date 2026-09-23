using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.HostContracts.Scripting;

public record ScriptWorkspaceBootstrapRequest(
    string WorkspaceKey = "default"
);

public record ScriptWorkspaceBootstrapData(
    string WorkspaceKey,
    string ProductHomePath,
    string ProductAgentsPath,
    string ProductReadmePath,
    string WorkspaceRootPath,
    string WorkspaceAgentsPath,
    string WorkspaceReadmePath,
    string ProjectFilePath,
    string PodManifestPath,
    string SampleScriptPath,
    string RevitVersion,
    string TargetFramework,
    string RuntimeAssemblyPath,
    List<string> GeneratedFiles
);

public record ExecuteRevitScriptRequest(
    string? ScriptContent = null,
    string? SourcePath = null,
    string WorkspaceKey = "default",
    string? SourceName = null,
    ScriptPermissionMode PermissionMode = ScriptPermissionMode.ReadOnly,
    int TimeoutSeconds = 600,
    ScriptPodSourceBundle? SourceBundle = null
);

public record ScriptPodSourceFile(string Path, string BytesBase64);

public record ScriptPodSourceBundle(List<ScriptPodSourceFile> Files);

public record ScriptArtifactData(
    string Name,
    string RelativePath,
    string FullPath,
    string ContentType,
    long SizeBytes
);

public record ExecuteRevitScriptData(
    ScriptExecutionStatus Status,
    string Output,
    List<ScriptDiagnostic> Diagnostics,
    string RevitVersion,
    string TargetFramework,
    string? ContainerTypeName,
    string ExecutionId,
    List<ScriptArtifactData>? Artifacts = null,
    object? Data = null,
    PodReceipt? Attribution = null
);

/// <summary>What a run's source was: a saved member's bytes, a supplied draft, or operation input with no member.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum PodRunOrigin {
    SavedMember,
    SuppliedDraft,
    Operation
}

/// <summary>A run's settled outcome. Cancelled is its own answer, never a rollback claim.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum PodRunOutcome {
    Succeeded,
    Failed,
    Cancelled
}

/// <summary>
///     One run's receipt: its source origin, outcome, and outputs. `PodId` is null when an unfiled draft stores the run
///     in operation output.
///     `MemberSha256` names saved bytes, so only a <see cref="PodRunOrigin.SavedMember" /> run carries it; a
///     supplied draft keeps the path it drafts and its own bytes and hash stay in `input.json`; operation input
///     names no member.
/// </summary>
public sealed record PodReceipt {
    private PodReceipt(string? podId, string? memberPath, string? memberSha256, PodRunOrigin origin,
        string operation, string? planHash, PodRunOutcome outcome, List<string> outputs, string? reason) {
        (this.PodId, this.MemberPath, this.MemberSha256, this.Origin) = (podId, memberPath, memberSha256, origin);
        (this.Operation, this.PlanHash, this.Outcome, this.Outputs, this.Reason) = (operation, planHash, outcome, outputs, reason);
    }

    public string? PodId { get; }
    public string? MemberPath { get; }
    public string? MemberSha256 { get; }
    public PodRunOrigin Origin { get; }
    public string Operation { get; init; }
    public string? PlanHash { get; init; }
    public PodRunOutcome Outcome { get; init; }
    public List<string> Outputs { get; init; }
    private readonly string? _reason;
    public string? Reason { get => this._reason; init => this._reason = value is "" ? null : value; }

    public static PodReceipt ForSavedMember(string? podId, string path, string sha256, string operation,
        string? planHash, PodRunOutcome outcome, List<string> outputs, string? reason) =>
        new(podId, path, sha256, PodRunOrigin.SavedMember, operation, planHash, outcome, outputs, reason);

    public static PodReceipt ForOperation(string podId, string operation, string? planHash,
        PodRunOutcome outcome, List<string> outputs, string? reason) =>
        new(podId, null, null, PodRunOrigin.Operation, operation, planHash, outcome, outputs, reason);

    /// <summary>A draft never claims a saved member's hash; operation input is not a captured member.</summary>
    public static PodReceipt ForSource(PodCapturedSourceData root, string operation, string? planHash, PodRunOutcome outcome, List<string> outputs, string? reason) =>
        root.Origin switch {
            PodRunOrigin.SavedMember => ForSavedMember(root.Id, root.Path, root.Sha256, operation, planHash, outcome, outputs, reason),
            PodRunOrigin.SuppliedDraft => new(root.Id, null, null, root.Origin, operation, planHash, outcome, outputs, reason),
            _ => throw new ArgumentException("A captured source must be a saved member or supplied draft.", nameof(root))
        };
}

public record PodMemberComposeRequest(string? Pod, string Path, string? Content = null, PodCapturedSourceData? Source = null);

public record PodMemberComposeData(string? Composed, PodCapturedSourceData Source, List<ScriptDiagnostic> Diagnostics, List<PodConsumedSourceData> Dependencies);

public record PodCapturedSourceData(
    string? Id,
    [property: JsonProperty(Required = Required.Always)] string Path,
    [property: JsonProperty(Required = Required.Always)] string Sha256,
    [property: JsonProperty(Required = Required.Always)] string BytesBase64,
    [property: JsonProperty(Required = Required.Always)] PodRunOrigin Origin);

public record PodConsumedSourceData(
    [property: JsonProperty(Required = Required.Always)] string Id,
    [property: JsonProperty(Required = Required.Always)] string Path,
    [property: JsonProperty(Required = Required.Always)] string Sha256,
    [property: JsonProperty(Required = Required.Always)] string BytesBase64);

public record PodDependencyData(string Id, string Path, string Sha256);

public record PodExportRequest(string Pod, string ArchivePath);

public record PodExportData(string ArchivePath, List<PodDependencyData> Vendored);

public record PodImportRequest(string ArchivePath, string? Folder = null);

public record PodImportData(string Id, string Folder, IReadOnlyList<ScriptDiagnostic>? Diagnostics = null);

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptExecutionStatus {
    Succeeded,
    ReferenceResolutionFailed,
    CompilationFailed,
    RuntimeFailed,
    Rejected,
    PolicyRejected,
    Cancelled,
    TimedOut
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptPermissionMode {
    ReadOnly,
    WriteTransaction,
    NoTransaction
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptDiagnosticSeverity {
    Info,
    Warning,
    Error
}

public record ScriptDiagnostic(
    string Stage,
    ScriptDiagnosticSeverity Severity,
    string Message,
    string? Source = null
);
