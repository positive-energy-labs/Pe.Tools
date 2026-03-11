using Microsoft.AspNetCore.SignalR;
using Pe.Host.Contracts;

namespace Pe.Host.Hubs;

public class BridgeHub : Hub {
    private readonly BridgeServer _bridgeServer;
    private readonly ILogger<BridgeHub> _logger;

    public BridgeHub(
        BridgeServer bridgeServer,
        ILogger<BridgeHub> logger
    ) {
        this._bridgeServer = bridgeServer;
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
        var snapshot = this._bridgeServer.GetSnapshot();
        return Task.FromResult(new HostStatusEnvelopeResponse(
            Ok: true,
            Code: EnvelopeCode.Ok,
            Message: BuildConnectionMessage(snapshot),
            Issues: [],
            Data: new HostStatusData(
                HostIsRunning: true,
                BridgeIsConnected: snapshot.BridgeIsConnected,
                HasActiveDocument: snapshot.HasActiveDocument,
                ActiveDocumentTitle: snapshot.ActiveDocumentTitle,
                RevitVersion: snapshot.RevitVersion,
                RuntimeFramework: snapshot.RuntimeFramework,
                HostContractVersion: HostProtocol.ContractVersion,
                HostTransport: HostProtocol.Transport,
                ServerVersion: typeof(BridgeServer).Assembly.GetName().Version?.ToString(),
                BridgeContractVersion: snapshot.BridgeContractVersion,
                BridgeTransport: snapshot.BridgeTransport,
                AvailableModules: snapshot.AvailableModules,
                DisconnectReason: snapshot.DisconnectReason
            )
        ));
    }

    public Task<SettingsCatalogEnvelopeResponse> GetSettingsCatalogEnvelope(SettingsCatalogRequest request) {
        var snapshot = this._bridgeServer.GetSnapshot();
        var targets = snapshot.AvailableModules
            .Where(module =>
                string.IsNullOrWhiteSpace(request.ModuleKey) ||
                module.ModuleKey.Equals(request.ModuleKey, StringComparison.OrdinalIgnoreCase))
            .Select(module => new SettingsCatalogItem(
                module.ModuleKey,
                $"{module.ModuleKey} / {module.SettingsTypeName} / {module.DefaultSubDirectory}",
                module.ModuleKey,
                module.DefaultSubDirectory
            ))
            .ToList();

        return Task.FromResult(new SettingsCatalogEnvelopeResponse(
            Ok: true,
            Code: EnvelopeCode.Ok,
            Message: snapshot.BridgeIsConnected
                ? $"Found {targets.Count} settings targets."
                : BuildConnectionMessage(snapshot),
            Issues: [],
            Data: new SettingsCatalogData(targets)
        ));
    }

    public Task<SchemaEnvelopeResponse> GetSchemaEnvelope(SchemaRequest request) =>
        this.ProxyAsync(
            HubMethodNames.GetSchemaEnvelope,
            request,
            () => new SchemaEnvelopeResponse(false, EnvelopeCode.Failed, "No Revit agent connected.", [], null),
            ex => new SchemaEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                ex.Message,
                [new ValidationIssue("$", null, "BridgeException", "error", ex.Message, "Reconnect the Revit bridge and retry.")],
                null
            )
        );

    public Task<FieldOptionsEnvelopeResponse> GetFieldOptionsEnvelope(FieldOptionsRequest request) =>
        this.ProxyAsync(
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
                [new ValidationIssue("$", null, "BridgeException", "error", ex.Message, "Reconnect the Revit bridge and retry.")],
                new FieldOptionsData(request.SourceKey, FieldOptionsMode.Suggestion, true, [])
            )
        );

    public Task<ValidationEnvelopeResponse> ValidateSettingsEnvelope(ValidateSettingsRequest request) =>
        this.ProxyAsync(
            HubMethodNames.ValidateSettingsEnvelope,
            request,
            () => new ValidationEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                "No Revit agent connected.",
                [],
                new ValidationData(false, [])
            ),
            ex => new ValidationEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                ex.Message,
                [new ValidationIssue("$", null, "BridgeException", "error", ex.Message, "Reconnect the Revit bridge and retry.")],
                new ValidationData(false, [new ValidationIssue("$", null, "BridgeException", "error", ex.Message, "Reconnect the Revit bridge and retry.")])
            )
        );

    public Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogEnvelope(ParameterCatalogRequest request) =>
        this.ProxyAsync(
            HubMethodNames.GetParameterCatalogEnvelope,
            request,
            () => new ParameterCatalogEnvelopeResponse(false, EnvelopeCode.Failed, "No Revit agent connected.", [], null),
            ex => new ParameterCatalogEnvelopeResponse(
                false,
                EnvelopeCode.Failed,
                ex.Message,
                [new ValidationIssue("$", null, "BridgeException", "error", ex.Message, "Reconnect the Revit bridge and retry.")],
                null
            )
        );

    private async Task<TResponse> ProxyAsync<TRequest, TResponse>(
        string method,
        TRequest request,
        Func<TResponse> disconnectedFactory,
        Func<Exception, TResponse> exceptionFactory
    ) {
        this._logger.LogInformation("BridgeHub proxy starting: ConnectionId={ConnectionId}, Method={Method}, BridgeConnected={BridgeConnected}", this.Context.ConnectionId, method, this._bridgeServer.IsConnected);
        if (!this._bridgeServer.IsConnected) {
            this._logger.LogWarning("BridgeHub rejected request because no Revit bridge is connected: ConnectionId={ConnectionId}, Method={Method}", this.Context.ConnectionId, method);
            return disconnectedFactory();
        }

        try {
            var response = await this._bridgeServer.InvokeAsync<TRequest, TResponse>(method, request, this.Context.ConnectionAborted);
            this._logger.LogInformation("BridgeHub proxy completed: ConnectionId={ConnectionId}, Method={Method}", this.Context.ConnectionId, method);
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
