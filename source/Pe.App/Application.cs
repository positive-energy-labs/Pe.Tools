using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Nice3point.Revit.Toolkit.External;
using Pe.App.Commands.Palette;
// using Pe.Global.Services.AutoTag;
using Pe.Global.Services.Document;
using Pe.Global.Revit;
using Pe.Tools.Commands;
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

    /// <summary>
    ///     AutoTag updater instance for automatic element tagging.
    /// </summary>
    // public static AutoTagUpdater? AutoTagUpdater { get; private set; }

    public override void OnStartup() {
        // Subscribe to ViewActivated event for MRU tracking
        this.Application.ViewActivated += OnViewActivated;

        // Subscribe to DocumentClosing to clean up MRU buffer
        this.Application.ControlledApplication.DocumentClosing += OnDocumentClosing;

        // Initialize RevitTaskService for async/deferred execution in Revit API context
        _revitTaskService = new RevitTaskService(this.Application);
        _revitTaskService.Initialize();
        RevitTaskAccessor.RunAsync = async action => await _revitTaskService.Run(async () => await action());

        CreateLogger();
        this.CreateRibbon();
        // this.RegisterAutoTagUpdater();
    }

    public new Result OnShutdown(UIControlledApplication app) {
        // AppDomain.CurrentDomain.AssemblyResolve -= OnAssemblyResolve;
        app.ViewActivated -= OnViewActivated;
        app.ControlledApplication.DocumentClosing -= OnDocumentClosing;
        _revitTaskService?.Dispose();
        // this.UnregisterAutoTagUpdater();
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

    public override void OnShutdown() => Log.CloseAndFlush();

    private void CreateRibbon() {
        const string tabName = "PE TOOLS";

        var panelManage = this.Application.CreatePanel("Manage", tabName);
        var panelTools = this.Application.CreatePanel("Tools", tabName);
        var panelMigration = this.Application.CreatePanel("Migration", tabName);
        // var panelDev = this.Application.CreatePanel( "Dev", tabName);

        var manageStackButton = panelManage.AddPullDownButton("General");
        // var ffManagerStackButton = panelMigration.AddSplitButton("Manager");

        ButtonDataHydrator.AddButtonData([
            manageStackButton.AddPushButton<CmdApsAuthPKCE>("OAuth PKCE"),
            manageStackButton.AddPushButton<CmdApsAuthNormal>("OAuth Normal")
        ]);

        ButtonDataHydrator.AddButtonData([
            panelMigration.AddPushButton<CmdCreateSchedule>("Create Schedule"),
            panelMigration.AddPushButton<CmdSerializeSchedule>("Serialize Schedule"),
            panelMigration.AddPushButton<CmdFFManager>("FF Manager"),
            panelMigration.AddPushButton<CmdFFManagerSnapshot>("FF Manager Snapshot"),
            panelMigration.AddPushButton<CmdFFMigrator>("FF Migrator"),
            panelMigration.AddPushButton<CmdFFMakeATVariants>("Make AT Variants"),
            panelMigration.AddPushButton<CmdFFParamAggregator>("FF Param Aggregator"),
            manageStackButton.AddPushButton<CmdCacheParametersService>("Cache Params Svc"),
            // manageStackButton.AddPushButton<CmdTestSettingsEditor>("Test Settings Editor"),

            panelTools.AddPushButton<CmdPltCommands>("Command Palette"),
            panelTools.AddPushButton<CmdPltViews>("View Palette"),
            panelTools.AddPushButton<CmdPltMruViews>("MRU Views"),
            panelTools.AddPushButton<CmdPltFamilies>("Family Palette"),
            panelTools.AddPushButton<CmdPltFamilyElements>("Family Palette"),
            panelTools.AddPushButton<CmdTapMaker>("Tap Maker"),
            // manageStackButton.AddPushButton<CmdAutoTag>("AutoTag Settings")
        ]);
    }

    private static void CreateLogger() {
        const string outputTemplate = "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}";

        Log.Logger = new LoggerConfiguration()
            .WriteTo.Debug(LogEventLevel.Debug, outputTemplate)
            .MinimumLevel.Debug()
            .CreateLogger();

        AppDomain.CurrentDomain.UnhandledException += (_, args) => {
            var exception = (Exception)args.ExceptionObject;
            Log.Fatal(exception, "Domain unhandled exception");
        };
    }

    // /// <summary>
    // ///     Registers the AutoTag updater and sets up triggers for configured categories.
    // /// </summary>
    // private void RegisterAutoTagUpdater() {
    //     try {
    //         // Create and register updater
    //         AutoTagUpdater = new AutoTagUpdater(this.Application.ActiveAddInId);
    //         UpdaterRegistry.RegisterUpdater(AutoTagUpdater, isOptional: true);
    //
    //         // Load settings to determine which categories to monitor
    //         var storage = Pe.Global.Services.Storage.Storage.GlobalDir()
    //             .StateJson<AutoTagSettings>("autotag-settings");
    //         AutoTagSettings? settings = null;
    //
    //         if (storage is Pe.Global.Services.Storage.JsonReader<AutoTagSettings> reader && 
    //             File.Exists(reader.FilePath)) {
    //             settings = reader.Read();
    //         }
    //
    //         // If settings exist and are enabled, register triggers
    //         if (settings?.Enabled == true && settings.Configurations.Count > 0) {
    //             // Get a sample document to resolve category names
    //             // Note: We register triggers globally, they'll apply to all documents
    //             var enabledConfigs = settings.Configurations.Where(c => c.Enabled).ToList();
    //
    //             if (enabledConfigs.Count > 0) {
    //                 // Register triggers for each enabled category
    //                 // We'll use a dummy document context or register on document opened
    //                 this.Application.ControlledApplication.DocumentOpened += OnDocumentOpenedForTriggers;
    //                 Log.Information("AutoTag: Updater registered, triggers will be set on document open");
    //             } else {
    //                 Log.Information("AutoTag: Updater registered but no enabled configurations");
    //             }
    //         } else {
    //             Log.Information("AutoTag: Updater registered but disabled in settings");
    //         }
    //     } catch (Exception ex) {
    //         Log.Error(ex, "AutoTag: Failed to register updater");
    //     }
    // }
    //
    // /// <summary>
    // ///     Event handler to register AutoTag triggers when a document is opened.
    // ///     This is necessary because we need a document context to resolve category names to BuiltInCategory.
    // /// </summary>
    // private void OnDocumentOpenedForTriggers(object sender, DocumentOpenedEventArgs e) {
    //     try {
    //         var doc = e.Document;
    //         if (doc == null || AutoTagUpdater == null) return;
    //
    //         // Check if triggers already registered for this updater
    //         var updaterId = AutoTagUpdater.GetUpdaterId();
    //         if (UpdaterRegistry.IsUpdaterRegistered(updaterId, doc)) {
    //             // Triggers might already be set, check if we need to update them
    //             var existingTriggers = UpdaterRegistry.GetRegisteredTriggers(updaterId, doc);
    //             if (existingTriggers.Any()) {
    //                 // Triggers already set, skip
    //                 return;
    //             }
    //         }
    //
    //         // Load settings
    //         var storage = Pe.Global.Services.Storage.Storage.GlobalDir()
    //             .StateJson<AutoTagSettings>("autotag-settings");
    //         
    //         if (storage is not Pe.Global.Services.Storage.JsonReader<AutoTagSettings> reader || 
    //             !File.Exists(reader.FilePath)) {
    //             return;
    //         }
    //
    //         var settings = reader.Read();
    //         if (settings?.Enabled != true || settings.Configurations.Count == 0) return;
    //
    //         // Register triggers for each enabled category
    //         foreach (var config in settings.Configurations.Where(c => c.Enabled)) {
    //             try {
    //                 var builtInCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, config.CategoryName);
    //                 if (builtInCategory == BuiltInCategory.INVALID) {
    //                     Log.Warning($"AutoTag: Invalid category '{config.CategoryName}', skipping trigger");
    //                     continue;
    //                 }
    //
    //                 // Create filter for this category
    //                 var filter = new ElementCategoryFilter(builtInCategory);
    //
    //                 // Add trigger for element addition
    //                 UpdaterRegistry.AddTrigger(
    //                     updaterId,
    //                     doc,
    //                     filter,
    //                     Element.GetChangeTypeElementAddition()
    //                 );
    //
    //                 Log.Debug($"AutoTag: Registered trigger for category '{config.CategoryName}'");
    //             } catch (Exception ex) {
    //                 Log.Warning(ex, $"AutoTag: Failed to register trigger for '{config.CategoryName}'");
    //             }
    //         }
    //
    //         Log.Information($"AutoTag: Triggers registered for {settings.Configurations.Count(c => c.Enabled)} categories");
    //     } catch (Exception ex) {
    //         Log.Error(ex, "AutoTag: Failed to register triggers on document open");
    //     }
    // }

    // /// <summary>
    // ///     Unregisters the AutoTag updater on application shutdown.
    // /// </summary>
    // private void UnregisterAutoTagUpdater() {
    //     try {
    //         if (AutoTagUpdater != null) {
    //             this.Application.ControlledApplication.DocumentOpened -= OnDocumentOpenedForTriggers;
    //             UpdaterRegistry.UnregisterUpdater(AutoTagUpdater.GetUpdaterId());
    //             AutoTagUpdater = null;
    //             Log.Information("AutoTag: Updater unregistered");
    //         }
    //     } catch (Exception ex) {
    //         Log.Error(ex, "AutoTag: Failed to unregister updater");
    //     }
    // }
}