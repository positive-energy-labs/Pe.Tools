using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Scripting.Pods;

/// <summary>
///     Enumerates scripting workspaces on disk and validates each pod.json. Invalid or
///     manifest-less workspaces are returned with their diagnostics instead of being hidden,
///     so callers (agents, palette) can tell the user exactly what to fix.
/// </summary>
public static class ScriptPodCatalogService {
    public static ScriptPodListData List() {
        var workspacesRoot = RevitScriptingStorageLocations.GetDefaultBasePath();
        var pods = new List<ScriptPodListItemData>();
        if (!Directory.Exists(workspacesRoot))
            return new ScriptPodListData(workspacesRoot, pods);

        foreach (var workspaceRoot in Directory.EnumerateDirectories(workspacesRoot).OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
            var workspaceKey = Path.GetFileName(workspaceRoot);
            if (!ScriptingWorkspaceLayout.IsWorkspaceSlug(workspaceKey))
                continue;

            var manifestPath = Path.Combine(workspaceRoot, ScriptingWorkspaceLayout.PodManifestFileName);
            if (!File.Exists(manifestPath)) {
                pods.Add(new ScriptPodListItemData(
                    workspaceKey,
                    workspaceRoot,
                    false,
                    null,
                    [
                        ScriptDiagnosticFactory.Error(
                            PodManifestValidator.DiagnosticStage,
                            $"Workspace '{workspaceKey}' has no {ScriptingWorkspaceLayout.PodManifestFileName}. Run scripting.workspace.bootstrap to create one."
                        )
                    ]
                ));
                continue;
            }

            var manifestResult = PodManifestValidator.ValidateJson(File.ReadAllText(manifestPath), workspaceKey);
            pods.Add(new ScriptPodListItemData(
                workspaceKey,
                workspaceRoot,
                manifestResult.Success,
                manifestResult.Manifest is null ? null : ScriptPodArchiveService.ToSummary(manifestResult.Manifest),
                manifestResult.Diagnostics.ToList()
            ));
        }

        return new ScriptPodListData(workspacesRoot, pods);
    }
}
