using Pe.Host.Contracts;

namespace Pe.Host.Services;

public sealed class HostBrowserApiService(
    BridgeServer bridgeServer,
    HostSettingsEditorService editorService,
    HostSettingsRuntimeStateService runtimeStateService
) {
    private readonly BridgeServer _bridgeServer = bridgeServer;
    private readonly HostSettingsEditorService _editorService = editorService;
    private readonly HostSettingsRuntimeStateService _runtimeStateService = runtimeStateService;

    public HostStatusData GetHostStatus() {
        var runtimeState = this._runtimeStateService.GetState();
        var snapshot = runtimeState.BridgeSnapshot;

        return new HostStatusData(
            true,
            snapshot.BridgeIsConnected,
            runtimeState.ProviderMode,
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

    public SchemaData GetSchema(string moduleKey) {
        var response = this._editorService.GetSchemaEnvelope(new SchemaRequest(moduleKey));
        return RequireData(response.Ok, response.Message, response.Data);
    }

    public async Task<FieldOptionsData> GetFieldOptionsAsync(
        FieldOptionsRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (this._editorService.TryGetFieldOptionsEnvelopeLocally(request, out var localResponse))
            return RequireData(localResponse.Ok, localResponse.Message, localResponse.Data);

        if (!this._bridgeServer.IsConnected)
            throw new InvalidOperationException("No Revit agent connected.");

        var response = await this._bridgeServer.InvokeAsync<FieldOptionsRequest, FieldOptionsEnvelopeResponse>(
            HubMethodNames.GetFieldOptionsEnvelope,
            request,
            cancellationToken
        );
        return RequireData(response.Ok, response.Message, response.Data);
    }

    public async Task<ParameterCatalogData> GetParameterCatalogAsync(
        ParameterCatalogRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (!this._bridgeServer.IsConnected)
            throw new InvalidOperationException("No Revit agent connected.");

        var response =
            await this._bridgeServer.InvokeAsync<ParameterCatalogRequest, ParameterCatalogEnvelopeResponse>(
                HubMethodNames.GetParameterCatalogEnvelope,
                request,
                cancellationToken
            );
        return RequireData(response.Ok, response.Message, response.Data);
    }

    private static TData RequireData<TData>(bool ok, string message, TData? data) where TData : class {
        if (!ok || data == null)
            throw new InvalidOperationException(message);

        return data;
    }
}
