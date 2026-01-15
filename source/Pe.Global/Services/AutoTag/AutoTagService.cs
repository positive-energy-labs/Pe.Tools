using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Pe.Global.Services.AutoTag.Core;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core.Json;
using Serilog;

namespace Pe.Global.Services.AutoTag;

/// <summary>
///     Singleton service that manages the AutoTag feature.
///     Owns all AutoTag state including settings, updater, and lifecycle management.
///     Pattern follows DocumentManager for consistency.
/// </summary>
public class AutoTagService {
    private static AutoTagService? _instance;
    private readonly JsonReader<AutoTagSettings> _storage;
    private AutoTagUpdater? _updater;
    private UIControlledApplication? _app;

    private AutoTagService() {
        // Single source of storage - only created here
        this._storage = new Pe.Global.Services.Storage.Storage("AutoTag").SettingsDir().Json<AutoTagSettings>();
        this.LoadSettings();
    }

    /// <summary>
    ///     Gets the singleton instance of the AutoTagService.
    /// </summary>
    public static AutoTagService Instance {
        get {
            _instance ??= new AutoTagService();
            return _instance;
        }
    }

    /// <summary>
    ///     Gets the current settings (readonly). To refresh, call ReloadSettings().
    /// </summary>
    public AutoTagSettings? Settings { get; private set; }

    /// <summary>
    ///     Gets the file path to the settings JSON file.
    /// </summary>
    public string SettingsFilePath => this._storage.FilePath;

    /// <summary>
    ///     Initializes the AutoTag service, registers the updater, and sets up event handlers.
    /// </summary>
    public void Initialize(AddInId addInId, UIControlledApplication app) {
        try {
            this._app = app;

            // Create and register updater
            this._updater = new AutoTagUpdater(addInId);
            UpdaterRegistry.RegisterUpdater(this._updater, isOptional: true);

            // Push settings to updater
            this._updater.SetSettings(this.Settings);

            // Subscribe to DocumentOpened event for trigger registration
            app.ControlledApplication.DocumentOpened += this.OnDocumentOpened;

            Log.Information("AutoTag: Service initialized successfully");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to initialize service");
        }
    }

    /// <summary>
    ///     Shuts down the AutoTag service and unregisters the updater.
    /// </summary>
    public void Shutdown() {
        try {
            if (this._app != null) {
                this._app.ControlledApplication.DocumentOpened -= this.OnDocumentOpened;
            }

            if (this._updater != null) {
                UpdaterRegistry.UnregisterUpdater(this._updater.GetUpdaterId());
                this._updater = null;
            }

            Log.Information("AutoTag: Service shut down successfully");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to shut down service");
        }
    }

    /// <summary>
    ///     Reloads settings from storage and updates the updater.
    /// </summary>
    public void ReloadSettings() {
        this.LoadSettings();
        this._updater?.SetSettings(this.Settings);
        Log.Information("AutoTag: Settings reloaded");
    }

    /// <summary>
    ///     Clears the tag type cache in the updater.
    /// </summary>
    public void ClearCache() {
        this._updater?.ClearCache();
        Log.Information("AutoTag: Cache cleared");
    }

    /// <summary>
    ///     Gets the current status of the AutoTag service.
    /// </summary>
    public AutoTagStatus GetStatus() => new AutoTagStatus {
        IsInitialized = this._updater != null,
        IsEnabled = this.Settings?.Enabled ?? false,
        SettingsFilePath = this.SettingsFilePath,
        ConfigurationCount = this.Settings?.Configurations?.Count ?? 0,
        EnabledConfigurationCount = this.Settings?.Configurations?.Count(c => c.Enabled) ?? 0,
        Configurations = this.Settings?.Configurations ?? []
    };

    /// <summary>
    ///     Loads settings from storage (private - only called internally).
    /// </summary>
    private void LoadSettings() {
        try {
            this.Settings = this._storage.Read();
            Log.Debug("AutoTag: Settings loaded successfully");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to load settings, using defaults");
            this.Settings = new AutoTagSettings { Enabled = false };
        }
    }

    /// <summary>
    ///     Event handler for document opened - registers triggers for configured categories.
    /// </summary>
    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) {
        try {
            var doc = e.Document;
            if (doc == null || this._updater == null) return;

            // Check if settings are enabled
            if (this.Settings?.Enabled != true || this.Settings.Configurations.Count == 0) {
                Log.Debug("AutoTag: Skipping trigger registration (disabled or no configurations)");
                return;
            }

            var updaterId = this._updater.GetUpdaterId();

            // Remove any existing triggers for this document before adding new ones
            // This ensures we start fresh each time a document is opened
            try {
                UpdaterRegistry.RemoveDocumentTriggers(updaterId, doc);
            } catch {
                // Ignore if no triggers exist
            }

            // Register triggers for each enabled category
            var registeredCount = 0;
            foreach (var config in this.Settings.Configurations.Where(c => c.Enabled)) {
                try {
                    var builtInCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, config.CategoryName);
                    if (builtInCategory == BuiltInCategory.INVALID) {
                        Log.Warning($"AutoTag: Invalid category '{config.CategoryName}', skipping trigger");
                        continue;
                    }

                    // Create filter for this category
                    var filter = new ElementCategoryFilter(builtInCategory);

                    // Add trigger for element addition
                    UpdaterRegistry.AddTrigger(
                        updaterId,
                        doc,
                        filter,
                        Element.GetChangeTypeElementAddition()
                    );

                    registeredCount++;
                    Log.Debug($"AutoTag: Registered trigger for category '{config.CategoryName}'");
                } catch (Exception ex) {
                    Log.Warning(ex, $"AutoTag: Failed to register trigger for '{config.CategoryName}'");
                }
            }

            Log.Information($"AutoTag: Registered triggers for {registeredCount} categories in '{doc.Title}'");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to register triggers on document open");
        }
    }
}

/// <summary>
///     Status information about the AutoTag service.
/// </summary>
public record AutoTagStatus {
    public bool IsInitialized { get; init; }
    public bool IsEnabled { get; init; }
    public string SettingsFilePath { get; init; } = string.Empty;
    public int ConfigurationCount { get; init; }
    public int EnabledConfigurationCount { get; init; }
    public List<AutoTagConfiguration> Configurations { get; init; } = [];
}
