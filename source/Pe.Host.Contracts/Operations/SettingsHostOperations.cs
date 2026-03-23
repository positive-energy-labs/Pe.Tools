namespace Pe.Host.Contracts;

public static class GetHostStatusOperationContract {
    public static readonly HostOperationDefinition Definition = HostOperationDefinition.Create<NoRequest, HostStatusData>(
        key: "settings.host-status",
        verb: HostHttpVerb.Get,
        route: "/api/settings/host-status",
        executionMode: HostExecutionMode.Local,
        displayName: "Get Host Status"
    );
}

public static class GetSchemaOperationContract {
    public static readonly HostOperationDefinition Definition = HostOperationDefinition.Create<SchemaRequest, SchemaEnvelopeResponse>(
        key: "settings.schema",
        verb: HostHttpVerb.Get,
        route: "/api/settings/schema",
        executionMode: HostExecutionMode.Local,
        displayName: "Get Schema"
    );
}

public static class GetWorkspacesOperationContract {
    public static readonly HostOperationDefinition Definition = HostOperationDefinition.Create<NoRequest, SettingsWorkspacesData>(
        key: "settings.workspaces",
        verb: HostHttpVerb.Get,
        route: "/api/settings/workspaces",
        executionMode: HostExecutionMode.Local,
        displayName: "Get Workspaces"
    );
}

public static class DiscoverSettingsTreeOperationContract {
    public static readonly HostOperationDefinition Definition = HostOperationDefinition.Create<SettingsTreeRequest, SettingsDiscoveryResult>(
        key: "settings.tree",
        verb: HostHttpVerb.Get,
        route: "/api/settings/tree",
        executionMode: HostExecutionMode.Local,
        displayName: "Discover Settings Tree"
    );
}

public static class GetFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition = HostOperationDefinition.Create<FieldOptionsRequest, FieldOptionsEnvelopeResponse>(
        key: "settings.field-options",
        verb: HostHttpVerb.Post,
        route: "/api/settings/field-options",
        executionMode: HostExecutionMode.Hybrid,
        displayName: "Get Field Options"
    );
}

public static class GetParameterCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ParameterCatalogRequest, ParameterCatalogEnvelopeResponse>(
            key: "settings.parameter-catalog",
            verb: HostHttpVerb.Post,
            route: "/api/settings/parameter-catalog",
            executionMode: HostExecutionMode.Bridge,
            displayName: "Get Parameter Catalog",
            cachePolicy: new HostCachePolicy("parameter-catalog", 300)
        );
}
