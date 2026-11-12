using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;

namespace Pe.Revit.Scripting.Storage;

/// <summary>
///     File names of a pod's script workspace, and the two places scripting writes that are not a pod: the
///     inline traces and the user's own Pods folder, where a person's new pod is created. A pod that already
///     exists is found by the host, in whichever home holds it.
/// </summary>
public static class RevitScriptingStorageLocations {
    public const string ProjectFileName = ScriptingWorkspaceLayout.ProjectFileName;
    public const string AgentsFileName = ScriptingWorkspaceLayout.AgentInstructionsFileName;
    public const string ReadmeFileName = ScriptingWorkspaceLayout.ReadmeFileName;
    public const string PodManifestFileName = ScriptingWorkspaceLayout.PodManifestFileName;
    public const string SourceDirectoryName = ScriptingWorkspaceLayout.SourceDirectoryName;
    /// <summary>The <c>Runs</c> segment for inline traces. Reserved like <c>_no-pod</c>: a pod id cannot start with an underscore.</summary>
    public const string InlineTraceDirectoryName = "_inline";
    public const string SampleFileName = ScriptingWorkspaceLayout.SampleScriptFileName;

    /// <summary>
    ///     Machine state: <c>state\Runs\_inline\&lt;utc&gt;-&lt;execution id&gt;-&lt;name&gt;</c>. A trace has no pod and no run id,
    ///     so it is not a run folder and does not sit among the pod-less runs, whose every child is one run.
    /// </summary>
    public static string ResolveInlineTraceDirectory() =>
        Path.Combine(ProductRuntimeLayout.Current.State.RunsPath, InlineTraceDirectoryName);

    /// <summary>The folder of a new pod in the user home. Never the address of a pod the host already admits.</summary>
    public static string ResolveNewPodFolder(string workspaceKey) =>
        ScriptingWorkspaceLocations.ResolveWorkspaceRoot(workspaceKey);
}
