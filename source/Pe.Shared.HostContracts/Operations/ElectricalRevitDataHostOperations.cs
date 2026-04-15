using Pe.Shared.HostContracts.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetElectricalPanelsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalPanelsCatalogRequest, ElectricalPanelsCatalogEnvelopeResponse>(
            "revit-data.electrical.panels.catalog",
            HostHttpVerb.Post,
            "/api/revit-data/electrical/panels/catalog",
            HostExecutionMode.Bridge,
            "Get Electrical Panels Catalog",
            new HostCachePolicy("electrical-panels-catalog", 10)
        );
}

public static class GetElectricalCircuitsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalCircuitsCatalogRequest, ElectricalCircuitsCatalogEnvelopeResponse>(
            "revit-data.electrical.circuits.catalog",
            HostHttpVerb.Post,
            "/api/revit-data/electrical/circuits/catalog",
            HostExecutionMode.Bridge,
            "Get Electrical Circuits Catalog",
            new HostCachePolicy("electrical-circuits-catalog", 10)
        );
}

public static class GetElectricalLoadClassificationsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalLoadClassificationsCatalogRequest, ElectricalLoadClassificationsCatalogEnvelopeResponse>(
            "revit-data.electrical.load-classifications.catalog",
            HostHttpVerb.Post,
            "/api/revit-data/electrical/load-classifications/catalog",
            HostExecutionMode.Bridge,
            "Get Electrical Load Classifications Catalog",
            new HostCachePolicy("electrical-load-classifications-catalog", 10)
        );
}

public static class GetElectricalPanelSchedulesQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalPanelSchedulesQueryRequest, ElectricalPanelSchedulesQueryEnvelopeResponse>(
            "revit-data.electrical.panel-schedules.query",
            HostHttpVerb.Post,
            "/api/revit-data/electrical/panel-schedules/query",
            HostExecutionMode.Bridge,
            "Get Electrical Panel Schedules Query",
            new HostCachePolicy("electrical-panel-schedules-query", 10)
        );
}
