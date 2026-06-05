using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.Scripting;

[ExportTsInterface]
public record ScriptWorkspaceBootstrapRequest(
    string WorkspaceKey = "default",
    bool CreateSampleScript = true
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ExecuteRevitScriptRequest(
    string? ScriptContent = null,
    ScriptExecutionSourceKind SourceKind = ScriptExecutionSourceKind.InlineSnippet,
    string? SourcePath = null,
    string WorkspaceKey = "default",
    string? SourceName = null,
    string? ArtifactRunName = null,
    ScriptPermissionMode PermissionMode = ScriptPermissionMode.ReadOnly
);

[ExportTsInterface]
public record ScriptArtifactData(
    string Name,
    string RelativePath,
    string FullPath,
    string ContentType,
    long SizeBytes
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ScriptPodImportRequest(
    string ArchivePath,
    string? WorkspaceKey = null
);

[ExportTsInterface]
public record ScriptPodExportRequest(
    string WorkspaceKey,
    string ArchivePath
);

[ExportTsInterface]
public record ScriptPodManifestSummaryData(
    int SchemaVersion,
    string Id,
    string Name,
    string? Description,
    List<ScriptPodEntrypointData> Entrypoints
);

[ExportTsInterface]
public record ScriptPodEntrypointData(
    string Id,
    string SourcePath,
    string? Name = null
);

[ExportTsInterface]
public record ScriptPodImportData(
    string WorkspaceKey,
    string WorkspaceRootPath,
    string ArchivePath,
    ScriptPodManifestSummaryData Manifest,
    List<string> ArchiveEntries,
    List<string> GeneratedFiles,
    List<ScriptDiagnostic> Diagnostics
);

[ExportTsInterface]
public record ScriptPodExportData(
    string WorkspaceKey,
    string WorkspaceRootPath,
    string ArchivePath,
    ScriptPodManifestSummaryData Manifest,
    List<string> ArchiveEntries,
    List<ScriptDiagnostic> Diagnostics
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScriptExecutionStatus {
    Succeeded,
    ReferenceResolutionFailed,
    CompilationFailed,
    RuntimeFailed,
    Rejected,
    PolicyRejected
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScriptPermissionMode {
    ReadOnly,
    WriteTransaction
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScriptDiagnosticSeverity {
    Info,
    Warning,
    Error
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScriptExecutionSourceKind {
    InlineSnippet,
    WorkspacePath
}

[ExportTsInterface]
public record ScriptDiagnostic(
    string Stage,
    ScriptDiagnosticSeverity Severity,
    string Message,
    string? Source = null
);
