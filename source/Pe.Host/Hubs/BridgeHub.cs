using Microsoft.AspNetCore.SignalR;
using Pe.Host.Contracts;
using Pe.Host.Services;

namespace Pe.Host.Hubs;

public class BridgeHub : Hub {
    private readonly BridgeServer _bridgeServer;
    private readonly HostSettingsEditorService _editorService;
    private readonly ILogger<BridgeHub> _logger;
    private readonly HostSettingsRuntimeStateService _runtimeStateService;

    public BridgeHub(
        BridgeServer bridgeServer,
        HostSettingsEditorService editorService,
        HostSettingsRuntimeStateService runtimeStateService,
        ILogger<BridgeHub> logger
    ) {
        this._bridgeServer = bridgeServer;
        this._editorService = editorService;
        this._runtimeStateService = runtimeStateService;
        this._logger = logger;
    }

    public override async Task OnConnectedAsync() {
        this._logger.LogInformation("BridgeHub connected: ConnectionId={ConnectionId}", this.Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception) {
        this._logger.LogInformation("BridgeHub disconnected: ConnectionId={ConnectionId}", this.Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public Task<HostStatusEnvelopeResponse> GetHostStatusEnvelope() {
        var runtimeState = this._runtimeStateService.GetState();
        var snapshot = runtimeState.BridgeSnapshot;
        return Task.FromResult(new HostStatusEnvelopeResponse(
            true,
            EnvelopeCode.Ok,
            BuildConnectionMessage(snapshot),
            [],
            new HostStatusData(
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
            )
        ));
    }

    public Task<SettingsCatalogEnvelopeResponse> GetSettingsCatalogEnvelope(SettingsCatalogRequest request) {
        var runtimeState = this._runtimeStateService.GetState();
        var snapshot = runtimeState.BridgeSnapshot;
        var targets = runtimeState.AvailableModules
            .Where(module =>
                string.IsNullOrWhiteSpace(request.ModuleKey) ||
                module.ModuleKey.Equals(request.ModuleKey, StringComparison.OrdinalIgnoreCase))
            .Select(module => new SettingsCatalogItem(
                module.ModuleKey,
                $"{module.ModuleKey} / {module.DefaultRootKey}",
                module.ModuleKey,
                module.DefaultRootKey
            ))
            .ToList();

        return Task.FromResult(new SettingsCatalogEnvelopeResponse(
            true,
            EnvelopeCode.Ok,
            snapshot.BridgeIsConnected
                ? $"Found {targets.Count} settings targets."
                : BuildConnectionMessage(snapshot),
            [],
            new SettingsCatalogData(targets)
        ));
    }

    public Task<SchemaEnvelopeResponse> GetSchemaEnvelope(SchemaRequest request) =>
        Task.FromResult(this._editorService.GetSchemaEnvelope(request));

    public Task<FieldOptionsEnvelopeResponse> GetFieldOptionsEnvelope(FieldOptionsRequest request) {
        if (this._editorService.TryGetFieldOptionsEnvelopeLocally(request, out var localResponse))
            return Task.FromResult(localResponse);

        return this.ProxyBridgeAsync(
            HubMethodNames.GetFieldOptionsEnvelope,
            request,
            () => new FieldOptionsEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                "No Revit agent connected.",
                [],
                new FieldOptionsData(request.SourceKey, FieldOptionsMode.Suggestion, true, [])
            ),
            ex => new FieldOptionsEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                ex.Message,
                [
                    new ValidationIssue("$", null, "BridgeException", "error", ex.Message,
                        "Reconnect the Revit bridge and retry.")
                ],
                new FieldOptionsData(request.SourceKey, FieldOptionsMode.Suggestion, true, [])
            )
        );
    }

    public Task<ValidationEnvelopeResponse> ValidateSettingsEnvelope(ValidateSettingsRequest request) =>
        Task.FromResult(this._editorService.ValidateSettingsEnvelope(request));

    public Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogEnvelope(ParameterCatalogRequest request) =>
        this.ProxyBridgeAsync(
            HubMethodNames.GetParameterCatalogEnvelope,
            request,
            () => new ParameterCatalogEnvelopeResponse(false, EnvelopeCode.Failed, "No Revit agent connected.", [],
                null),
            ex => new ParameterCatalogEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                ex.Message,
                [
                    new ValidationIssue("$", null, "BridgeException", "error", ex.Message,
                        "Reconnect the Revit bridge and retry.")
                ],
                null
            )
        );

    private async Task<TResponse> ProxyBridgeAsync<TRequest, TResponse>(
        string method,
        TRequest request,
        Func<TResponse> disconnectedFactory,
        Func<Exception, TResponse> exceptionFactory
    ) {
        this._logger.LogInformation(
            "BridgeHub proxy starting: ConnectionId={ConnectionId}, Method={Method}, BridgeConnected={BridgeConnected}",
            this.Context.ConnectionId, method, this._bridgeServer.IsConnected);
        if (!this._bridgeServer.IsConnected) {
            this._logger.LogWarning(
                "BridgeHub rejected request because no Revit bridge is connected: ConnectionId={ConnectionId}, Method={Method}",
                this.Context.ConnectionId, method);
            return disconnectedFactory();
        }

        try {
            var response =
                await this._bridgeServer.InvokeAsync<TRequest, TResponse>(method, request,
                    this.Context.ConnectionAborted);
            this._logger.LogInformation("BridgeHub proxy completed: ConnectionId={ConnectionId}, Method={Method}",
                this.Context.ConnectionId, method);
            return response;
        } catch (Exception ex) {
            this._logger.LogWarning(ex, "Bridge proxy failed for method {Method}", method);
            return exceptionFactory(ex);
        }
    }

    private static string BuildConnectionMessage(BridgeSnapshot snapshot) =>
        snapshot.BridgeIsConnected
            ? $"Bridge connected with {snapshot.AvailableModules.Count} available modules."
            : string.IsNullOrWhiteSpace(snapshot.DisconnectReason)
                ? "Host is running. No Revit agent is connected."
                : $"Host is running. No Revit agent is connected: {snapshot.DisconnectReason}";
}
