using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Shared.HostContracts.Operations;

public static class GetLoadedFamiliesFilterSchemaOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, SchemaData>(
            "revit-data.loaded-families.filter-schema",
            HostHttpVerb.Get,
            "/api/revit-data/loaded-families/filter/schema",
            HostExecutionMode.Bridge,
            "Get Loaded Families Filter Schema"
        );
}

public static class GetLoadedFamiliesFilterFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
            "revit-data.loaded-families.filter-field-options",
            HostHttpVerb.Post,
            "/api/revit-data/loaded-families/filter/field-options",
            HostExecutionMode.Bridge,
            "Get Loaded Families Filter Field Options"
        );
}

public static class GetScheduleCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleCatalogRequest, ScheduleCatalogData>(
            "revit-data.schedule-catalog",
            HostHttpVerb.Post,
            "/api/revit-data/schedules/catalog",
            HostExecutionMode.Bridge,
            "Get Schedule Catalog"
        );
}

public static class GetScheduleProfilesQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
            "revit-data.schedule-profiles-query",
            HostHttpVerb.Post,
            "/api/revit-data/schedules/profiles/query",
            HostExecutionMode.Bridge,
            "Get Schedule Profiles Query"
        );
}

public static class GetScheduleQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleQueryRequest, ScheduleQueryData>(
            "revit-data.schedule-query",
            HostHttpVerb.Post,
            "/api/revit-data/schedules/query",
            HostExecutionMode.Bridge,
            "Get Schedule Query"
        );
}

public static class GetLoadedFamiliesCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
            "revit-data.loaded-families.catalog",
            HostHttpVerb.Post,
            "/api/revit-data/loaded-families/catalog",
            HostExecutionMode.Bridge,
            "Get Loaded Families Catalog"
        );
}

public static class GetLoadedFamiliesMatrixOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
            "revit-data.loaded-families.matrix",
            HostHttpVerb.Post,
            "/api/revit-data/loaded-families/matrix",
            HostExecutionMode.Bridge,
            "Get Loaded Families Matrix"
        );
}

public static class GetProjectParameterBindingsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
            "revit-data.project-parameter-bindings",
            HostHttpVerb.Post,
            "/api/revit-data/project-parameter-bindings",
            HostExecutionMode.Bridge,
            "Get Project Parameter Bindings"
        );
}
