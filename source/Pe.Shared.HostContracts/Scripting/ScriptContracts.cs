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
    string WorkspaceRootPath,
    string ProjectFilePath,
    string SampleScriptPath,
    string ReadmePath,
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
    string? ProjectContent = null,
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

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScriptingPipeCommand {
    ExecuteScript,
    BootstrapWorkspace
}

[ExportTsInterface]
public record ScriptingPipeRequest(
    ScriptingPipeCommand Command,
    string WorkspaceKey = "default",
    bool CreateSampleScript = true,
    ScriptExecutionSourceKind SourceKind = ScriptExecutionSourceKind.WorkspacePath,
    string? SourcePath = null,
    string? ScriptContent = null,
    string? ProjectContent = null,
    string? SourceName = null
);

[ExportTsInterface]
public record ScriptingPipeResponse(
    bool Success,
    string Message,
    ExecuteRevitScriptData? Result = null,
    ScriptWorkspaceBootstrapData? Bootstrap = null
);

public static class ScriptingPipeProtocol {
    public const string PipeName = "Pe.Scripting.Revit";
}
