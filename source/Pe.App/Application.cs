using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Nice3point.Revit.Toolkit.External;
using Pe.App.Services.AutoTag;
using Pe.App.Host;
using Pe.App.Tasks;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.SettingsRuntime.Modules.Schedules;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using ricaun.Revit.UI.Tasks;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Display;
using System.IO;

namespace Pe.App;

/// <summary>
///     Application entry point
/// </summary>
[UsedImplicitly]
public class Application : ExternalApplication {
    /// <summary>
    ///     RevitTaskService for executing code in Revit API context from async/WPF contexts.
    /// </summary>
    private static RevitTaskService? _revitTaskService;
    private static BridgeConnectionSupervisor? _bridgeConnectionSupervisor;

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

        // Initialize the host bridge metadata.
        HostRuntime.Initialize(
            revitTaskService,
            registry => {
                registry.RegisterModules(RevitSettingsRuntimeRegistration.StructuralModules);
                registry.RegisterRootBindings(RevitSettingsRuntimeRegistration.RootBindings);
                registry.RegisterModules(FamilyFoundrySettingsRegistration.StructuralModules);
                registry.RegisterRootBindings(FamilyFoundrySettingsRegistration.RootBindings);
            },
            reason => _bridgeConnectionSupervisor?.RequestReconnect(reason)
        );
        _bridgeConnectionSupervisor = new BridgeConnectionSupervisor(revitTaskService);
        _bridgeConnectionSupervisor.Start();
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
        _bridgeConnectionSupervisor?.Dispose();
        _bridgeConnectionSupervisor = null;
        _revitTaskService?.Dispose();

        // Shutdown AutoTag service
        AutoTagService.Instance.Shutdown();

        HostRuntime.Shutdown();

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
