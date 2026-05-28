using Pe.Shared.Product;

namespace Pe.Shared.HostContracts.Scripting;

public static class ScriptingWorkspaceLocations {
    public const string DefaultWorkspacesDirectoryName = ProductPathNames.WorkspacesDirectoryName;

    public static string GetDefaultBasePath() =>
        ProductUserContentLayout.ForCurrentUser().Scripting.RootPath;

    public static string ResolveWorkspaceRoot(string workspaceKey) =>
        ProductUserContentLayout.ForCurrentUser().Scripting.ResolveWorkspaceRoot(workspaceKey);
}
