using System.Linq;

namespace Pe.Shared.HostContracts.Operations;

public static class HostOperationsCatalog {
    public static IReadOnlyList<HostOperationDefinition> All { get; } = Validate([
        GetApsAuthStatusOperationContract.Definition,
        LoginApsOperationContract.Definition,
        LogoutApsOperationContract.Definition,
        AcquireApsAccessTokenOperationContract.Definition,
        GetHostProbeOperationContract.Definition,
        GetHostSessionSummaryOperationContract.Definition,
        GetHostLogsOperationContract.Definition,
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
    ]);

    public static IReadOnlyList<HostOperationDefinition> PublicHttp { get; } = All
        .Where(definition => definition.IsPublicHttp)
        .ToArray();

    public static IReadOnlyList<HostOperationDefinition> Local { get; } = All
        .Where(definition => definition.ExecutionMode == HostExecutionMode.Local)
        .ToArray();

    public static IReadOnlyList<HostOperationDefinition> Bridge { get; } = All
        .Where(definition => definition.ExecutionMode == HostExecutionMode.Bridge)
        .ToArray();

    public static IReadOnlyList<HostOperationDefinition> PeaClientSlice { get; } = ValidatePeaClientSlice([
        GetHostProbeOperationContract.Definition,
        GetHostSessionSummaryOperationContract.Definition,
        GetHostLogsOperationContract.Definition,
        GetScriptWorkspaceBootstrapOperationContract.Definition,
        ExecuteRevitScriptOperationContract.Definition
    ]);

    private static IReadOnlyList<HostOperationDefinition> Validate(
        IReadOnlyList<HostOperationDefinition> definitions
    ) {
        var duplicateKeys = definitions
            .GroupBy(definition => definition.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateKeys.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate host operation keys: {string.Join(", ", duplicateKeys)}"
            );

        var duplicateRoutes = definitions
            .Where(definition => definition.Http != null)
            .GroupBy(definition => definition.Http!, HttpDescriptorComparer.Instance)
            .Where(group => group.Count() > 1)
            .Select(group => $"{group.Key.Verb} {group.Key.Route}")
            .ToList();
        if (duplicateRoutes.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate host operation routes: {string.Join(", ", duplicateRoutes)}"
            );

        var incompleteDefinitions = definitions
            .Where(definition =>
                string.IsNullOrWhiteSpace(definition.Key)
                || definition.RequestType == null
                || definition.ResponseType == null
                || (definition.IsPublicHttp && (
                    definition.Http == null
                    || string.IsNullOrWhiteSpace(definition.Http.Route)
                ))
                || (!definition.IsPublicHttp && definition.Http != null)
            )
            .Select(definition => definition.Key)
            .ToList();
        if (incompleteDefinitions.Count != 0)
            throw new InvalidOperationException(
                $"Incomplete host operation definitions: {string.Join(", ", incompleteDefinitions)}"
            );

        return definitions;
    }

    private static IReadOnlyList<HostOperationDefinition> ValidatePeaClientSlice(
        IReadOnlyList<HostOperationDefinition> definitions
    ) {
        var publicHttpKeys = new HashSet<string>(
            PublicHttp.Select(definition => definition.Key),
            StringComparer.Ordinal
        );
        var missingPublicDefinitions = definitions
            .Where(definition => !publicHttpKeys.Contains(definition.Key))
            .Select(definition => definition.Key)
            .ToList();
        if (missingPublicDefinitions.Count != 0)
            throw new InvalidOperationException(
                $"Pea client operations must be public HTTP operations: {string.Join(", ", missingPublicDefinitions)}"
            );

        return Validate(definitions);
    }

    private sealed class HttpDescriptorComparer : IEqualityComparer<HostHttpOperationDescriptor> {
        public static readonly HttpDescriptorComparer Instance = new();

        public bool Equals(HostHttpOperationDescriptor? x, HostHttpOperationDescriptor? y) =>
            x != null
            && y != null
            && x.Verb == y.Verb
            && string.Equals(x.Route, y.Route, StringComparison.OrdinalIgnoreCase);

        public int GetHashCode(HostHttpOperationDescriptor obj) =>
            ((int)obj.Verb * 397) ^ StringComparer.OrdinalIgnoreCase.GetHashCode(obj.Route);
    }
}
