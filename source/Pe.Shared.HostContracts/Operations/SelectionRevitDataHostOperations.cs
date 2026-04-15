using Pe.Shared.HostContracts.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetSelectionContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SelectionContextRequest, SelectionContextEnvelopeResponse>(
            "revit-data.selection.current",
            HostHttpVerb.Post,
            "/api/revit-data/selection/current",
            HostExecutionMode.Bridge,
            "Get Current Selection Context"
        );
}
