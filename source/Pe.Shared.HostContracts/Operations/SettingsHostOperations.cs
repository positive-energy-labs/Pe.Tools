using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetHostProbeOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, HostProbeData>(
            "settings.host-probe",
            HostHttpVerb.Get,
            $"{HttpRoutes.SettingsBase}/host-probe",
            HostExecutionMode.Local,
            "Get Host Probe"
        );
}

public static class GetHostSessionSummaryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, HostSessionSummaryData>(
            "settings.session-summary",
            HostHttpVerb.Get,
            $"{HttpRoutes.SettingsBase}/session-summary",
            HostExecutionMode.Local,
            "Get Host Session Summary"
        );
}

public static class GetSchemaOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SchemaRequest, SchemaData>(
            "settings.schema",
            HostHttpVerb.Post,
            "/api/settings/schema",
            HostExecutionMode.Bridge,
            "Get Schema"
        );
}

public static class GetWorkspacesOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<GetSettingsWorkspacesRequest, SettingsWorkspacesData>(
            "settings.workspaces",
            HostHttpVerb.Post,
            "/api/settings/workspaces",
            HostExecutionMode.Local,
            "Get Workspaces"
        );
}

public static class DiscoverSettingsTreeOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SettingsTreeRequest, SettingsDiscoveryResult>(
            "settings.tree",
            HostHttpVerb.Post,
            "/api/settings/tree",
            HostExecutionMode.Local,
            "Discover Settings Tree"
        );
}

public static class GetSettingsModuleCatalogBridgeOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.CreateInternal<GetSettingsModuleCatalogBridgeRequest, GetSettingsModuleCatalogBridgeResponse>(
            "settings.module-catalog",
            HostExecutionMode.Bridge,
            "Get Settings Module Catalog"
        );
}

public static class GetFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<FieldOptionsRequest, FieldOptionsData>(
            "settings.field-options",
            HostHttpVerb.Post,
            "/api/settings/field-options",
            HostExecutionMode.Bridge,
            "Get Field Options"
        );
}

public static class GetParameterCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ParameterCatalogRequest, ParameterCatalogData>(
            "settings.parameter-catalog",
            HostHttpVerb.Post,
            "/api/settings/parameter-catalog",
            HostExecutionMode.Bridge,
            "Get Parameter Catalog"
        );
}
