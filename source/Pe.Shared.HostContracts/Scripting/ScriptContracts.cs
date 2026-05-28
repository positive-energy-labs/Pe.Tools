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
    string? SourceName = null
);

[ExportTsInterface]
public record ExecuteRevitScriptData(
    ScriptExecutionStatus Status,
    string Output,
    List<ScriptDiagnostic> Diagnostics,
    string RevitVersion,
    string TargetFramework,
    string? ContainerTypeName,
    string ExecutionId
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScriptExecutionStatus {
    Succeeded,
    ReferenceResolutionFailed,
    CompilationFailed,
    RuntimeFailed,
    Rejected
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
