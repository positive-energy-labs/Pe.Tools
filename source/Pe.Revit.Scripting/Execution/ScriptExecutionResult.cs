using Autodesk.Revit.UI;
using Microsoft.CodeAnalysis;
using Pe.Revit.Scripting.Context;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Scripting.Execution;

internal sealed record ScriptExecutionPlan(
    UIApplication UiApplication,
    string ExecutionId,
    string RevitVersion,
    string TargetFramework,
    string RuntimeAssemblyPath,
    string WorkspaceKey,
    string WorkspaceRoot,
    ScriptPermissionMode PermissionMode,
    ScriptSourceSet SourceSet,
    ScriptWorkspaceExecutionMode ExecutionMode,
    PodManifest? PodManifest,
    string ProjectContent,
    bool RequireSingleContainer
);

internal enum ScriptWorkspaceExecutionMode {
    InlineSnippet,
    Pod
}

/// <summary>
///     Cooperative cancellation for one script execution: the linked token fires on caller cancel,
///     scripting.cancel, or timeout; <see cref="IsTimeout" /> distinguishes the timeout source.
/// </summary>
public sealed class ScriptCancellationScope(
    CancellationToken token,
    Func<bool> isTimeout,
    int timeoutSeconds
) {
    public static readonly ScriptCancellationScope None = new(CancellationToken.None, static () => false, 0);

    public CancellationToken Token { get; } = token;
    public int TimeoutSeconds { get; } = timeoutSeconds;
    public bool IsTimeout => isTimeout();
}

internal sealed record ScriptContainerResolutionResult(
    ScriptExecutionStatus Status,
    string? ContainerTypeName,
    PeScriptContainer? Container,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);

internal sealed record RuntimeReferenceScope(
    IReadOnlyList<MetadataReference> MetadataReferences,
    IScriptRuntimeScope ResolverScope
);

/// <summary>
///     Owns dependency resolution for one script run AND loads the compiled script assembly
///     itself. The script must be loaded through this scope: on .NET Core the default load
///     context silently satisfies binds for any assembly the host already has loaded, BEFORE
///     resolve events fire — so hot-reloading a lib the host loaded only works when the script
///     lives in a context whose Load() gets first say.
/// </summary>
internal interface IScriptRuntimeScope : IDisposable {
    System.Reflection.Assembly LoadScriptAssembly(byte[] assemblyBytes);
}

internal static class RevitRuntimeTargetFramework {
    public static string Resolve(string revitVersion) {
        if (!int.TryParse(revitVersion, out var numericVersion))
            return "net8.0-windows";

        return numericVersion >= 2025 ? "net8.0-windows" : "net48";
    }

    public static string GetRuntimeAssemblyPath() =>
        typeof(PeScriptContainer).Assembly.Location;
}