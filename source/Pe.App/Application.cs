using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Nice3point.Revit.Toolkit.External;
using Pe.App.Commands.Palette;
using Pe.Global.Services.AutoTag;
using Pe.Global.Services.Document;
using Pe.Tools.Commands;
using Pe.Tools.Commands.AutoTag;
using Pe.Tools.Commands.FamilyFoundry;
using Pe.Ui.Core;
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
    private static RevitTaskService _revitTaskService;

    public override void OnStartup() {
        // Subscribe to ViewActivated event for MRU tracking
        this.Application.ViewActivated += OnViewActivated;

        // Subscribe to DocumentClosing to clean up MRU buffer
        this.Application.ControlledApplication.DocumentClosing += OnDocumentClosing;

        // Subscribe to DocumentChanged for AutoTag settings change detection
        this.Application.ControlledApplication.DocumentChanged += OnDocumentChanged;

        // Initialize RevitTaskService for async/deferred execution in Revit API context
        _revitTaskService = new RevitTaskService(this.Application);
        _revitTaskService.Initialize();
        RevitTaskAccessor.RunAsync = async action => await _revitTaskService.Run(async () => await action());

        CreateLogger();
        this.CreateRibbon();

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

        return Result.Succeeded;
    }

    private static void OnViewActivated(object sender, ViewActivatedEventArgs e) {
        if (e?.CurrentActiveView == null) return;
        if (sender is not UIApplication) return;

        // Record view activation for MRU tracking
        DocumentManager.Instance.RecordViewActivation(e.CurrentActiveView.Document, e.CurrentActiveView.Id);
    }

    private static void OnDocumentClosing(object sender, DocumentClosingEventArgs e) {
        if (e?.Document == null) return;
        DocumentManager.Instance.OnDocumentClosed(e.Document);
    }

    private static void OnDocumentChanged(object sender, DocumentChangedEventArgs e) {
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

    private void CreateRibbon() {
        const string tabName = "PE TOOLS";

        var panelManage = this.Application.CreatePanel("Manage", tabName);
        var panelTools = this.Application.CreatePanel("Tools", tabName);
        var panelMigration = this.Application.CreatePanel("Migration", tabName);

        var manageStackButton = panelManage.AddPullDownButton("General");

        ButtonDataHydrator.AddButtonData([
            manageStackButton.AddPushButton<CmdApsAuthPKCE>("OAuth PKCE"),
            manageStackButton.AddPushButton<CmdApsAuthNormal>("OAuth Normal")
        ]);

        ButtonDataHydrator.AddButtonData([
            panelMigration.AddPushButton<CmdSchedulePalette>("Schedule Manager"),
            panelMigration.AddPushButton<CmdFFManager>("FF Manager"),
            panelMigration.AddPushButton<CmdFFManagerSnapshot>("FF Manager Snapshot"),
            panelMigration.AddPushButton<CmdFFMigrator>("FF Migrator"),
            panelMigration.AddPushButton<CmdFFMakeATVariants>("Make AT Variants"),
            panelMigration.AddPushButton<CmdFFParamAggregator>("FF Param Aggregator"),
            manageStackButton.AddPushButton<CmdCacheParametersService>("Cache Params Svc"),

            panelTools.AddPushButton<CmdPltCommands>("Command Palette"),
            panelTools.AddPushButton<CmdPltViews>("View Palette"),
            panelTools.AddPushButton<CmdPltMruViews>("MRU Views"),
            panelTools.AddPushButton<CmdPltFamilies>("Family Palette"),
            panelTools.AddPushButton<CmdPltFamilyElements>("Family Palette"),
            panelTools.AddPushButton<CmdTapMaker>("Tap Maker"),
            manageStackButton.AddPushButton<CmdAutoTag>("AutoTag")
        ]);
    }

    private static void CreateLogger() {
        const string outputTemplate = "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}";

        Log.Logger = new LoggerConfiguration()
            .WriteTo.Console(LogEventLevel.Debug, outputTemplate)
            .MinimumLevel.Debug()
            .CreateLogger();

        AppDomain.CurrentDomain.UnhandledException += (_, args) => {
            var exception = (Exception)args.ExceptionObject;
            Log.Fatal(exception, "Domain unhandled exception");
        };
    }
}