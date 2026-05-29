using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetElectricalPanelsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalPanelsCatalogRequest, ElectricalPanelsCatalogData>(
            "revit.catalog.electrical-panels",
            HostHttpVerb.Post,
            "/api/revit/catalog/electrical-panels",
            HostExecutionMode.Bridge,
            "Get Electrical Panels Catalog",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read electrical panel facts, panel names, marks, panel-schedule counts, and connected-load counts from the active Revit document.",
                new[] { "revit", "panels", "catalog", "distribution", "electrical-equipment", "panel-schedule-references", "panel-names" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "find a known panel",
                        "Resolve a panel name discovered from element context or circuit catalog before requesting panel schedule rows.",
                        """
                        { "filter": { "panelNames": ["C6P"] } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "find by mark",
                        "Use when equipment context exposes a panel mark rather than the display panel name.",
                        """
                        { "filter": { "marks": ["C6P"] } }
                        """
                    )
                ],
                boundedExpansionHints: [
                    "Use panel names/ids returned here as PanelReferences input to revit.detail.electrical-panel-schedules.",
                    "For per-equipment alignment, start with revit.detail.elements on exact equipment handles; this catalog is for resolving panel candidates, not proving element ownership."
                ],
                handleProvenanceNotes: "Panel catalog entries carry panel ids, unique ids, panel names, marks, assigned-circuit counts, panel-schedule counts, and connected-load counts."
            )
        );
}

public static class GetElectricalCircuitsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalCircuitsCatalogRequest, ElectricalCircuitsCatalogData>(
            "revit.catalog.electrical-circuits",
            HostHttpVerb.Post,
            "/api/revit/catalog/electrical-circuits",
            HostExecutionMode.Bridge,
            "Get Electrical Circuits Catalog",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read electrical circuit facts, connected load identity, panel names, circuit numbers, and optional nearby proxy context from the active Revit document.",
                new[] { "revit", "circuits", "catalog", "loads", "panel", "load-name", "connected-elements", "nearby-proxy", "equipment-alignment" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "filter by known panel/load/circuit",
                        "Use after exact element context identifies likely panel, load name, or circuit number candidates.",
                        """
                        { "filter": { "panelNames": ["C6P"], "loadNames": ["RV-13, DH-7 - Lower Level"], "circuitNumbers": ["1"] }, "options": { "parameterQuery": { "parameterNames": ["Mark", "Panel", "Circuit Number", "Load Name"] } } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "include nearby proxy context",
                        "Enable when exact connected elements are generic/proxy-like and need nearby identity candidates.",
                        """
                        { "filter": { "panelNames": ["C6P"] }, "options": { "includeNearbyProxyContext": true, "nearbyRadiusFeet": 3, "maxNearbyCandidatesPerElement": 5, "parameterQuery": { "parameterNames": ["Mark", "Load Name"] } } }
                        """
                    )
                ],
                boundedExpansionHints: [
                    "For per-equipment tag/load alignment, call revit.detail.elements on exact element handles first; use circuit catalog after you know panel/circuit/load candidates.",
                    "Use returned panel ids/names as PanelReferences input to revit.detail.electrical-panel-schedules when row/cell schedule detail is needed.",
                    "Use options.includeNearbyProxyContext only when connected electrical elements look proxy-like or fail to carry the identity visible in the model."
                ],
                handleProvenanceNotes: "Circuit catalog entries include connected element handles, effective identity/source, electrical connector/system counts, roles, panel references, and optional nearby proxy candidates."
            )
        );
}

public static class GetElectricalLoadClassificationsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition
            .Create<ElectricalLoadClassificationsCatalogRequest, ElectricalLoadClassificationsCatalogData>(
                "revit.catalog.electrical-load-classifications",
                HostHttpVerb.Post,
                "/api/revit/catalog/electrical-load-classifications",
                HostExecutionMode.Bridge,
                "Get Electrical Load Classifications Catalog",
                HostOperationAgentMetadata.Create(
                    "revit",
                    "Read electrical load classification facts from the active Revit document.",
                    new[] { "revit", "load-classifications", "catalog", "loads" },
                    requiresBridge: true,
                    requiresActiveDocument: true
                )
            );
}

public static class GetElectricalPanelSchedulesQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition
            .Create<ElectricalPanelSchedulesQueryRequest, ElectricalPanelSchedulesQueryData>(
                "revit.detail.electrical-panel-schedules",
                HostHttpVerb.Post,
                "/api/revit/detail/electrical-panel-schedules",
                HostExecutionMode.Bridge,
                "Get Electrical Panel Schedules Query",
                HostOperationAgentMetadata.Create(
                    "revit",
                    "Read electrical panel schedule row/cell projections from the active Revit document. Use this for known panels/schedules, not as the first-choice element-to-load join.",
                    new[] { "revit", "panel-schedules", "query", "schedules", "rows", "cells", "known-panel", "panel-references", "downstream-detail" },
                    requiresBridge: true,
                    requiresActiveDocument: true,
                    requestExamples: [
                        RevitDataHostOperationExamples.Example(
                            "row-filtered detail by known panel/load/circuit",
                            "Inspect only candidate panel schedule rows after element/circuit context identifies panel, circuit, or load-name values.",
                            """
                            { "query": { "kind": "PanelReferences", "panelNames": ["C6P"], "projection": { "view": "RowsOnly", "circuitNumbers": ["1"], "loadNameContains": ["RV-13, DH-7"], "maxRows": 10 } } }
                            """
                        ),
                        RevitDataHostOperationExamples.Example(
                            "detail by known panel name",
                            "Inspect panel schedule rows after element/circuit context or the panel catalog identifies a panel candidate.",
                            """
                            { "query": { "kind": "PanelReferences", "panelNames": ["C6P"], "projection": { "view": "RowsOnly", "maxRows": 25 } } }
                            """
                        ),
                        RevitDataHostOperationExamples.Example(
                            "detail by known panel handle",
                            "Use panel ids returned by revit.catalog.electrical-panels, revit.detail.elements, or revit.catalog.electrical-circuits.",
                            """
                            { "query": { "kind": "PanelReferences", "panelIds": [12345] } }
                            """
                        ),
                        RevitDataHostOperationExamples.Example(
                            "current active panel schedule",
                            "Use when the active Revit view is already the panel schedule the user is asking about.",
                            """
                            { "query": { "kind": "CurrentActiveView" } }
                            """
                        )
                    ],
                    boundedExpansionHints: [
                        "Safe defaults or empty PanelReferences return no rows; first resolve panels through revit.detail.elements, revit.catalog.electrical-circuits, or revit.catalog.electrical-panels.",
                        "Start with revit.detail.elements for exact equipment context when the question is per-equipment tag/load alignment.",
                        "Use row-filtered panel schedule detail after you know panel/circuit/load candidates from element context or circuit catalog.",
                        "Use projection.view=RowsOnly with circuitNumbers, loadNameContains, and maxRows to avoid full panel schedule dumps."
                    ],
                    handleProvenanceNotes: "Panel schedule detail returns schedule/panel identity plus row/cell values and cell source metadata; it does not prove which visible equipment instance owns a load unless correlated with exact element/circuit context."
                )
            );
}
