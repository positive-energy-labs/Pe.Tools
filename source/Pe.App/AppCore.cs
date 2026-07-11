using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using Pe.App.Host;
using Pe.App.Services.AutoTag;
using Pe.App.Tasks;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Loader;
using Pe.Revit.Loader.Documents;
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
///     lane (versioned payload staged until Revit restart).
///     Shutdown must release every exclusive resource
///     (bridge socket, Revit event subscriptions); leaked memory is fine, leaked handles are not.
/// </summary>
public sealed class AppCore : IPePayload {
    private RevitTaskService? _revitTaskService;
    private BridgeConnectionSupervisor? _bridgeConnectionSupervisor;

    public void Startup(PePayloadContext context) {
        // Capture lane + install location from the loader once, so host/pea launchers resolve
        // sibling payloads honestly (installed lane via InstalledProduct; dev lane self-hosted).
        PeRuntimeContext.Capture(context);

        var app = context.Application;

        // The SDK document tracker is the app's single document-event surface: identity, MRU,
        // caches, AutoTag, and the bridge notifier all subscribe here instead of raw Revit events.
        // The SDK owns its teardown; nothing to unsubscribe in Shutdown.
        var documents = context.Documents;
        DocumentTrackerAccessor.Current = documents;
        DocumentCacheMaintenance.Wire(documents);
        documents.ViewActivated += (doc, viewId) => MruViewBuffer.Instance.RecordViewActivation(doc, viewId);
        documents.Closed += key => MruViewBuffer.Instance.RemoveDocumentViews(key);
        documents.Changed += OnDocumentChanged;

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

        // Every palette gets the switcher for free: the UI layer reads this provider slot.
        PaletteSwitcher.Provider = () => Commands.Palette.PaletteRegistry.Entries;

        // Shell pane for dockable palettes; registration can no-op if WPF is not ready or the shell already exists.
        try {
            var registered = PaletteDock.Register(app);
            Log.Information("Palette dock pane registration: {Outcome}",
                registered ? "registered" : "skipped (no WPF Application yet)");
        } catch (Exception ex) {
            Log.Warning(ex, "Palette dock pane registration failed; dock buttons will be hidden.");
        }

        TaskInitializer.RegisterAllTasks();

        AutoTagService.Instance.Initialize(app.ActiveAddInId, documents);
    }

    public void Shutdown() {
        DocumentTrackerAccessor.Current = null;

        this._bridgeConnectionSupervisor?.Dispose();
        this._bridgeConnectionSupervisor = null;
        this._revitTaskService?.Dispose();

        AutoTagService.Instance.Shutdown();
        HostRuntime.Shutdown();
        Log.CloseAndFlush();
    }

    private static void OnDocumentChanged(TrackedDocument tracked, DocumentChangedEventArgs e) {
        try {
            var doc = tracked.Resolve();

            // Check if any DataStorage elements with AutoTag settings were modified
            var autoTagStorageChanged = e.GetModifiedElementIds()
                .Select(id => doc.GetElement(id))
                .OfType<DataStorage>()
                .Any(ds => ds.Name.StartsWith("PE_Settings_AutoTagSettings"));

            if (autoTagStorageChanged) {
                Log.Information(
                    "AutoTag: Settings changed in document '{Title}'. Changes will apply on next document open.",
                    tracked.Title);
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
            .WriteTo.Sink(new DebugLogSink(outputTemplate), LogEventLevel.Debug)
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

internal sealed class DebugLogSink(string outputTemplate) : ILogEventSink {
    private readonly MessageTemplateTextFormatter _formatter = new(outputTemplate);

    public void Emit(LogEvent logEvent) {
        using var writer = new StringWriter();
        this._formatter.Format(logEvent, writer);
        System.Diagnostics.Debug.Write(writer.ToString());
    }
}
