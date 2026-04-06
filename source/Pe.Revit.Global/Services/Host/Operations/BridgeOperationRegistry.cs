using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Revit.Global.Services.Host.Operations;

internal sealed class BridgeOperationRegistry {
    private readonly IReadOnlyDictionary<string, IBridgeOperation> _operationsByKey;

    public BridgeOperationRegistry() {
        this.Operations = [
            BridgeOperations.Create<FieldOptionsRequest, FieldOptionsEnvelopeResponse>(
                GetFieldOptionsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetFieldOptionsEnvelopeAsync(request)
            ),
            BridgeOperations.Create<ParameterCatalogRequest, ParameterCatalogEnvelopeResponse>(
                GetParameterCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetParameterCatalogEnvelopeAsync(request)
            ),
            BridgeOperations.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsEnvelopeResponse>(
                GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RequestService.GetLoadedFamiliesFilterFieldOptionsEnvelopeAsync(request)
            ),
            BridgeOperations.Create<ScheduleCatalogRequest, ScheduleCatalogEnvelopeResponse>(
                GetScheduleCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetScheduleCatalogEnvelopeAsync(request)
            ),
            BridgeOperations.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogEnvelopeResponse>(
                GetLoadedFamiliesCatalogOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetLoadedFamiliesCatalogEnvelopeAsync(request)
            ),
            BridgeOperations.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixEnvelopeResponse>(
                GetLoadedFamiliesMatrixOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetLoadedFamiliesMatrixEnvelopeAsync(request)
            ),
            BridgeOperations.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsEnvelopeResponse>(
                GetProjectParameterBindingsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    context.RevitDataRequestService.GetProjectParameterBindingsEnvelopeAsync(request)
            )
        ];

        var duplicateKeys = this.Operations
            .GroupBy(operation => operation.Definition.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateKeys.Count != 0) {
            throw new InvalidOperationException(
                $"Duplicate bridge operation keys detected: {string.Join(", ", duplicateKeys)}"
            );
        }

        this._operationsByKey = this.Operations.ToDictionary(
            operation => operation.Definition.Key,
            StringComparer.Ordinal
        );
    }

    public IReadOnlyList<IBridgeOperation> Operations { get; }

    public bool TryGet(string key, out IBridgeOperation operation) =>
        this._operationsByKey.TryGetValue(key, out operation!);
}
