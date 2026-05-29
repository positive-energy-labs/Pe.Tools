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
                "Execute an inline or workspace-relative C# script in connected Revit.",
                new[] { "script", "execute", "csharp", "revit" },
                HostOperationIntent.Mutate,
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}
