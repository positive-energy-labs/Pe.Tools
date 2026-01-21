using Autodesk.Revit.DB.Events;
using Pe.Global.Services.AutoTag.Core;
using Pe.Global.Services.Storage;
using Serilog;

namespace Pe.Global.Services.AutoTag;

/// <summary>
///     Singleton service that manages the AutoTag feature.
///     Owns all AutoTag state including settings, updater, and lifecycle management.
///     Pattern follows DocumentManager for consistency.
/// </summary>
public class AutoTagService {
    private static AutoTagService? _instance;
    private readonly Dictionary<int, AutoTagSettings?> _documentSettings = new();
    private DocumentSettingsStorage<AutoTagSettings>? _documentStorage;
    private AddInId? _addInId;
    private UIControlledApplication? _app;
    private AutoTagUpdater? _updater;

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
    ///     Gets settings for a specific document. Returns null if not configured.
    /// </summary>
    public AutoTagSettings? GetSettingsForDocument(Autodesk.Revit.DB.Document doc) {
        var docHash = doc.GetHashCode();
        return this._documentSettings.TryGetValue(docHash, out var settings) ? settings : null;
    }

    /// <summary>
    ///     Writes settings for a specific document and reloads AutoTag for that document.
    /// </summary>
    public void SaveSettingsForDocument(Autodesk.Revit.DB.Document doc, AutoTagSettings settings) {
        if (this._documentStorage == null) throw new InvalidOperationException("AutoTag service not initialized");

        this._documentStorage.Write(doc, settings);
        var docHash = doc.GetHashCode();
        this._documentSettings[docHash] = settings;

        // Re-register triggers for this document
        if (this._updater != null) this.RegisterTriggersForDocument(doc, settings);

        Log.Information("AutoTag: Settings saved and reloaded for '{Title}'", doc.Title);
    }

    /// <summary>
    ///     Checks if settings exist in the document.
    /// </summary>
    public bool HasSettingsInDocument(Autodesk.Revit.DB.Document doc) {
        if (this._documentStorage == null) return false;
        return this._documentStorage.Exists(doc);
    }

    /// <summary>
    ///     Initializes the AutoTag service, registers the updater, and sets up event handlers.
    /// </summary>
    public void Initialize(AddInId addInId, UIControlledApplication app) {
        try {
            this._app = app;
            this._addInId = addInId;

            // Initialize document storage with vendor-based access control
            // Schema GUID v3 - uses VendorId "Development" to match .addin manifest
            this._documentStorage = new DocumentSettingsStorage<AutoTagSettings>(
                schemaGuid: new Guid("B9F3E5A7-2C4D-6B8F-0E1A-3D5C7F9B1E2A"),
                schemaName: "PeAutoTagSettings"
            );

            // Create and register updater
            this._updater = new AutoTagUpdater(addInId);
            UpdaterRegistry.RegisterUpdater(this._updater, true);

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
            if (this._app != null) this._app.ControlledApplication.DocumentOpened -= this.OnDocumentOpened;

            if (this._updater != null) {
                UpdaterRegistry.UnregisterUpdater(this._updater.GetUpdaterId());
                this._updater = null;
            }

            this._documentSettings.Clear();

            Log.Information("AutoTag: Service shut down successfully");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to shut down service");
        }
    }

    /// <summary>
    ///     Gets the current status of the AutoTag service for a specific document.
    /// </summary>
    public AutoTagStatus GetStatus(Autodesk.Revit.DB.Document doc) {
        var settings = this.GetSettingsForDocument(doc);
        return new AutoTagStatus {
            IsInitialized = this._updater != null,
            IsEnabled = settings?.Enabled ?? false,
            HasDocumentSettings = settings != null,
            ConfigurationCount = settings?.Configurations?.Count ?? 0,
            EnabledConfigurationCount = settings?.Configurations?.Count(c => c.Enabled) ?? 0,
            Configurations = settings?.Configurations ?? []
        };
    }

    /// <summary>
    ///     Event handler for document opened - registers triggers for configured categories.
    /// </summary>
    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) {
        try {
            var doc = e.Document;
            if (doc == null || this._updater == null || this._documentStorage == null) return;

            // Try to load settings from document
            var settings = this._documentStorage.Read(doc);
            var docHash = doc.GetHashCode();

            if (settings == null) {
                Log.Information("AutoTag: Disabled for '{Title}' - no document settings found", doc.Title);
                this._documentSettings[docHash] = null;
                return;
            }

            // Store settings for this document
            this._documentSettings[docHash] = settings;

            // Register triggers if enabled
            if (settings.Enabled && settings.Configurations.Count > 0)
                this.RegisterTriggersForDocument(doc, settings);
            else
                Log.Debug("AutoTag: Skipping trigger registration for '{Title}' (disabled or no configurations)",
                    doc.Title);
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to process document open");
        }
    }

    /// <summary>
    ///     Registers triggers for a specific document based on settings.
    /// </summary>
    private void RegisterTriggersForDocument(Autodesk.Revit.DB.Document doc, AutoTagSettings settings) {
        if (this._updater == null) return;

        var updaterId = this._updater.GetUpdaterId();

        // Remove any existing triggers for this document before adding new ones
        try {
            UpdaterRegistry.RemoveDocumentTriggers(updaterId, doc);
        } catch {
            // Ignore if no triggers exist
        }

        // Push settings to updater
        this._updater.SetSettings(settings);

        // Register triggers for each enabled category
        var registeredCount = 0;
        foreach (var config in settings.Configurations.Where(c => c.Enabled)) {
            try {
                var builtInCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, config.CategoryName);
                if (builtInCategory == BuiltInCategory.INVALID) {
                    Log.Warning("AutoTag: Invalid category '{CategoryName}', skipping trigger", config.CategoryName);
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
                Log.Debug("AutoTag: Registered trigger for category '{CategoryName}'", config.CategoryName);
            } catch (Exception ex) {
                Log.Warning(ex, "AutoTag: Failed to register trigger for '{CategoryName}'", config.CategoryName);
            }
        }

        Log.Information("AutoTag: Registered triggers for {Count} categories in '{Title}'", registeredCount, doc.Title);
    }
}

/// <summary>
///     Status information about the AutoTag service.
/// </summary>
public record AutoTagStatus {
    public bool IsInitialized { get; init; }
    public bool IsEnabled { get; init; }
    public bool HasDocumentSettings { get; init; }
    public int ConfigurationCount { get; init; }
    public int EnabledConfigurationCount { get; init; }
    public List<AutoTagConfiguration> Configurations { get; init; } = [];
}