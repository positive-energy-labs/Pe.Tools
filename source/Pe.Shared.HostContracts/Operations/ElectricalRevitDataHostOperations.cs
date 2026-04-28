using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetElectricalPanelsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalPanelsCatalogRequest, ElectricalPanelsCatalogData>(
            "revit-data.electrical.panels.catalog",
            HostHttpVerb.Post,
            "/api/revit-data/electrical/panels/catalog",
            HostExecutionMode.Bridge,
            "Get Electrical Panels Catalog"
        );
}

public static class GetElectricalCircuitsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ElectricalCircuitsCatalogRequest, ElectricalCircuitsCatalogData>(
            "revit-data.electrical.circuits.catalog",
            HostHttpVerb.Post,
            "/api/revit-data/electrical/circuits/catalog",
            HostExecutionMode.Bridge,
            "Get Electrical Circuits Catalog"
        );
}

public static class GetElectricalLoadClassificationsCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition
            .Create<ElectricalLoadClassificationsCatalogRequest, ElectricalLoadClassificationsCatalogData>(
                "revit-data.electrical.load-classifications.catalog",
                HostHttpVerb.Post,
                "/api/revit-data/electrical/load-classifications/catalog",
                HostExecutionMode.Bridge,
                "Get Electrical Load Classifications Catalog"
            );
}

public static class GetElectricalPanelSchedulesQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition
            .Create<ElectricalPanelSchedulesQueryRequest, ElectricalPanelSchedulesQueryData>(
                "revit-data.electrical.panel-schedules.query",
                HostHttpVerb.Post,
                "/api/revit-data/electrical/panel-schedules/query",
                HostExecutionMode.Bridge,
                "Get Electrical Panel Schedules Query"
            );
}
