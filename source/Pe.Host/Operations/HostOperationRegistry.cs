using Pe.Shared.ApsAuth;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.HostContracts;
using Pe.Shared.Product;

namespace Pe.Host.Operations;

internal sealed class HostOperationRegistry {
    private readonly IReadOnlyDictionary<string, IHostOperation> _operationsByKey;

    public HostOperationRegistry() {
        IHostOperation[] localOperations = [
            HostOperations.Create<ApsTokenRequest>(
                GetApsAuthStatusOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.ApsAuthService.GetStatus(request)))
            ),
            HostOperations.Create<ApsTokenRequest>(
                LoginApsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.ApsAuthService.Login(request)))
            ),
            HostOperations.Create<NoRequest>(
                LogoutApsOperationContract.Definition,
                static (request, context, cancellationToken) => {
                    context.ApsAuthService.Logout();
                    return Task.FromResult(HostOperations.Local(new ApsLogoutResult(true)));
                }
            ),
            HostOperations.Create<ApsTokenRequest>(
                AcquireApsAccessTokenOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.ApsAuthService.AcquireAccessToken(request)))
            ),
            HostOperations.Create<NoRequest>(
                GetHostProbeOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateHostProbeData(context)))
            ),
            HostOperations.Create<NoRequest>(
                GetHostSessionSummaryOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateHostSessionSummaryData(context)))
            ),
            HostOperations.Create<HostLogsRequest>(
                GetHostLogsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateHostLogsData(request)))
            ),
            HostOperations.Create<GetSettingsWorkspacesRequest>(
                GetWorkspacesOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.GetWorkspacesAsync(request, cancellationToken))
            ),
            HostOperations.Create<SettingsTreeRequest>(
                DiscoverSettingsTreeOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.DiscoverAsync(request, cancellationToken))
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

        this.Operations = [
            .. localOperations,
            .. HostOperationsCatalog.Bridge.Select(definition => HostOperations.Bridge(definition))
        ];

        ValidateDefinitions(this.Operations);
        this._operationsByKey = this.Operations.ToDictionary(
            operation => operation.Definition.Key,
            StringComparer.Ordinal
        );
    }

    public IReadOnlyList<IHostOperation> Operations { get; }

    public bool TryGetByKey(string key, out IHostOperation operation) =>
        this._operationsByKey.TryGetValue(key, out operation!);

    private static HostLogsData CreateHostLogsData(HostLogsRequest request) {
        if (request.TailLineCount <= 0)
            throw new ArgumentOutOfRangeException(nameof(request), "TailLineCount must be greater than zero.");

        var logs = ProductRuntimeLayout.ForCurrentUser().Logs;
        HostLogFileData[] files = request.Target switch {
            HostLogTarget.Host => [CreateHostLogFile("host", logs.HostLogPath, request.TailLineCount)],
            HostLogTarget.Revit => [CreateHostLogFile("revit", logs.RevitAppLogPath, request.TailLineCount)],
            HostLogTarget.All => [
                CreateHostLogFile("host", logs.HostLogPath, request.TailLineCount),
                CreateHostLogFile("revit", logs.RevitAppLogPath, request.TailLineCount)
            ],
            _ => throw new InvalidOperationException($"Unsupported log target '{request.Target}'.")
        };

        return new HostLogsData(files);
    }

    private static HostLogFileData CreateHostLogFile(string label, string filePath, int tailLineCount) {
        var lines = File.Exists(filePath)
            ? File.ReadAllLines(filePath)
            : [];
        var startIndex = Math.Max(0, lines.Length - tailLineCount);
        return new HostLogFileData(label, filePath, [.. lines.Skip(startIndex)]);
    }

    private static void ValidateDefinitions(IReadOnlyList<IHostOperation> operations) {
        var definitionKeys = operations.Select(operation => operation.Definition.Key).ToHashSet(StringComparer.Ordinal);
        var missingSharedDefinitions = HostOperationsCatalog.All
            .Where(definition => !definitionKeys.Contains(definition.Key))
            .Select(definition => definition.Key)
            .ToList();
        if (missingSharedDefinitions.Count != 0) {
            throw new InvalidOperationException(
                $"Host operation registry is missing shared host operations: {string.Join(", ", missingSharedDefinitions)}"
            );
        }

        var extraDefinitions = operations
            .Where(operation => !HostOperationsCatalog.All.Any(definition =>
                string.Equals(definition.Key, operation.Definition.Key, StringComparison.Ordinal)))
            .Select(operation => operation.Definition.Key)
            .ToList();
        if (extraDefinitions.Count != 0) {
            throw new InvalidOperationException(
                $"Host operation registry contains operations missing from the shared catalog: {string.Join(", ", extraDefinitions)}"
            );
        }

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
            .Where(operation => operation.Definition.IsPublicHttp)
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

    private static HostProbeData CreateHostProbeData(HostOperationContext context) {
        var snapshot = context.BridgeServer.GetSnapshot();
        return new HostProbeData(
            HostProcessIdentity.RuntimeIdentity,
            HostProtocol.ContractVersion,
            BridgeProtocol.ContractVersion,
            snapshot.BridgePath,
            snapshot.BridgeIsConnected,
            snapshot.DisconnectReason
        );
    }

    private static HostSessionSummaryData CreateHostSessionSummaryData(HostOperationContext context) {
        var snapshot = context.BridgeServer.GetSnapshot();
        var connectedSession = snapshot.ConnectedSession;
        return new HostSessionSummaryData(
            snapshot.BridgeIsConnected,
            connectedSession?.SessionId,
            connectedSession?.ProcessId,
            connectedSession?.RevitVersion,
            connectedSession?.RuntimeFramework,
            connectedSession?.OpenDocumentCount ?? 0,
            connectedSession == null
                ? null
                : new HostActiveDocumentSummary(
                    connectedSession.ActiveDocumentTitle,
                    connectedSession.ActiveDocumentKey,
                    connectedSession.ActiveDocumentPath,
                    connectedSession.ActiveDocumentIsFamilyDocument,
                    connectedSession.ActiveDocumentIsWorkshared,
                    connectedSession.ActiveDocumentIsModelInCloud,
                    connectedSession.ActiveDocumentCloudProjectGuid,
                    connectedSession.ActiveDocumentCloudModelGuid,
                    connectedSession.ActiveDocumentCloudModelUrn,
                    connectedSession.ActiveDocumentObservedAtUnixMs
                ),
            connectedSession?.AvailableModules ?? []
        );
    }
}
