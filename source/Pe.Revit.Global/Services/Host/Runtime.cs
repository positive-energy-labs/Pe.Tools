using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Revit.Tasks;
using Serilog;
using System.Runtime.InteropServices;

namespace Pe.Revit.Global.Services.Host;

public record RuntimeActionResult(
    bool Success,
    string Message
);

public record RuntimeStatus(
    bool IsInitialized,
    bool IsConnected,
    string BridgeUri,
    int ProcessId,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    int AvailableModuleCount,
    string? RevitVersion,
    string? RuntimeFramework,
    string? LastError
);

/// <summary>
///     Manual lifecycle for the external host bridge.
/// </summary>
public static class HostRuntime {
    private static readonly object Sync = new();
    private static BridgeAgent? _agent;
    private static BridgeConnectionOptions _connectionOptions = BridgeConnectionOptions.FromEnvironment();
    private static SettingsRuntimeRegistry? _moduleRegistry;
    private static RevitTaskQueue? _revitTaskQueue;
    private static Action<string?>? _onDisconnected;
    private static string? _lastError;

    public static void Initialize(
        RevitTaskQueue revitTaskQueue,
        Action<SettingsRuntimeRegistry>? configureModules = null,
        Action<string?>? onDisconnected = null
    ) {
        lock (Sync) {
            Log.Information("Host runtime initializing.");
            _connectionOptions = BridgeConnectionOptions.FromEnvironment();
            var registry = new SettingsRuntimeRegistry();
            configureModules?.Invoke(registry);
            _moduleRegistry = registry;
            _revitTaskQueue = revitTaskQueue;
            _onDisconnected = onDisconnected;
            _lastError = null;
            Log.Information(
                "Host runtime initialized: BridgeUri={BridgeUri}, ConnectTimeoutMs={ConnectTimeoutMs}, Modules={ModuleCount}",
                _connectionOptions.BridgeUri,
                _connectionOptions.ConnectTimeoutMs,
                registry.GetModules().Count()
            );
        }
    }

    public static RuntimeActionResult Connect() {
        SettingsRuntimeRegistry? moduleRegistry;
        RevitTaskQueue? revitTaskQueue;
        BridgeConnectionOptions connectionOptions;
        BridgeAgent? previousAgent;

        lock (Sync) {
            if (_moduleRegistry == null)
                return new RuntimeActionResult(false, "Host runtime is not initialized.");

            if (_revitTaskQueue == null)
                return new RuntimeActionResult(false, "Revit task queue is not initialized.");

            if (_agent is { IsConnected: true })
                return new RuntimeActionResult(true, "Bridge is already connected.");

            moduleRegistry = _moduleRegistry;
            revitTaskQueue = _revitTaskQueue;
            connectionOptions = _connectionOptions;
            previousAgent = _agent;
            _agent = null;
        }

        var connectStopwatch = Stopwatch.StartNew();
        Log.Information(
            "Host runtime connect starting: BridgeUri={BridgeUri}, ConnectTimeoutMs={ConnectTimeoutMs}, Modules={ModuleCount}, ActiveDocument={ActiveDocumentTitle}",
            connectionOptions.BridgeUri,
            connectionOptions.ConnectTimeoutMs,
            moduleRegistry.GetModules().Count(),
            RevitUiSession.CurrentUIApplication.GetActiveDocument()?.Title
        );

        var disposeStopwatch = Stopwatch.StartNew();
        previousAgent?.Dispose();
        Log.Information(
            "Host runtime cleared existing bridge agent in {ElapsedMs} ms.",
            disposeStopwatch.ElapsedMilliseconds
        );

        BridgeAgent? newAgent = null;

        try {
            var createStopwatch = Stopwatch.StartNew();
            newAgent = new BridgeAgent(moduleRegistry, connectionOptions, revitTaskQueue, OnAgentDisconnected);

            lock (Sync) {
                _agent = newAgent;
                _lastError = null;
            }

            Log.Information(
                "Host runtime connect completed in {ElapsedMs} ms. Bridge agent created in {AgentCreateElapsedMs} ms.",
                connectStopwatch.ElapsedMilliseconds,
                createStopwatch.ElapsedMilliseconds
            );
            return new RuntimeActionResult(
                true,
                $"Connected to host bridge '{connectionOptions.BridgeUri}'."
            );
        } catch (Exception ex) {
            lock (Sync)
                _lastError = ex.Message;

            newAgent?.Dispose();
            Log.Error(
                ex,
                "Host runtime connect failed after {ElapsedMs} ms: BridgeUri={BridgeUri}, ConnectTimeoutMs={ConnectTimeoutMs}",
                connectStopwatch.ElapsedMilliseconds,
                connectionOptions.BridgeUri,
                connectionOptions.ConnectTimeoutMs
            );
            return new RuntimeActionResult(
                false,
                $"Failed to connect to host bridge '{connectionOptions.BridgeUri}': {ex.Message}"
            );
        }
    }

    public static RuntimeActionResult Disconnect() {
        lock (Sync) {
            if (_agent == null)
                return new RuntimeActionResult(true, "Bridge is already disconnected.");

            var disconnectStopwatch = Stopwatch.StartNew();
            Log.Information("Host runtime disconnect starting: BridgeUri={BridgeUri}",
                _connectionOptions.BridgeUri);
            _agent.Dispose();
            _agent = null;
            Log.Information("Host runtime disconnect completed in {ElapsedMs} ms.",
                disconnectStopwatch.ElapsedMilliseconds);
            return new RuntimeActionResult(true, "Disconnected from host.");
        }
    }

    public static void Shutdown() {
        lock (Sync) {
            var shutdownStopwatch = Stopwatch.StartNew();
            Log.Information("Host runtime shutdown starting.");
            _agent?.Dispose();
            _agent = null;
            Log.Information("Host runtime shutdown completed in {ElapsedMs} ms.",
                shutdownStopwatch.ElapsedMilliseconds);
        }
    }

    private static void OnAgentDisconnected(string? reason) {
        Action<string?>? onDisconnected;
        lock (Sync) {
            _lastError = reason;
            onDisconnected = _onDisconnected;
        }

        onDisconnected?.Invoke(reason);
    }

    public static RuntimeStatus GetStatus() {
        lock (Sync) {
            if (_agent != null) {
                return _agent.GetStatus() with {
                    IsInitialized = _moduleRegistry != null,
                    BridgeUri = _connectionOptions.BridgeUri.ToString(),
                    ProcessId = _connectionOptions.ProcessId,
                    LastError = _lastError ?? _agent.LastError
                };
            }

            var activeDocument = RevitUiSession.CurrentUIApplication.GetActiveDocument();
            return new RuntimeStatus(
                _moduleRegistry != null,
                false,
                _connectionOptions.BridgeUri.ToString(),
                _connectionOptions.ProcessId,
                activeDocument != null,
                activeDocument?.Title,
                _moduleRegistry?.GetModules().Count() ?? 0,
                RevitUiSession.CurrentUIApplication.Application.VersionNumber,
                RuntimeInformation.FrameworkDescription,
                _lastError
            );
        }
    }
}
