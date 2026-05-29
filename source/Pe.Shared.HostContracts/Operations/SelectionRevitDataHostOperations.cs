using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetElementContextQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElementContextQueryRequest, ElementContextQueryData>(
            "revit.detail.elements",
            HostHttpVerb.Post,
            "/api/revit/detail/elements",
            HostExecutionMode.Bridge,
            "Get Element Context Query",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read element context, selection, and nearby document facts from connected Revit.",
                new[] { "elements", "selection", "context", "query" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}
