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
            "Get Host Probe",
            HostOperationAgentMetadata.Create(
                "host",
                "Read Pe.Host health, version, and compatibility facts.",
                new[] { "status", "health", "probe", "compatibility" }
            )
        );
}

public static class GetHostSessionSummaryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, HostSessionSummaryData>(
            "settings.session-summary",
            HostHttpVerb.Get,
            $"{HttpRoutes.SettingsBase}/session-summary",
            HostExecutionMode.Local,
            "Get Host Session Summary",
            HostOperationAgentMetadata.Create(
                "host",
                "Read current host, bridge, session, active document, and workspace summary facts.",
                new[] { "status", "session", "bridge", "active-document", "workspace" }
            )
        );
}

public static class GetSchemaOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SchemaRequest, SchemaData>(
            "settings.schema",
            HostHttpVerb.Post,
            "/api/settings/schema",
            HostExecutionMode.Bridge,
            "Get Schema",
            HostOperationAgentMetadata.Create(
                "settings",
                "Read a settings schema from the connected Revit runtime.",
                new[] { "schema", "settings", "profile", "profiles", "module", "family-foundry" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}

public static class GetWorkspacesOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<GetSettingsWorkspacesRequest, SettingsWorkspacesData>(
            "settings.workspaces",
            HostHttpVerb.Post,
            "/api/settings/workspaces",
            HostExecutionMode.Local,
            "Get Workspaces",
            HostOperationAgentMetadata.Create(
                "settings",
                "Read available settings workspaces and storage roots.",
                new[] { "settings", "workspace", "storage", "roots" }
            )
        );
}

public static class DiscoverSettingsTreeOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SettingsTreeRequest, SettingsDiscoveryResult>(
            "settings.tree",
            HostHttpVerb.Post,
            "/api/settings/tree",
            HostExecutionMode.Local,
            "Discover Settings Tree",
            HostOperationAgentMetadata.Create(
                "settings",
                "Read the local settings tree for profiles, modules, and documents.",
                new[] { "settings", "tree", "discover", "documents", "profiles", "family-foundry" }
            )
        );
}

public static class GetSettingsModuleCatalogBridgeOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.CreateInternal<GetSettingsModuleCatalogBridgeRequest, GetSettingsModuleCatalogBridgeResponse>(
            "settings.module-catalog",
            HostExecutionMode.Bridge,
            "Get Settings Module Catalog",
            HostOperationAgentMetadata.Create(
                "settings",
                "Read the settings module catalog from Revit for bridge-side schema work.",
                new[] { "settings", "module", "catalog", "schema" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}

public static class GetFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<FieldOptionsRequest, FieldOptionsData>(
            "settings.field-options",
            HostHttpVerb.Post,
            "/api/settings/field-options",
            HostExecutionMode.Bridge,
            "Get Field Options",
            HostOperationAgentMetadata.Create(
                "settings",
                "Read document-specific field option values for a settings module.",
                new[] { "settings", "field-options", "schema", "document" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}

public static class GetParameterCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ParameterCatalogRequest, ParameterCatalogData>(
            "settings.parameter-catalog",
            HostHttpVerb.Post,
            "/api/settings/parameter-catalog",
            HostExecutionMode.Bridge,
            "Get Parameter Catalog",
            HostOperationAgentMetadata.Create(
                "settings",
                "Read Revit parameter definitions and available parameter facts from the active document for settings authoring.",
                new[] { "parameters", "catalog", "settings", "document" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}
