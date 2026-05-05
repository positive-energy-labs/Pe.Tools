namespace Pe.Shared.HostContracts.Operations;

public static class HostOperationsCatalog {
    public static IReadOnlyList<HostOperationDefinition> All { get; } = [
        GetApsAuthStatusOperationContract.Definition,
        LoginApsOperationContract.Definition,
        LogoutApsOperationContract.Definition,
        AcquireApsAccessTokenOperationContract.Definition,
        GetHostStatusOperationContract.Definition,
        GetSchemaOperationContract.Definition,
        GetWorkspacesOperationContract.Definition,
        DiscoverSettingsTreeOperationContract.Definition,
        GetSettingsModuleCatalogBridgeOperationContract.Definition,
        GetFieldOptionsOperationContract.Definition,
        GetParameterCatalogOperationContract.Definition,
        GetLoadedFamiliesFilterSchemaOperationContract.Definition,
        GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition,
        GetScheduleCatalogOperationContract.Definition,
        GetScheduleProfilesQueryOperationContract.Definition,
        GetScheduleQueryOperationContract.Definition,
        GetLoadedFamiliesCatalogOperationContract.Definition,
        GetLoadedFamiliesMatrixOperationContract.Definition,
        GetProjectParameterBindingsOperationContract.Definition,
        GetElementContextQueryOperationContract.Definition,
        GetElectricalPanelsCatalogOperationContract.Definition,
        GetElectricalCircuitsCatalogOperationContract.Definition,
        GetElectricalPanelSchedulesQueryOperationContract.Definition,
        GetElectricalLoadClassificationsCatalogOperationContract.Definition,
        GetRevitDocumentSessionContextOperationContract.Definition,
        OpenSettingsDocumentOperationContract.Definition,
        ValidateSettingsDocumentOperationContract.Definition,
        SaveSettingsDocumentOperationContract.Definition,
        GetScriptWorkspaceBootstrapOperationContract.Definition,
        ExecuteRevitScriptOperationContract.Definition
    ];
}
