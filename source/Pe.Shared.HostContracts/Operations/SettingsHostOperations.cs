using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Shared.HostContracts.Operations;

public static class GetHostStatusOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, HostStatusData>(
            "settings.host-status",
            HostHttpVerb.Get,
            "/api/settings/host-status",
            HostExecutionMode.Local,
            "Get Host Status"
        );
}

public static class GetSchemaOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SchemaRequest, SchemaEnvelopeResponse>(
            "settings.schema",
            HostHttpVerb.Get,
            "/api/settings/schema",
            HostExecutionMode.Local,
            "Get Schema"
        );
}

public static class GetWorkspacesOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, SettingsWorkspacesData>(
            "settings.workspaces",
            HostHttpVerb.Get,
            "/api/settings/workspaces",
            HostExecutionMode.Local,
            "Get Workspaces"
        );
}

public static class DiscoverSettingsTreeOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SettingsTreeRequest, SettingsDiscoveryResult>(
            "settings.tree",
            HostHttpVerb.Get,
            "/api/settings/tree",
            HostExecutionMode.Local,
            "Discover Settings Tree"
        );
}

public static class GetFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<FieldOptionsRequest, FieldOptionsEnvelopeResponse>(
            "settings.field-options",
            HostHttpVerb.Post,
            "/api/settings/field-options",
            HostExecutionMode.Bridge,
            "Get Field Options"
        );
}

public static class GetParameterCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ParameterCatalogRequest, ParameterCatalogEnvelopeResponse>(
            "settings.parameter-catalog",
            HostHttpVerb.Post,
            "/api/settings/parameter-catalog",
            HostExecutionMode.Bridge,
            "Get Parameter Catalog",
            new HostCachePolicy("parameter-catalog", 300)
        );
}