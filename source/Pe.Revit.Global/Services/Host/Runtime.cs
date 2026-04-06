using Pe.Global.Services.Document;
using Pe.StorageRuntime.Modules;
using ricaun.Revit.UI.Tasks;
using Serilog;
using System.Runtime.InteropServices;

namespace Pe.Global.Services.Host;

public record RuntimeActionResult(
    bool Success,
    string Message
);

public record RuntimeStatus(
    bool IsInitialized,
    bool IsConnected,
    string PipeName,
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
    private static HostConnectionOptions _connectionOptions = HostConnectionOptions.FromEnvironment();
    private static SettingsModuleRegistry? _moduleRegistry;
    private static RevitTaskService? _revitTaskService;
    private static string? _lastError;

    public static void Initialize(
        RevitTaskService revitTaskService,
        Action<SettingsModuleRegistry>? configureModules = null
    ) {
        lock (Sync) {
            Log.Information("Settings editor runtime initializing.");
            _connectionOptions = HostConnectionOptions.FromEnvironment();
            var registry = new SettingsModuleRegistry();
            configureModules?.Invoke(registry);
            _moduleRegistry = registry;
            _revitTaskService = revitTaskService;
            _lastError = null;
            Log.Information(
                "Settings editor runtime initialized: Pipe={PipeName}, ConnectTimeoutMs={ConnectTimeoutMs}, Modules={ModuleCount}",
                _connectionOptions.PipeName,
                _connectionOptions.ConnectTimeoutMs,
                registry.GetModules().Count()
            );
        }
    }

    public static RuntimeActionResult Connect() {
        lock (Sync) {
            if (_moduleRegistry == null)
                return new RuntimeActionResult(false, "Host runtime is not initialized.");

            if (_revitTaskService == null)
                return new RuntimeActionResult(false, "Revit task service is not initialized.");

            if (_agent is { IsConnected: true })
                return new RuntimeActionResult(true, "Bridge is already connected.");

            var connectStopwatch = Stopwatch.StartNew();
            Log.Information(
                "Settings editor runtime connect starting: Pipe={PipeName}, ConnectTimeoutMs={ConnectTimeoutMs}, Modules={ModuleCount}, ActiveDocument={ActiveDocumentTitle}",
                _connectionOptions.PipeName,
                _connectionOptions.ConnectTimeoutMs,
                _moduleRegistry.GetModules().Count(),
                DocumentManager.GetActiveDocument()?.Title
            );

            var disposeStopwatch = Stopwatch.StartNew();
            _agent?.Dispose();
            Log.Information("Settings editor runtime cleared existing bridge agent in {ElapsedMs} ms.",
                disposeStopwatch.ElapsedMilliseconds);
            _agent = null;

            try {
                var createStopwatch = Stopwatch.StartNew();
                _agent = new BridgeAgent(_moduleRegistry, _connectionOptions, _revitTaskService);
                Log.Information(
                    "Settings editor runtime connect completed in {ElapsedMs} ms. Bridge agent created in {AgentCreateElapsedMs} ms.",
                    connectStopwatch.ElapsedMilliseconds,
                    createStopwatch.ElapsedMilliseconds
                );
                _lastError = null;
                return new RuntimeActionResult(
                    true,
                    $"Connected to host on pipe '{_connectionOptions.PipeName}'."
                );
            } catch (Exception ex) {
                _lastError = ex.Message;
                _agent?.Dispose();
                _agent = null;
                Log.Error(
                    ex,
                    "Settings editor runtime connect failed after {ElapsedMs} ms: Pipe={PipeName}, ConnectTimeoutMs={ConnectTimeoutMs}",
                    connectStopwatch.ElapsedMilliseconds,
                    _connectionOptions.PipeName,
                    _connectionOptions.ConnectTimeoutMs
                );
                return new RuntimeActionResult(
                    false,
                    $"Failed to connect to host on pipe '{_connectionOptions.PipeName}': {ex.Message}"
                );
            }
        }
    }

    public static RuntimeActionResult Disconnect() {
        lock (Sync) {
            if (_agent == null)
                return new RuntimeActionResult(true, "Bridge is already disconnected.");

            var disconnectStopwatch = Stopwatch.StartNew();
            Log.Information("Settings editor runtime disconnect starting: Pipe={PipeName}",
                _connectionOptions.PipeName);
            _agent.Dispose();
            _agent = null;
            Log.Information("Settings editor runtime disconnect completed in {ElapsedMs} ms.",
                disconnectStopwatch.ElapsedMilliseconds);
            return new RuntimeActionResult(true, "Disconnected from host.");
        }
    }

    public static void Shutdown() {
        lock (Sync) {
            var shutdownStopwatch = Stopwatch.StartNew();
            Log.Information("Settings editor runtime shutdown starting.");
            _agent?.Dispose();
            _agent = null;
            Log.Information("Settings editor runtime shutdown completed in {ElapsedMs} ms.",
                shutdownStopwatch.ElapsedMilliseconds);
        }
    }

    public static RuntimeStatus GetStatus() {
        lock (Sync) {
            if (_agent != null) {
                return _agent.GetStatus() with {
                    IsInitialized = _moduleRegistry != null,
                    PipeName = _connectionOptions.PipeName,
                    LastError = _lastError ?? _agent.LastError
                };
            }

            return new RuntimeStatus(
                _moduleRegistry != null,
                false,
                _connectionOptions.PipeName,
                DocumentManager.GetActiveDocument() != null,
                DocumentManager.GetActiveDocument()?.Title,
                _moduleRegistry?.GetModules().Count() ?? 0,
                Revit.Utils.Utils.GetRevitVersion(),
                RuntimeInformation.FrameworkDescription,
                _lastError
            );
        }
    }
}