using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.HostContracts.Operations;

public static class GetScriptWorkspaceBootstrapOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScriptWorkspaceBootstrapRequest, ScriptWorkspaceBootstrapData>(
            "scripting.workspace.bootstrap",
            HostHttpVerb.Post,
            "/api/scripting/workspace/bootstrap",
            HostExecutionMode.Local,
            "Bootstrap Script Workspace"
        );
}

public static class ExecuteRevitScriptOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ExecuteRevitScriptRequest, ExecuteRevitScriptData>(
            "scripting.execute",
            HostHttpVerb.Post,
            "/api/scripting/execute",
            HostExecutionMode.Local,
            "Execute Revit Script"
        );
}
