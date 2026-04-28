using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetRevitDocumentSessionContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, RevitDocumentSessionContextData>(
            "revit-data.document-session-context",
            HostHttpVerb.Get,
            "/api/revit-data/documents/session-context",
            HostExecutionMode.Bridge,
            "Get Revit Document Session Context"
        );
}
