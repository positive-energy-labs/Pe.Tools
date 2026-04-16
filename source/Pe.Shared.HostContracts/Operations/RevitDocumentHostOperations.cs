using Pe.Shared.HostContracts.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetRevitDocumentContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<RevitDocumentContextRequest, RevitDocumentContextEnvelopeResponse>(
            "revit-data.document-context",
            HostHttpVerb.Post,
            "/api/revit-data/documents/context",
            HostExecutionMode.Bridge,
            "Get Revit Document Context"
        );
}
