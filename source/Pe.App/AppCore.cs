using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using Pe.App.Analytics;
using Pe.App.Host;
using Pe.App.Services.AutoTag;
using Pe.App.Tasks;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Global.Services.ParameterLinks;
using Pe.Revit.Loader;
using Pe.Revit.Loader.Documents;
using Pe.Revit.Tasks;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Display;
using System.IO;
using System.Reflection;

namespace Pe.App;

/// <summary>
///     The real application, hosted two ways: by <see cref="Application"/> in the dev lane
///     (Revit loads Pe.App directly, hot reload intact) and by Pe.Revit.Loader in the installed
///     lane (versioned payload staged until Revit restart).
///     Shutdown must release every exclusive resource
///     (bridge socket, Revit event subscriptions); leaked memory is fine, leaked handles are not.
/// </summary>
public sealed class AppCore : IPePayload {
    private RevitTaskQueue? _revitTaskQueue;
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
        documents.ViewActivated += (doc, _) => PostHogAnalytics.CurrentDocumentTitle = doc.Title;
        documents.Closed += key => MruViewBuffer.Instance.RemoveDocumentViews(key);
        documents.Changed += OnDocumentChanged;

        var revitTaskQueue = new RevitTaskQueue(app);
        this._revitTaskQueue = revitTaskQueue;
        RevitTaskAccessor.RunAsync = action => revitTaskQueue.Run(_ => action());

        CreateLogger();

        PostHogAnalytics.Initialize();
        PostHogAnalytics.Capture("app_boot", new Dictionary<string, object?> {
            ["component"] = "revit",
            ["version"] = typeof(AppCore).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            ["revit_version"] = context.Application.ControlledApplication.VersionNumber,
        });
        Autodesk.Windows.ComponentManager.ItemExecuted += OnRibbonItemExecuted;

        HostRuntime.Initialize(
            revitTaskQueue,
            registry => {
                registry.RegisterModules(RevitSettingsRuntimeRegistration.StructuralModules);
                registry.RegisterRootBindings(RevitSettingsRuntimeRegistration.RootBindings);
                registry.RegisterModules(FamilyFoundrySettingsRegistration.StructuralModules);
                registry.RegisterRootBindings(FamilyFoundrySettingsRegistration.RootBindings);
            },
            reason => this._bridgeConnectionSupervisor?.RequestReconnect(reason)
        );
        this._bridgeConnectionSupervisor = new BridgeConnectionSupervisor(revitTaskQueue);
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
        ParameterLinksService.Instance.Initialize(app.ActiveAddInId, documents);
    }

    public void Shutdown() {
        Autodesk.Windows.ComponentManager.ItemExecuted -= OnRibbonItemExecuted;
        DocumentTrackerAccessor.Current = null;

        this._bridgeConnectionSupervisor?.Dispose();
        this._bridgeConnectionSupervisor = null;

        AutoTagService.Instance.Shutdown();
        ParameterLinksService.Instance.Shutdown();
        HostRuntime.Shutdown();
        RevitTaskAccessor.RunAsync = null;
        this._revitTaskQueue?.Dispose();
        this._revitTaskQueue = null;
        Log.CloseAndFlush();
    }

    /// <summary>
    ///     Ribbon buttons bind Revit straight to command classes (no runtime wrapper), so click
    ///     analytics hook the one UI-level seam: AdWindows item execution, filtered to our commands.
    /// </summary>
    private static void OnRibbonItemExecuted(object? sender,
        Autodesk.Internal.Windows.RibbonItemExecutedEventArgs e) {
        var id = e.Item?.Id;
        if (id == null || !id.Contains("Pe.App.Commands")) return;
        PostHogAnalytics.Capture("ribbon_click", new Dictionary<string, object?> {
            ["component"] = "revit",
            ["command"] = e.Item?.Text,
            ["command_id"] = id,
        });
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
            .WriteTo.Sink(new PostHogExceptionSink(), LogEventLevel.Error)
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
