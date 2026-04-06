using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Pe.Revit.Global.Services.Storage;
using Pe.Shared.SettingsCatalog.Manifests.AutoTag;
using Serilog;

namespace Pe.App.Services.AutoTag;

/// <summary>
///     Singleton service that manages the AutoTag feature.
/// </summary>
public class AutoTagService {
    private static AutoTagService? _instance;
    private readonly Dictionary<int, AutoTagSettings?> _documentSettings = new();
    private AddInId? _addInId;
    private UIControlledApplication? _app;
    private DocumentSettingsStorage<AutoTagSettings>? _documentStorage;
    private AutoTagUpdater? _updater;

    public static AutoTagService Instance {
        get {
            _instance ??= new AutoTagService();
            return _instance;
        }
    }

    public AutoTagSettings? GetSettingsForDocument(Autodesk.Revit.DB.Document doc) {
        var docHash = doc.GetHashCode();
        return this._documentSettings.TryGetValue(docHash, out var settings) ? settings : null;
    }

    public void CleanupDocument(Autodesk.Revit.DB.Document doc) {
        var docHash = doc.GetHashCode();
        if (this._documentSettings.Remove(docHash))
            Log.Debug("AutoTag: Cleaned up settings for closed document '{Title}'", doc.Title);
    }

    public void SaveSettingsForDocument(Autodesk.Revit.DB.Document doc, AutoTagSettings settings) {
        if (this._documentStorage == null)
            throw new InvalidOperationException("AutoTag service not initialized");

        this._documentStorage.Write(doc, settings);
        this._documentSettings[doc.GetHashCode()] = settings;

        if (this._updater != null)
            this.RegisterTriggersForDocument(doc, settings);

        Log.Information("AutoTag: Settings saved and reloaded for '{Title}'", doc.Title);
    }

    public bool HasSettingsInDocument(Autodesk.Revit.DB.Document doc) {
        if (this._documentStorage == null)
            return false;

        return this._documentStorage.Exists(doc);
    }

    public void Initialize(AddInId addInId, UIControlledApplication app) {
        try {
            this._app = app;
            this._addInId = addInId;
            this._documentStorage = new DocumentSettingsStorage<AutoTagSettings>(
                new Guid("B9F3E5A7-2C4D-6B8F-0E1A-3D5C7F9B1E2A"),
                "PeAutoTagSettings"
            );
            this._updater = new AutoTagUpdater(addInId);
            UpdaterRegistry.RegisterUpdater(this._updater, true);
            app.ControlledApplication.DocumentOpened += this.OnDocumentOpened;

            Log.Information("AutoTag: Service initialized successfully");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to initialize service");
        }
    }

    public void Shutdown() {
        try {
            if (this._app != null)
                this._app.ControlledApplication.DocumentOpened -= this.OnDocumentOpened;

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

    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) {
        try {
            var doc = e.Document;
            if (doc == null || this._updater == null || this._documentStorage == null)
                return;

            var settings = this._documentStorage.Read(doc);
            var docHash = doc.GetHashCode();

            if (settings == null) {
                Log.Information("AutoTag: Disabled for '{Title}' - no document settings found", doc.Title);
                this._documentSettings[docHash] = null;
                return;
            }

            this._documentSettings[docHash] = settings;

            if (settings.Enabled && settings.Configurations.Count > 0)
                this.RegisterTriggersForDocument(doc, settings);
            else
                Log.Debug(
                    "AutoTag: Skipping trigger registration for '{Title}' (disabled or no configurations)",
                    doc.Title
                );
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to process document open");
        }
    }

    private void RegisterTriggersForDocument(Autodesk.Revit.DB.Document doc, AutoTagSettings settings) {
        if (this._updater == null)
            return;

        var updaterId = this._updater.GetUpdaterId();
        try {
            UpdaterRegistry.RemoveDocumentTriggers(updaterId, doc);
        } catch {
        }

        this._updater.SetSettings(settings);

        var registeredCount = 0;
        foreach (var config in settings.Configurations.Where(c => c.Enabled)) {
            try {
                if (config.BuiltInCategory == BuiltInCategory.INVALID) {
                    Log.Warning("AutoTag: Invalid category '{CategoryName}', skipping trigger", config.BuiltInCategory);
                    continue;
                }

                UpdaterRegistry.AddTrigger(
                    updaterId,
                    doc,
                    new ElementCategoryFilter(config.BuiltInCategory),
                    Element.GetChangeTypeElementAddition()
                );

                registeredCount++;
                Log.Debug("AutoTag: Registered trigger for category '{CategoryName}'", config.BuiltInCategory);
            } catch (Exception ex) {
                Log.Warning(ex, "AutoTag: Failed to register trigger for '{CategoryName}'", config.BuiltInCategory);
            }
        }

        Log.Information("AutoTag: Registered triggers for {Count} categories in '{Title}'", registeredCount, doc.Title);
    }
}

public record AutoTagStatus {
    public bool IsInitialized { get; init; }
    public bool IsEnabled { get; init; }
    public bool HasDocumentSettings { get; init; }
    public int ConfigurationCount { get; init; }
    public int EnabledConfigurationCount { get; init; }
    public List<AutoTagConfiguration> Configurations { get; init; } = [];
}
