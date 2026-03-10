using Autodesk.Revit.UI;
using Pe.Global.Services.SignalR;
using Pe.Global.Services.Storage.Modules;
using Serilog;

namespace Pe.Global.Services.SettingsEditor;

public static partial class SettingsEditorRuntime {
    private static SettingsEditorServer? _server;

    static partial void StartCore(
        UIApplication uiApp,
        Action<SettingsModuleRegistry>? configureModules
    ) {
        try {
            if (_server != null) return;

            _server = new SettingsEditorServer();
            var startTask = _server.StartAsync(uiApp, configureModules: configureModules);
            _ = startTask.ContinueWith(task => {
                if (task.IsCompletedSuccessfully) {
                    Log.Information("SignalR settings editor server started successfully");
                    return;
                }

                if (task.Exception != null)
                    Log.Error(task.Exception, "Failed to start SignalR settings editor server");
            }, TaskScheduler.Default);
        } catch (Exception ex) {
            Log.Error(ex, "Failed to start SignalR settings editor server");
        }
    }

    static partial void StopCore() {
        _server?.Dispose();
        _server = null;
    }
}
