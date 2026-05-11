using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.Global.Services.Host.Operations;

internal sealed class BridgeOperationRegistry {
    private readonly IReadOnlyDictionary<string, IBridgeOperation> _operationsByKey;

    public BridgeOperationRegistry() {
        this.Operations = [
            BridgeOperations.Create<SchemaRequest, SchemaData>(
                GetSchemaOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetSchemaAsync(request)
            ),
            BridgeOperations.Create<FieldOptionsRequest, FieldOptionsData>(
                GetFieldOptionsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetFieldOptionsAsync(request)
            ),
            BridgeOperations.Create<GetSettingsModuleCatalogBridgeRequest, GetSettingsModuleCatalogBridgeResponse>(
                GetSettingsModuleCatalogBridgeOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetSettingsModuleCatalogAsync(request)
            ),
            BridgeOperations.Create<ParameterCatalogRequest, ParameterCatalogData>(
                GetParameterCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetParameterCatalogAsync(request)
            ),
            BridgeOperations.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
                GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetLoadedFamiliesFilterFieldOptionsAsync(request)
            ),
            BridgeOperations.Create<NoRequest, SchemaData>(
                GetLoadedFamiliesFilterSchemaOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetLoadedFamiliesFilterSchemaAsync()
            ),
            BridgeOperations.Create<ScheduleCatalogRequest, ScheduleCatalogData>(
                GetScheduleCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetScheduleCatalogAsync(request)
            ),
            BridgeOperations.Create<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
                GetScheduleProfilesQueryOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetScheduleProfilesQueryAsync(request)
            ),
            BridgeOperations.Create<ScheduleQueryRequest, ScheduleQueryData>(
                GetScheduleQueryOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetScheduleQueryAsync(request)
            ),
            BridgeOperations.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
                GetLoadedFamiliesCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetLoadedFamiliesCatalogAsync(request)
            ),
            BridgeOperations.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
                GetLoadedFamiliesMatrixOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetLoadedFamiliesMatrixAsync(request)
            ),
            BridgeOperations.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
                GetProjectParameterBindingsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetProjectParameterBindingsAsync(request)
            ),
            BridgeOperations.Create<ElementContextQueryRequest, ElementContextQueryData>(
                GetElementContextQueryOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetElementContextQueryAsync(request)
            ),
            BridgeOperations.Create<ElectricalPanelsCatalogRequest, ElectricalPanelsCatalogData>(
                GetElectricalPanelsCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetElectricalPanelsCatalogAsync(request)
            ),
            BridgeOperations.Create<ElectricalCircuitsCatalogRequest, ElectricalCircuitsCatalogData>(
                GetElectricalCircuitsCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetElectricalCircuitsCatalogAsync(request)
            ),
            BridgeOperations
                .Create<ElectricalPanelSchedulesQueryRequest, ElectricalPanelSchedulesQueryData>(
                    GetElectricalPanelSchedulesQueryOperationContract.Definition,
                    static (request, context, cancellationToken) =>
                        context.RevitDataRequestService.GetElectricalPanelSchedulesQueryAsync(request)
                ),
            BridgeOperations
                .Create<ElectricalLoadClassificationsCatalogRequest,
                    ElectricalLoadClassificationsCatalogData>(
                    GetElectricalLoadClassificationsCatalogOperationContract.Definition,
                    static (request, context, cancellationToken) =>
                        context.RevitDataRequestService.GetElectricalLoadClassificationsCatalogAsync(request)
                ),
            BridgeOperations.Create<NoRequest, RevitDocumentSessionContextData>(
                GetRevitDocumentSessionContextOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetRevitDocumentSessionContextAsync()
            ),
            BridgeOperations.Create<ScriptWorkspaceBootstrapRequest, ScriptWorkspaceBootstrapData>(
                GetScriptWorkspaceBootstrapOperationContract.Definition,
                ExecuteScriptWorkspaceBootstrapAsync
            ),
            BridgeOperations.Create<ExecuteRevitScriptRequest, ExecuteRevitScriptData>(
                ExecuteRevitScriptOperationContract.Definition,
                ExecuteRevitScriptAsync
            )
        ];

        ValidateDefinitions(this.Operations);

        this._operationsByKey = this.Operations.ToDictionary(
            operation => operation.Definition.Key,
            StringComparer.Ordinal
        );
    }

    public IReadOnlyList<IBridgeOperation> Operations { get; }

    public bool TryGet(string key, out IBridgeOperation operation) =>
        this._operationsByKey.TryGetValue(key, out operation!);


    private static async Task<ScriptWorkspaceBootstrapData> ExecuteScriptWorkspaceBootstrapAsync(
        ScriptWorkspaceBootstrapRequest request,
        BridgeOperationContext context,
        CancellationToken cancellationToken
    ) => await context.ScriptingMessageHandler.BootstrapWorkspaceAsync(request, cancellationToken);

    private static async Task<ExecuteRevitScriptData> ExecuteRevitScriptAsync(
        ExecuteRevitScriptRequest request,
        BridgeOperationContext context,
        CancellationToken cancellationToken
    ) => await context.ScriptingMessageHandler.ExecuteAsync(request, cancellationToken);

    private static void ValidateDefinitions(IReadOnlyList<IBridgeOperation> operations) {
        var duplicateKeys = operations
            .GroupBy(operation => operation.Definition.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateKeys.Count != 0) {
            throw new InvalidOperationException(
                $"Duplicate bridge operation keys detected: {string.Join(", ", duplicateKeys)}"
            );
        }

        var missingDefinitions = HostOperationsCatalog.All
            .Where(definition => definition.ExecutionMode == HostExecutionMode.Bridge)
            .Where(definition => operations.All(operation => operation.Definition.Key != definition.Key))
            .Select(definition => definition.Key)
            .ToList();
        if (missingDefinitions.Count != 0) {
            throw new InvalidOperationException(
                $"Bridge operation registry is missing shared host operations: {string.Join(", ", missingDefinitions)}"
            );
        }
    }
}
