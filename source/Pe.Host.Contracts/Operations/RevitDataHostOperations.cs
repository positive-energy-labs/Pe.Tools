namespace Pe.Host.Contracts;

public static class GetLoadedFamiliesFilterSchemaOperationContract {
    public static readonly HostOperationDefinition Definition = HostOperationDefinition.Create<NoRequest, SchemaEnvelopeResponse>(
        key: "revit-data.loaded-families.filter-schema",
        verb: HostHttpVerb.Get,
        route: "/api/revit-data/loaded-families/filter/schema",
        executionMode: HostExecutionMode.Local,
        displayName: "Get Loaded Families Filter Schema"
    );
}

public static class GetLoadedFamiliesFilterFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsEnvelopeResponse>(
            key: "revit-data.loaded-families.filter-field-options",
            verb: HostHttpVerb.Post,
            route: "/api/revit-data/loaded-families/filter/field-options",
            executionMode: HostExecutionMode.Local,
            displayName: "Get Loaded Families Filter Field Options"
        );
}

public static class GetScheduleCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleCatalogRequest, ScheduleCatalogEnvelopeResponse>(
            key: "revit-data.schedule-catalog",
            verb: HostHttpVerb.Post,
            route: "/api/revit-data/schedules/catalog",
            executionMode: HostExecutionMode.Bridge,
            displayName: "Get Schedule Catalog",
            cachePolicy: new HostCachePolicy("schedule-catalog", 10)
        );
}

public static class GetLoadedFamiliesCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogEnvelopeResponse>(
            key: "revit-data.loaded-families.catalog",
            verb: HostHttpVerb.Post,
            route: "/api/revit-data/loaded-families/catalog",
            executionMode: HostExecutionMode.Bridge,
            displayName: "Get Loaded Families Catalog",
            cachePolicy: new HostCachePolicy("loaded-families-catalog", 10)
        );
}

public static class GetLoadedFamiliesMatrixOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixEnvelopeResponse>(
            key: "revit-data.loaded-families.matrix",
            verb: HostHttpVerb.Post,
            route: "/api/revit-data/loaded-families/matrix",
            executionMode: HostExecutionMode.Bridge,
            displayName: "Get Loaded Families Matrix"
        );
}

public static class GetProjectParameterBindingsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsEnvelopeResponse>(
            key: "revit-data.project-parameter-bindings",
            verb: HostHttpVerb.Post,
            route: "/api/revit-data/project-parameter-bindings",
            executionMode: HostExecutionMode.Bridge,
            displayName: "Get Project Parameter Bindings",
            cachePolicy: new HostCachePolicy("project-parameter-bindings", 10)
        );
}
