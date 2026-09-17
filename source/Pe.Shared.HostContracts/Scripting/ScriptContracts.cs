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
);

public record ScriptCancelRequest(
    string? ExecutionId = null
);

public record ScriptCancelData(
    bool Canceled,
    string? ExecutionId,
    string Message
);

public record PodListRequest();

public record PodListData(List<PodData> Pods);

/// <summary>An installed pod. Id, name, and version are null when pod.json is invalid; diagnostics cover manifest and entrypoints only.</summary>
public record PodData(
    string? Id,
    string? Name,
    string? Version,
    string Folder,
    List<ScriptPodEntrypointData> Entrypoints,
    List<PodMemberData> Members,
    List<ScriptDiagnostic> Diagnostics
);

public record PodMemberData(string Path, string Sha256, string? Schema);

public record PodMemberReadRequest(string Pod, string Path);

public record PodMemberReadData(string Content, string Sha256);

public record PodMemberWriteRequest(string Pod, string Path, string Content);

public record PodMemberWriteData(string Sha256);

public record PodMemberComposeRequest(string Pod, string Path, string? Content = null);

public record PodMemberComposeData(string? Composed, List<ScriptDiagnostic> Diagnostics, List<PodDependencyData> Dependencies);

public record PodDependencyData(string Id, string Path, string Sha256);

public record PodExportRequest(string Pod, string ArchivePath);

public record PodExportData(string ArchivePath, List<PodDependencyData> Vendored);

public record PodImportRequest(string ArchivePath, string? Folder = null);

public record PodImportData(string Id, string Folder);

public record ScriptPodEntrypointData(
    string Id,
    string SourcePath,
    string? Name = null,
    string? Description = null
);

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
