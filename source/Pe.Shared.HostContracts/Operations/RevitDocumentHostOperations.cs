using Pe.Shared.HostContracts.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetRevitDocumentSessionContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<RevitDocumentSessionContextRequest, RevitDocumentSessionContextEnvelopeResponse>(
            "revit-data.document-session-context",
            HostHttpVerb.Post,
            "/api/revit-data/documents/session-context",
            HostExecutionMode.Bridge,
            "Get Revit Document Session Context"
        );
}