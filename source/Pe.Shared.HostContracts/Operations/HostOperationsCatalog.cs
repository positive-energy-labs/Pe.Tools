using System.Linq;
using Pe.Shared.RevitData;

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
        GetProjectBrowserOperationContract.Definition,
        GetProjectIndexOperationContract.Definition,
        GetSheetDetailsOperationContract.Definition,
        GetScheduleProfilesQueryOperationContract.Definition,
        GetScheduleQueryOperationContract.Definition,
        GetLoadedFamiliesCatalogOperationContract.Definition,
        GetLoadedFamiliesMatrixOperationContract.Definition,
        GetScheduleCoverageOperationContract.Definition,
        GetParameterCoverageOperationContract.Definition,
        GetConceptEvidenceOperationContract.Definition,
        GetParameterEvidenceOperationContract.Definition,
        GetProjectParameterBindingsOperationContract.Definition,
        GetElementContextQueryOperationContract.Definition,
        GetRevitAgentContextSummaryOperationContract.Definition,
        ResolveRevitAgentContextOperationContract.Definition,
        GetRevitAgentVisibleContextOperationContract.Definition,
        GetElectricalPanelsCatalogOperationContract.Definition,
        GetElectricalCircuitsCatalogOperationContract.Definition,
        GetElectricalPanelSchedulesQueryOperationContract.Definition,
        GetElectricalLoadClassificationsCatalogOperationContract.Definition,
        GetRevitDocumentSessionContextOperationContract.Definition,
        GetRevitRecentDocumentsOperationContract.Definition,
        OpenRevitDocumentOperationContract.Definition,
        OpenSettingsDocumentOperationContract.Definition,
        ValidateSettingsDocumentOperationContract.Definition,
        SaveSettingsDocumentOperationContract.Definition,
        GetScriptWorkspaceBootstrapOperationContract.Definition,
        ExecuteRevitScriptOperationContract.Definition,
        ImportScriptPodOperationContract.Definition,
        ExportScriptPodOperationContract.Definition
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

    public static HostTypeScriptClientCatalog TypeScriptClient { get; } = ValidateTypeScriptClient(
        new HostTypeScriptClientCatalog([
            new HostTypeScriptClientGroup(
                "host",
                "host",
                "HostClient",
                [
                    new HostTypeScriptClientOperation(
                        "getProbe",
                        GetHostProbeOperationContract.Definition,
                        HostClientRequestPolicy.None
                    ),
                    new HostTypeScriptClientOperation(
                        "getSessionSummary",
                        GetHostSessionSummaryOperationContract.Definition,
                        HostClientRequestPolicy.None
                    ),
                    new HostTypeScriptClientOperation(
                        "getLogs",
                        GetHostLogsOperationContract.Definition,
                        HostClientRequestPolicy.Explicit
                    )
                ]
            ),
            new HostTypeScriptClientGroup(
                "scripting",
                "scripting",
                "ScriptingClient",
                [
                    new HostTypeScriptClientOperation(
                        "bootstrapWorkspace",
                        GetScriptWorkspaceBootstrapOperationContract.Definition,
                        HostClientRequestPolicy.Explicit
                    ),
                    new HostTypeScriptClientOperation(
                        "execute",
                        ExecuteRevitScriptOperationContract.Definition,
                        HostClientRequestPolicy.Explicit
                    ),
                    new HostTypeScriptClientOperation(
                        "importPod",
                        ImportScriptPodOperationContract.Definition,
                        HostClientRequestPolicy.Explicit
                    ),
                    new HostTypeScriptClientOperation(
                        "exportPod",
                        ExportScriptPodOperationContract.Definition,
                        HostClientRequestPolicy.Explicit
                    )
                ]
            )
        ])
    );

    public static IReadOnlyList<HostOperationDefinition> TypeScriptClientSlice { get; } = TypeScriptClient.Groups
        .SelectMany(group => group.Operations)
        .Select(operation => operation.Definition)
        .ToArray();

    public static IReadOnlyList<Type> TypeScriptClientExtraTypeRoots { get; } = [
        typeof(RevitAgentContextSummaryData),
        typeof(RevitAgentVisibleCategorySummary)
    ];

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

        ValidateAgentMetadata(definitions);

        return definitions;
    }

    private static void ValidateAgentMetadata(IReadOnlyList<HostOperationDefinition> definitions) {
        var operationKeys = new HashSet<string>(definitions.Select(definition => definition.Key), StringComparer.Ordinal);
        var errors = new List<string>();

        foreach (var definition in definitions) {
            var metadata = definition.AgentMetadata;

            if (metadata.CallGuidance.Count > 2)
                errors.Add($"{definition.Key}: CallGuidance has {metadata.CallGuidance.Count} entries; max 2.");
            if (metadata.RequestExamples.Count > 2)
                errors.Add($"{definition.Key}: RequestExamples has {metadata.RequestExamples.Count} entries; max 2.");

            var duplicateRelations = metadata.RelatedOperations
                .GroupBy(operation => $"{operation.Kind}:{operation.Key}", StringComparer.Ordinal)
                .Where(group => group.Count() > 1)
                .Select(group => group.Key)
                .ToArray();
            if (duplicateRelations.Length != 0)
                errors.Add($"{definition.Key}: duplicate related operations {string.Join(", ", duplicateRelations)}.");

            foreach (var relatedOperation in metadata.RelatedOperations.Where(relatedOperation => !operationKeys.Contains(relatedOperation.Key)))
                errors.Add($"{definition.Key}: related operation key '{relatedOperation.Key}' does not exist.");

            if (!definition.IsPublicHttp)
                continue;

            var dotIndex = definition.Key.IndexOf(".", StringComparison.Ordinal);
            var topLevel = dotIndex < 0 ? definition.Key : definition.Key[..dotIndex];
            if (topLevel is "rvt" or "rfa" or "rvtrfa")
                errors.Add($"{definition.Key}: document kind must be metadata, not a top-level route family.");

            if (definition.Key.StartsWith("revit.", StringComparison.Ordinal) && !IsValidPublicRevitKey(definition.Key))
                errors.Add($"{definition.Key}: Revit public keys must follow revit.<layer>.<noun>[.<variant>].");
        }

        if (errors.Count != 0)
            throw new InvalidOperationException($"Invalid host operation metadata:{Environment.NewLine}  {string.Join($"{Environment.NewLine}  ", errors)}");
    }

    private static bool IsValidPublicRevitKey(string key) {
        var parts = key.Split('.');
        if (parts.Length is < 3 or > 4)
            return false;
        if (!string.Equals(parts[0], "revit", StringComparison.Ordinal))
            return false;
        return parts[1] is "context" or "catalog" or "matrix" or "detail" or "resolve" or "apply"
            && !string.IsNullOrWhiteSpace(parts[2])
            && (parts.Length == 3 || !string.IsNullOrWhiteSpace(parts[3]));
    }

    private static HostTypeScriptClientCatalog ValidateTypeScriptClient(
        HostTypeScriptClientCatalog catalog
    ) {
        var groups = catalog.Groups;
        var publicHttpKeys = new HashSet<string>(
            PublicHttp.Select(definition => definition.Key),
            StringComparer.Ordinal
        );
        var operations = groups.SelectMany(group => group.Operations).ToArray();

        var duplicateGroupKeys = groups
            .GroupBy(group => group.GroupKey, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateGroupKeys.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate TypeScript client group keys: {string.Join(", ", duplicateGroupKeys)}"
            );

        var duplicateClientProperties = groups
            .GroupBy(group => group.ClientPropertyName, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateClientProperties.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate TypeScript client property names: {string.Join(", ", duplicateClientProperties)}"
            );

        var duplicateClientClasses = groups
            .GroupBy(group => group.ClientClassName, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateClientClasses.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate TypeScript client class names: {string.Join(", ", duplicateClientClasses)}"
            );

        var duplicateOperationKeys = operations
            .GroupBy(operation => operation.Definition.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateOperationKeys.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate TypeScript client operation keys: {string.Join(", ", duplicateOperationKeys)}"
            );

        var duplicateMethods = groups
            .SelectMany(group => group.Operations
                .GroupBy(operation => operation.MethodName, StringComparer.Ordinal)
                .Where(methodGroup => methodGroup.Count() > 1)
                .Select(methodGroup => $"{group.GroupKey}.{methodGroup.Key}"))
            .ToList();
        if (duplicateMethods.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate TypeScript client methods: {string.Join(", ", duplicateMethods)}"
            );

        var invalidMethodMetadata = groups
            .SelectMany(group => group.Operations
                .Where(operation => string.IsNullOrWhiteSpace(operation.MethodName))
                .Select(operation => $"{group.GroupKey}.{operation.Definition.Key}"))
            .ToList();
        if (invalidMethodMetadata.Count != 0)
            throw new InvalidOperationException(
                $"Incomplete TypeScript client method metadata: {string.Join(", ", invalidMethodMetadata)}"
            );

        var missingPublicDefinitions = operations
            .Where(operation => !publicHttpKeys.Contains(operation.Definition.Key))
            .Select(operation => operation.Definition.Key)
            .ToList();
        if (missingPublicDefinitions.Count != 0)
            throw new InvalidOperationException(
                $"TypeScript client operations must be public HTTP operations: {string.Join(", ", missingPublicDefinitions)}"
            );

        var invalidRequestPolicies = operations
            .Where(operation =>
                (operation.RequestPolicy == HostClientRequestPolicy.None && operation.Definition.RequestType != typeof(NoRequest))
                || (operation.RequestPolicy == HostClientRequestPolicy.Explicit && operation.Definition.RequestType == typeof(NoRequest)))
            .Select(operation => $"{operation.Definition.Key} ({operation.RequestPolicy})")
            .ToList();
        if (invalidRequestPolicies.Count != 0)
            throw new InvalidOperationException(
                $"Invalid TypeScript client request policies: {string.Join(", ", invalidRequestPolicies)}"
            );

        _ = Validate(operations.Select(operation => operation.Definition).ToArray());
        return catalog;
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
