using Pe.Host.Contracts;

namespace Pe.Host.Services;

public sealed class HostRevitDataService(
    BridgeServer bridgeServer
) {
    private readonly BridgeServer _bridgeServer = bridgeServer;

    public async Task<ScheduleCatalogData> GetScheduleCatalogAsync(
        ScheduleCatalogRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (!this._bridgeServer.IsConnected)
            throw new InvalidOperationException("No Revit agent connected.");

        var response = await this._bridgeServer
            .InvokeAsync<ScheduleCatalogRequest, ScheduleCatalogEnvelopeResponse>(
                HubMethodNames.GetScheduleCatalogEnvelope,
                request,
                cancellationToken
            );
        return RequireData(response.Ok, response.Message, response.Data);
    }

    public async Task<LoadedFamiliesCatalogData> GetLoadedFamiliesCatalogAsync(
        LoadedFamiliesCatalogRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (!this._bridgeServer.IsConnected)
            throw new InvalidOperationException("No Revit agent connected.");

        var response = await this._bridgeServer
            .InvokeAsync<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogEnvelopeResponse>(
                HubMethodNames.GetLoadedFamiliesCatalogEnvelope,
                request,
                cancellationToken
            );
        return RequireData(response.Ok, response.Message, response.Data);
    }

    public async Task<LoadedFamiliesMatrixData> GetLoadedFamiliesMatrixAsync(
        LoadedFamiliesMatrixRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (!this._bridgeServer.IsConnected)
            throw new InvalidOperationException("No Revit agent connected.");

        var response = await this._bridgeServer
            .InvokeAsync<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixEnvelopeResponse>(
                HubMethodNames.GetLoadedFamiliesMatrixEnvelope,
                request,
                cancellationToken
            );
        return RequireData(response.Ok, response.Message, response.Data);
    }

    public async Task<ProjectParameterBindingsData> GetProjectParameterBindingsAsync(
        ProjectParameterBindingsRequest request,
        CancellationToken cancellationToken = default
    ) {
        if (!this._bridgeServer.IsConnected)
            throw new InvalidOperationException("No Revit agent connected.");

        var response = await this._bridgeServer
            .InvokeAsync<ProjectParameterBindingsRequest, ProjectParameterBindingsEnvelopeResponse>(
                HubMethodNames.GetProjectParameterBindingsEnvelope,
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
