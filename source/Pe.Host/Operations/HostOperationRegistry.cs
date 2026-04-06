using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host.Operations;

internal sealed class HostOperationRegistry {
    private readonly IReadOnlyDictionary<string, IHostOperation> _operationsByKey;

    public HostOperationRegistry() {
        this.Operations = [
            HostOperations.Create<NoRequest>(
                GetHostStatusOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateHostStatusData(context)))
            ),
            HostOperations.Create<SchemaRequest>(
                GetSchemaOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.SchemaService.GetSchemaEnvelope(request)))
            ),
            HostOperations.Create<NoRequest>(
                GetWorkspacesOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.StorageService.GetWorkspaces()))
            ),
            HostOperations.Create<SettingsTreeRequest>(
                DiscoverSettingsTreeOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.DiscoverAsync(request, cancellationToken))
            ),
            HostOperations.Bridge<FieldOptionsRequest, FieldOptionsEnvelopeResponse>(
                GetFieldOptionsOperationContract.Definition
            ),
            HostOperations.Bridge<ParameterCatalogRequest, ParameterCatalogEnvelopeResponse>(
                GetParameterCatalogOperationContract.Definition
            ),
            HostOperations.Bridge<ScheduleCatalogRequest, ScheduleCatalogEnvelopeResponse>(
                GetScheduleCatalogOperationContract.Definition
            ),
            HostOperations.Create<NoRequest>(
                GetLoadedFamiliesFilterSchemaOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.SchemaService.GetLoadedFamiliesFilterSchemaEnvelope()))
            ),
            HostOperations.Bridge<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsEnvelopeResponse>(
                GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition
            ),
            HostOperations.Bridge<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogEnvelopeResponse>(
                GetLoadedFamiliesCatalogOperationContract.Definition
            ),
            HostOperations.Bridge<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixEnvelopeResponse>(
                GetLoadedFamiliesMatrixOperationContract.Definition
            ),
            HostOperations.Bridge<ProjectParameterBindingsRequest, ProjectParameterBindingsEnvelopeResponse>(
                GetProjectParameterBindingsOperationContract.Definition
            ),
            HostOperations.Create<OpenSettingsDocumentRequest>(
                OpenSettingsDocumentOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.OpenAsync(request, cancellationToken))
            ),
            HostOperations.Create<ValidateSettingsDocumentRequest>(
                ValidateSettingsDocumentOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.ValidateAsync(request, cancellationToken))
            ),
            HostOperations.Create<SaveSettingsDocumentRequest>(
                SaveSettingsDocumentOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.SaveAsync(request, cancellationToken))
            )
        ];

        ValidateUniqueDefinitions(this.Operations);
        this._operationsByKey = this.Operations.ToDictionary(
            operation => operation.Definition.Key,
            StringComparer.Ordinal
        );
    }

    public IReadOnlyList<IHostOperation> Operations { get; }

    public bool TryGetByKey(string key, out IHostOperation operation) =>
        this._operationsByKey.TryGetValue(key, out operation!);

    private static void ValidateUniqueDefinitions(IReadOnlyList<IHostOperation> operations) {
        var duplicateKeys = operations
            .GroupBy(operation => operation.Definition.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateKeys.Count != 0) {
            throw new InvalidOperationException(
                $"Duplicate host operation keys detected: {string.Join(", ", duplicateKeys)}"
            );
        }

        var duplicateRoutes = operations
            .GroupBy(operation => $"{operation.Definition.Verb}:{operation.Definition.Route}", StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateRoutes.Count != 0) {
            throw new InvalidOperationException(
                $"Duplicate host operation routes detected: {string.Join(", ", duplicateRoutes)}"
            );
        }
    }

    private static HostStatusData CreateHostStatusData(HostOperationContext context) {
        var runtimeState = context.RuntimeStateService.GetState();
        var snapshot = runtimeState.BridgeSnapshot;

        return new HostStatusData(
            true,
            snapshot.BridgeIsConnected,
            snapshot.HasActiveDocument,
            snapshot.ActiveDocumentTitle,
            snapshot.RevitVersion,
            snapshot.RuntimeFramework,
            HostProtocol.ContractVersion,
            HostProtocol.Transport,
            typeof(BridgeServer).Assembly.GetName().Version?.ToString(),
            snapshot.BridgeContractVersion,
            snapshot.BridgeTransport,
            [.. runtimeState.AvailableModules],
            snapshot.DisconnectReason
        );
    }
}
