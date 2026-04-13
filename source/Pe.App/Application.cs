using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Nice3point.Revit.Toolkit.External;
using Pe.App.Services.AutoTag;
using Pe.Tools.SettingsEditor;
using Pe.App.Tasks;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Scripting.Transport;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.SettingsCatalog;
using Pe.Revit.Ui.Core;
using ricaun.Revit.UI.Tasks;
using Serilog;
using Serilog.Events;

namespace Pe.Tools;

/// <summary>
///     Application entry point
/// </summary>
[UsedImplicitly]
public class Application : ExternalApplication {
    /// <summary>
    ///     RevitTaskService for executing code in Revit API context from async/WPF contexts.
    /// </summary>
    private static RevitTaskService? _revitTaskService;
    private static ScriptingPipeServer? _scriptingPipeServer;

    public override void OnStartup() {
        // Subscribe to ViewActivated event for MRU tracking
        this.Application.ViewActivated += OnViewActivated;

        // Subscribe to DocumentClosing to clean up MRU buffer
        this.Application.ControlledApplication.DocumentClosing += OnDocumentClosing;

        // Subscribe to DocumentChanged for AutoTag settings change detection
        this.Application.ControlledApplication.DocumentChanged += OnDocumentChanged;

        // Initialize RevitTaskService for async/deferred execution in Revit API context
        var revitTaskService = new RevitTaskService(this.Application);
        revitTaskService.Initialize();
        _revitTaskService = revitTaskService;
        RevitTaskAccessor.RunAsync = async action => await revitTaskService.Run(async () => await action());

        CreateLogger();

        // Initialize the settings editor bridge metadata. Bridge connection remains manual
        // unless PE_SETTINGS_BRIDGE_AUTO_CONNECT is explicitly enabled.
        HostRuntime.Initialize(revitTaskService, KnownSettingsRegistry.RegisterRevitModules);
        _scriptingPipeServer = new ScriptingPipeServer(new ScriptingPipeMessageHandler(
            () => DocumentManager.uiapp,
            message => Log.Information("Revit scripting notification: {Message}", message)
        ));

        TryAutoConnectBridge();
        this.CreateRibbon();

        // Initialize task registry
        TaskInitializer.RegisterAllTasks();

        // Initialize AutoTag service
        AutoTagService.Instance.Initialize(this.Application.ActiveAddInId, this.Application);
    }

    public new Result OnShutdown(UIControlledApplication app) {
        app.ViewActivated -= OnViewActivated;
        app.ControlledApplication.DocumentClosing -= OnDocumentClosing;
        app.ControlledApplication.DocumentChanged -= OnDocumentChanged;
        _revitTaskService?.Dispose();

        // Shutdown AutoTag service
        AutoTagService.Instance.Shutdown();

        HostRuntime.Shutdown();
        _scriptingPipeServer?.Dispose();
        _scriptingPipeServer = null;

        return Result.Succeeded;
    }

    private static void OnViewActivated(object? sender, ViewActivatedEventArgs e) {
        if (e?.CurrentActiveView == null) return;
        if (sender is not UIApplication) return;

        // Record view activation for MRU tracking
        DocumentManager.Instance.RecordViewActivation(e.CurrentActiveView.Document, e.CurrentActiveView.Id);
    }

    private static void OnDocumentClosing(object? sender, DocumentClosingEventArgs e) {
        if (e?.Document == null) return;
        DocumentManager.Instance.OnDocumentClosed(e.Document);

        // Clean up AutoTag settings for this document to prevent memory leak
        AutoTagService.Instance.CleanupDocument(e.Document);
    }

    private static void OnDocumentChanged(object? sender, DocumentChangedEventArgs e) {
        if (e?.GetDocument() == null) return;

        try {
            var doc = e.GetDocument();

            // Check if any DataStorage elements with AutoTag settings were modified
            var autoTagStorageChanged = e.GetModifiedElementIds()
                .Select(id => doc.GetElement(id))
                .OfType<DataStorage>()
                .Any(ds => ds.Name.StartsWith("PE_Settings_AutoTagSettings"));

            if (autoTagStorageChanged) {
                Log.Information(
                    "AutoTag: Settings changed in document '{Title}'. Changes will apply on next document open.",
                    doc.Title);

                // Optional: Show a toast notification (would require additional UI infrastructure)
                // For now, just log it - user will get changes on next reopen
            }
        } catch (Exception ex) {
            // Don't crash on notification failure
            Log.Debug(ex, "AutoTag: Failed to process document changed event");
        }
    }

    public override void OnShutdown() => Log.CloseAndFlush();

    private void CreateRibbon() => ButtonRegistry.BuildRibbon(this.Application, "PE TOOLS");

    private static void TryAutoConnectBridge() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.BridgeAutoConnectEnabledVariable);
        if (!bool.TryParse(configuredValue, out var isEnabled) || !isEnabled)
            return;

        var hostLaunchResult = SettingsEditorHostLauncher.EnsureRunning();
        if (!hostLaunchResult.Success) {
            Log.Warning(
                "Settings editor bridge auto-connect skipped because host startup failed: {Message}",
                hostLaunchResult.Message
            );
            return;
        }

        var connectResult = HostRuntime.Connect();
        if (connectResult.Success) {
            Log.Information("Settings editor bridge auto-connect succeeded: {Message}", connectResult.Message);
            return;
        }

        Log.Warning("Settings editor bridge auto-connect failed: {Message}", connectResult.Message);
    }

    private static void CreateLogger() {
        const string outputTemplate = "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}";

        Log.Logger = new LoggerConfiguration()
            .WriteTo.Console(LogEventLevel.Debug, outputTemplate)
            .WriteTo.Debug(LogEventLevel.Debug, outputTemplate) // Also write to Debug output (Visual Studio)
            .MinimumLevel.Debug()
            .CreateLogger();

        AppDomain.CurrentDomain.UnhandledException += (_, args) => {
            var exception = (Exception)args.ExceptionObject;
            Log.Fatal(exception, "Domain unhandled exception");
        };
    }
}
