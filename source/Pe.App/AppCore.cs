using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Pe.App.Host;
using Pe.App.Services.AutoTag;
using Pe.App.Tasks;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Loader;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using ricaun.Revit.UI.Tasks;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Display;
using System.IO;

namespace Pe.App;

/// <summary>
///     The real application, hosted two ways: by <see cref="Application"/> in the dev lane
///     (Revit loads Pe.App directly, hot reload intact) and by Pe.Revit.Loader in the installed
///     lane (versioned payload, live-swappable). Startup must tolerate IsFirstLoad=false — a
///     live swap re-binds commands and restarts services but must not touch the ribbon.
///     Shutdown runs on swap, not just Revit exit: it must release every exclusive resource
///     (bridge socket, Revit event subscriptions); leaked memory is fine, leaked handles are not.
/// </summary>
public sealed class AppCore : IPePayload {
    private RevitTaskService? _revitTaskService;
    private BridgeConnectionSupervisor? _bridgeConnectionSupervisor;
    private UIControlledApplication? _application;

    public void Startup(PePayloadContext context) {
        var app = context.Application;
        this._application = app;

        app.ViewActivated += OnViewActivated;
        app.ControlledApplication.DocumentClosing += OnDocumentClosing;
        app.ControlledApplication.DocumentChanged += OnDocumentChanged;

        // RevitTaskService for async/deferred execution in Revit API context
        var revitTaskService = new RevitTaskService(app);
        revitTaskService.Initialize();
        this._revitTaskService = revitTaskService;
        RevitTaskAccessor.RunAsync = async action => await revitTaskService.Run(async () => await action());

        CreateLogger();

        HostRuntime.Initialize(
            revitTaskService,
            registry => {
                registry.RegisterModules(RevitSettingsRuntimeRegistration.StructuralModules);
                registry.RegisterRootBindings(RevitSettingsRuntimeRegistration.RootBindings);
                registry.RegisterModules(FamilyFoundrySettingsRegistration.StructuralModules);
                registry.RegisterRootBindings(FamilyFoundrySettingsRegistration.RootBindings);
            },
            reason => this._bridgeConnectionSupervisor?.RequestReconnect(reason)
        );
        this._bridgeConnectionSupervisor = new BridgeConnectionSupervisor(revitTaskService);
        this._bridgeConnectionSupervisor.Start();

        ButtonRegistry.BuildRibbon(context, "PE TOOLS");

        TaskInitializer.RegisterAllTasks();

        AutoTagService.Instance.Initialize(app.ActiveAddInId, app);
    }

    public void Shutdown() {
        var app = this._application;
        if (app is not null) {
            app.ViewActivated -= OnViewActivated;
            app.ControlledApplication.DocumentClosing -= OnDocumentClosing;
            app.ControlledApplication.DocumentChanged -= OnDocumentChanged;
        }

        this._bridgeConnectionSupervisor?.Dispose();
        this._bridgeConnectionSupervisor = null;
        this._revitTaskService?.Dispose();

        AutoTagService.Instance.Shutdown();
        HostRuntime.Shutdown();
        Log.CloseAndFlush();
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
            }
        } catch (Exception ex) {
            // Don't crash on notification failure
            Log.Debug(ex, "AutoTag: Failed to process document changed event");
        }
    }

    private static void CreateLogger() {
        const string outputTemplate = "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}";
        var appLogFile = StorageClient.Default.Global().RevitAppLog();

        Log.Logger = new LoggerConfiguration()
            .WriteTo.Sink(new RevitAppLogSink(appLogFile, outputTemplate), LogEventLevel.Debug)
            .WriteTo.Debug(LogEventLevel.Debug, outputTemplate)
            .MinimumLevel.Debug()
            .CreateLogger();

        AppDomain.CurrentDomain.UnhandledException += (_, args) => {
            var exception = (Exception)args.ExceptionObject;
            Log.Fatal(exception, "Domain unhandled exception");
        };
    }
}

internal sealed class RevitAppLogSink(ManagedLogFile logFile, string outputTemplate) : ILogEventSink {
    private readonly MessageTemplateTextFormatter _formatter = new(outputTemplate);
    private readonly ManagedLogFile _logFile = logFile;

    public void Emit(LogEvent logEvent) {
        using var writer = new StringWriter();
        this._formatter.Format(logEvent, writer);
        this._logFile.Append(writer.ToString());
    }
}
