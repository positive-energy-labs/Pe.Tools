using Pe.Shared.HostContracts.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetElementContextQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElementContextQueryRequest, ElementContextQueryEnvelopeResponse>(
            "revit-data.element-context.query",
            HostHttpVerb.Post,
            "/api/revit-data/element-context/query",
            HostExecutionMode.Bridge,
            "Get Element Context Query"
        );
}