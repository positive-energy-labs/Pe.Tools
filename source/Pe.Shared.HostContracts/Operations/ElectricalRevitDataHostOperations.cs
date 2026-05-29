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
                "Read electrical panel facts from the active Revit document.",
                new[] { "revit", "panels", "catalog", "distribution" },
                requiresBridge: true,
                requiresActiveDocument: true
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
                "Read electrical circuit facts from the active Revit document.",
                new[] { "revit", "circuits", "catalog", "loads" },
                requiresBridge: true,
                requiresActiveDocument: true
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
                    "Read electrical panel schedule projections from the active Revit document.",
                    new[] { "revit", "panel-schedules", "query", "schedules" },
                    requiresBridge: true,
                    requiresActiveDocument: true
                )
            );
}
