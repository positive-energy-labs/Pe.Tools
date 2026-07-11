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
    int TimeoutSeconds = 600
);

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
    object? Data = null
);

public record ScriptCancelRequest(
    string? ExecutionId = null
);

public record ScriptCancelData(
    bool Canceled,
    string? ExecutionId,
    string Message
);

public record ScriptPodImportRequest(
    string ArchivePath,
    string? WorkspaceKey = null
);

public record ScriptPodExportRequest(
    string WorkspaceKey,
    string ArchivePath
);

public record ScriptPodListRequest();

public record ScriptPodListData(
    string WorkspacesRootPath,
    List<ScriptPodListItemData> Pods
);

public record ScriptPodListItemData(
    string WorkspaceKey,
    string WorkspaceRootPath,
    bool IsValid,
    ScriptPodManifestSummaryData? Manifest,
    List<ScriptDiagnostic> Diagnostics
);

public record ScriptPodManifestSummaryData(
    int SchemaVersion,
    string Id,
    string Name,
    string Version,
    string? Description,
    List<ScriptPodEntrypointData> Entrypoints
);

public record ScriptPodEntrypointData(
    string Id,
    string SourcePath,
    string? Name = null,
    string? Description = null
);

public record ScriptPodImportData(
    ScriptPodTransferStatus Status,
    string? WorkspaceKey,
    string? WorkspaceRootPath,
    string ArchivePath,
    ScriptPodManifestSummaryData? Manifest,
    List<string> ArchiveEntries,
    List<string> GeneratedFiles,
    List<ScriptDiagnostic> Diagnostics
);

public record ScriptPodExportData(
    ScriptPodTransferStatus Status,
    string? WorkspaceKey,
    string? WorkspaceRootPath,
    string ArchivePath,
    ScriptPodManifestSummaryData? Manifest,
    List<string> ArchiveEntries,
    List<ScriptDiagnostic> Diagnostics
);

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptPodTransferStatus {
    Succeeded,
    Rejected
}

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
    WriteTransaction
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
