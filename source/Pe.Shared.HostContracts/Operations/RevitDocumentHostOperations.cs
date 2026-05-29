using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetRevitDocumentSessionContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, RevitDocumentSessionContextData>(
            "revit.context.document-session",
            HostHttpVerb.Get,
            "/api/revit/context/document-session",
            HostExecutionMode.Bridge,
            "Get Revit Document Session Context",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read open, active, and selected document session context from connected Revit.",
                new[] { "document", "session", "active-document", "open-documents" },
                requiresBridge: true
            )
        );
}
