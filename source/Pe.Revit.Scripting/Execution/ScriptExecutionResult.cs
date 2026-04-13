using System.Reflection;
using Microsoft.CodeAnalysis;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Scripting.Execution;

internal sealed record ScriptSourceFile(
    string Name,
    string Content,
    string? FullPath = null
);

internal sealed record ScriptSourceSet(
    IReadOnlyList<ScriptSourceFile> Files
);

internal sealed record ScriptExecutionPlan(
    Autodesk.Revit.UI.UIApplication UiApplication,
    string ExecutionId,
    string RevitVersion,
    string TargetFramework,
    string RuntimeAssemblyPath,
    string WorkspaceKey,
    string WorkspaceRoot,
    ScriptSourceSet SourceSet,
    string ProjectContent
);

internal sealed record ScriptCompilationResult(
    bool Success,
    byte[]? AssemblyBytes,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);

internal sealed record ScriptContainerResolutionResult(
    ScriptExecutionStatus Status,
    string? ContainerTypeName,
    PeScriptContainer? Container,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);

internal sealed record RuntimeReferenceScope(
    IReadOnlyList<MetadataReference> MetadataReferences,
    IDisposable ResolverScope
);

internal static class RevitRuntimeTargetFramework {
    public static string Resolve(string revitVersion) {
        if (!int.TryParse(revitVersion, out var numericVersion))
            return "net8.0-windows";

        return numericVersion >= 2025 ? "net8.0-windows" : "net48";
    }

    public static string GetRuntimeAssemblyPath() =>
        typeof(PeScriptContainer).Assembly.Location;
}
