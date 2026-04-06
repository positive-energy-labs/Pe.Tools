using Pe.Shared.Host.Contracts.RevitData;
using Pe.Shared.Host.Contracts.SettingsStorage;

namespace Pe.Shared.Host.Contracts.Operations;

public static class GetLoadedFamiliesFilterSchemaOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, SchemaEnvelopeResponse>(
            "revit-data.loaded-families.filter-schema",
            HostHttpVerb.Get,
            "/api/revit-data/loaded-families/filter/schema",
            HostExecutionMode.Local,
            "Get Loaded Families Filter Schema"
        );
}

public static class GetLoadedFamiliesFilterFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsEnvelopeResponse>(
            "revit-data.loaded-families.filter-field-options",
            HostHttpVerb.Post,
            "/api/revit-data/loaded-families/filter/field-options",
            HostExecutionMode.Bridge,
            "Get Loaded Families Filter Field Options"
        );
}

public static class GetScheduleCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleCatalogRequest, ScheduleCatalogEnvelopeResponse>(
            "revit-data.schedule-catalog",
            HostHttpVerb.Post,
            "/api/revit-data/schedules/catalog",
            HostExecutionMode.Bridge,
            "Get Schedule Catalog",
            new HostCachePolicy("schedule-catalog", 10)
        );
}

public static class GetLoadedFamiliesCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogEnvelopeResponse>(
            "revit-data.loaded-families.catalog",
            HostHttpVerb.Post,
            "/api/revit-data/loaded-families/catalog",
            HostExecutionMode.Bridge,
            "Get Loaded Families Catalog",
            new HostCachePolicy("loaded-families-catalog", 10)
        );
}

public static class GetLoadedFamiliesMatrixOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixEnvelopeResponse>(
            "revit-data.loaded-families.matrix",
            HostHttpVerb.Post,
            "/api/revit-data/loaded-families/matrix",
            HostExecutionMode.Bridge,
            "Get Loaded Families Matrix"
        );
}

public static class GetProjectParameterBindingsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsEnvelopeResponse>(
            "revit-data.project-parameter-bindings",
            HostHttpVerb.Post,
            "/api/revit-data/project-parameter-bindings",
            HostExecutionMode.Bridge,
            "Get Project Parameter Bindings",
            new HostCachePolicy("project-parameter-bindings", 10)
        );
}