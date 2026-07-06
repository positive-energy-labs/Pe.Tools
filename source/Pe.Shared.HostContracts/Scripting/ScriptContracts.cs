using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.HostContracts.Scripting;

public record ScriptWorkspaceBootstrapRequest(
    string WorkspaceKey = "default",
    bool CreateSampleScript = true
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
    string SampleScriptPath,
    string RevitVersion,
    string TargetFramework,
    string RuntimeAssemblyPath,
    List<string> GeneratedFiles
);

public record ExecuteRevitScriptRequest(
    string? ScriptContent = null,
    ScriptExecutionSourceKind SourceKind = ScriptExecutionSourceKind.InlineSnippet,
    string? SourcePath = null,
    string WorkspaceKey = "default",
    string? SourceName = null,
    string? ArtifactRunName = null,
    ScriptPermissionMode PermissionMode = ScriptPermissionMode.ReadOnly
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
    List<ScriptArtifactData>? Artifacts = null
);

public record ScriptPodImportRequest(
    string ArchivePath,
    string? WorkspaceKey = null
);

public record ScriptPodExportRequest(
    string WorkspaceKey,
    string ArchivePath
);

public record ScriptPodManifestSummaryData(
    int SchemaVersion,
    string Id,
    string Name,
    string Version,
    string? Description,
    ScriptPodOriginData? Origin,
    List<ScriptPodEntrypointData> Entrypoints
);

public record ScriptPodOriginData(
    string Path
);

public record ScriptPodEntrypointData(
    string Id,
    string SourcePath,
    string? Name = null
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
    PolicyRejected
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

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptExecutionSourceKind {
    InlineSnippet,
    WorkspacePath
}

public record ScriptDiagnostic(
    string Stage,
    ScriptDiagnosticSeverity Severity,
    string Message,
    string? Source = null
);
