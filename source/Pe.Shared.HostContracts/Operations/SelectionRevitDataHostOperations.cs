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
                "Read exact element context, selected/visible equipment facts, requested parameters, electrical systems, circuits, panels, connectors, panel schedules, load classifications, and nearby document facts from connected Revit.",
                new[] { "elements", "selection", "context", "query", "electrical", "circuits", "panel", "load-name", "explicit-handles", "visible-handles", "selected-equipment", "equipment-alignment" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "visible equipment electrical context",
                        "Use element ids returned by revit.context.visible-summary ViewReferences/ActiveViewVisible to inspect exact visible equipment before broad electrical catalog queries.",
                        """
                        { "query": { "kind": "ElementReferences", "elementIds": [12345, 67890], "parameterQuery": { "parameterNames": ["Mark", "Panel", "Circuit Number", "Load Name"] } } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "explicit equipment electrical context by unique id",
                        "Use when prior host operations or scripts returned unique ids rather than numeric ids.",
                        """
                        { "query": { "kind": "ElementReferences", "elementUniqueIds": ["abcd-1234"], "parameterQuery": { "parameterNames": ["Mark", "Panel", "Circuit Number", "Load Name"] } } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "selected equipment context",
                        "Use the current Revit selection as the exact audit scope when the user selected equipment first.",
                        """
                        { "query": { "kind": "CurrentSelection", "parameterQuery": { "parameterNames": ["Mark", "Panel", "Circuit Number", "Load Name"] } } }
                        """
                    )
                ],
                boundedExpansionHints: [
                    "For instance-specific electrical alignment, call revit.detail.elements on exact handles from selection, visible-summary, schedule coverage samples, or a narrow script before broad panel schedule or circuit catalog queries.",
                    "Use parameterQuery.parameterNames for visible tag/load-name fields, then expand to revit.catalog.electrical-circuits or revit.detail.electrical-panel-schedules only after panel/circuit candidates are known.",
                    "If visible provenance matters, carry it from revit.context.visible-summary; this operation proves element facts for the exact handles it receives."
                ],
                handleProvenanceNotes: "Element detail returns stable element handles plus effective identity/source, requested parameters, electrical systems, connector counts, circuit, panel, panel-schedule, load-classification, wire, and connected-element facts when available."
            )
        );
}
