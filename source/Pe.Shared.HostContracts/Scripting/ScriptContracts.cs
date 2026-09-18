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

/// <summary>One run's receipt: which member (by pod id, path, and SHA-256) produced which outcome and outputs.</summary>
public record PodReceipt(
    string PodId,
    string MemberPath,
    string MemberSha256,
    string Operation,
    string? PlanHash,
    string Outcome,
    List<string> Outputs,
    string? Reason
) {
    private readonly string? _reason = Reason is "" ? null : Reason;

    /// <summary>A failure's text; `null` when there is none. An empty string is not a third shape, however a writer spells "no reason".</summary>
    public string? Reason { get => this._reason; init => this._reason = value is "" ? null : value; }
}

public record PodMemberComposeRequest(string Pod, string Path, string? Content = null, PodCapturedSourceData? Source = null);

public record PodMemberComposeData(string? Composed, PodCapturedSourceData Source, List<ScriptDiagnostic> Diagnostics, List<PodConsumedSourceData> Dependencies);

public record PodCapturedSourceData(string Id, string Path, string Sha256, string BytesBase64, PodSourceOrigin Origin);

public record PodConsumedSourceData(string Id, string Path, string Sha256, string BytesBase64);

[JsonConverter(typeof(StringEnumConverter))]
public enum PodSourceOrigin {
    SavedMember,
    SuppliedDraft
}

public record PodDependencyData(string Id, string Path, string Sha256);

public record PodExportRequest(string Pod, string ArchivePath);

public record PodExportData(string ArchivePath, List<PodDependencyData> Vendored);

public record PodImportRequest(string ArchivePath, string? Folder = null);

public record PodImportData(string Id, string Folder);

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptExecutionStatus {
    Succeeded,
    ReferenceResolutionFailed,
    CompilationFailed,
    RuntimeFailed,
    Rejected,
    PolicyRejected,
    Canceled,
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
