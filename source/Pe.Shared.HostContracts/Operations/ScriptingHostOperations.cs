using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.HostContracts.Operations;

public static class GetScriptWorkspaceBootstrapOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScriptWorkspaceBootstrapRequest, ScriptWorkspaceBootstrapData>(
            "scripting.workspace.bootstrap",
            HostHttpVerb.Post,
            "/api/scripting/workspace/bootstrap",
            HostExecutionMode.Bridge,
            "Bootstrap Script Workspace",
            HostOperationAgentMetadata.Create(
                "scripting",
                "Create or update the host-owned C# Revit scripting workspace files.",
                new[] { "script", "workspace", "bootstrap", "files" },
                HostOperationIntent.Mutate,
                requiresBridge: true
            )
        );
}

public static class ExecuteRevitScriptOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ExecuteRevitScriptRequest, ExecuteRevitScriptData>(
            "scripting.execute",
            HostHttpVerb.Post,
            "/api/scripting/execute",
            HostExecutionMode.Bridge,
            "Execute Revit Script",
            HostOperationAgentMetadata.Create(
                "scripting",
                "Execute an inline or workspace-relative C# script in connected Revit. Inline content may be Execute-body statements with optional leading using directives or a full PeScriptContainer class; workspace files are normal C# PeScriptContainer entrypoints.",
                new[] { "script", "execute", "csharp", "revit" },
                HostOperationIntent.Mutate,
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}

public static class ImportScriptPodOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScriptPodImportRequest, ScriptPodImportData>(
            "scripting.pod.import",
            HostHttpVerb.Post,
            "/api/scripting/pod/import",
            HostExecutionMode.Bridge,
            "Import Script Pod",
            HostOperationAgentMetadata.Create(
                "scripting",
                "Import a pod.json-backed Revit scripting workspace from a conservative zip archive into a new workspace slug.",
                new[] { "script", "pod", "import", "workspace", "zip", "archive" },
                HostOperationIntent.Mutate,
                requiresBridge: true
            )
        );
}

public static class ExportScriptPodOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScriptPodExportRequest, ScriptPodExportData>(
            "scripting.pod.export",
            HostHttpVerb.Post,
            "/api/scripting/pod/export",
            HostExecutionMode.Bridge,
            "Export Script Pod",
            HostOperationAgentMetadata.Create(
                "scripting",
                "Export a validated pod.json-backed Revit scripting workspace as a portable source-first zip archive.",
                new[] { "script", "pod", "export", "workspace", "zip", "archive" },
                HostOperationIntent.Mutate,
                requiresBridge: true
            )
        );
}
