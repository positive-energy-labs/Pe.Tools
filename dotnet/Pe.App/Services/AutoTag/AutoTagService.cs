using Pe.Revit.Global.Services.Document;
using Newtonsoft.Json;
using Pe.Revit.Global.Lib;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.Loader.Documents;
using Pe.Revit.SettingsRuntime.Modules.AutoTag;
using Serilog;

namespace Pe.App.Services.AutoTag;

/// <summary>
///     Singleton service that manages the AutoTag feature. Per-document settings live in the
///     tracked document's State bag — keyed by document identity, dropped automatically on close —
///     replacing the GetHashCode-keyed dictionary that leaked entries because Revit wrapper hashes
///     are not stable document identities.
/// </summary>
public class AutoTagService {
    private static AutoTagService? _instance;
    private AddInId? _addInId;
    private IDocumentTracker? _documents;
    // ponytail: the extensible-storage DataStorage store was deleted without migration (kaitpw, 2026-11-06, greenfield);
    // a document saved by the old store reads as "no settings" and the user re-enters them once.
    private static readonly ProjectInfoText Store = new(new Guid("a89b3d96-72ad-4972-a532-81676635755b"), "_PE_AutoTag", "Pe.Tools AutoTag settings (JSON).");
    private static readonly JsonSerializerSettings JsonSettings = RevitJsonFormatting.CreateRevitIndentedSettings();
    private AutoTagUpdater? _updater;

    public static AutoTagService Instance {
        get {
            _instance ??= new AutoTagService();
            return _instance;
        }
    }

    public AutoTagSettings? GetSettingsForDocument(Document doc) =>
        this._documents?.Find(doc)?.State(_ => new DocState()).Settings;

    public void SaveSettingsForDocument(Document doc, AutoTagSettings settings) {
        using (var transaction = new Transaction(doc, "Save AutoTag Settings")) {
            _ = transaction.Start();
            _ = Store.Write(doc, JsonConvert.SerializeObject(settings, JsonSettings));
            _ = transaction.Commit();
        }
        var tracked = this._documents?.Find(doc);
        if (tracked != null)
            tracked.State(_ => new DocState()).Settings = settings;

        if (this._updater != null)
            this.RegisterTriggersForDocument(doc, settings);

        Log.Information("AutoTag: Settings saved and reloaded for '{Title}'", doc.Title);
    }

    /// <summary>Null when the document holds no AutoTag settings or the stored JSON is invalid (logged).</summary>
    private static AutoTagSettings? ReadSettings(Document doc) {
        if (Store.Read(doc) is not { } json)
            return null;
        try {
            return JsonConvert.DeserializeObject<AutoTagSettings>(json, JsonSettings);
        } catch (JsonException ex) {
            Log.Error(ex, "AutoTag: Stored settings in '{Title}' are invalid; AutoTag stays off", doc.Title);
            return null;
        }
    }

    public bool HasSettingsInDocument(Document doc) {
        return Store.Read(doc) != null;
    }

    public void Initialize(AddInId addInId, IDocumentTracker documents) {
        try {
            this._addInId = addInId;
            this._documents = documents;

            this._updater = new AutoTagUpdater(addInId);
            UpdaterRegistry.RegisterUpdater(this._updater, true);
            // Opened replays already-open documents, so a hot-reloaded payload picks up settings
            // for documents that opened before it started — the raw event never offered that.
            documents.Opened += this.OnDocumentOpened;

            Log.Information("AutoTag: Service initialized successfully");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to initialize service");
        }
    }

    public void Shutdown() {
        try {
            if (this._documents != null)
                this._documents.Opened -= this.OnDocumentOpened;
            this._documents = null;

            if (this._updater != null) {
                UpdaterRegistry.UnregisterUpdater(this._updater.GetUpdaterId());
                this._updater = null;
            }

            Log.Information("AutoTag: Service shut down successfully");
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to shut down service");
        }
    }

    public AutoTagStatus GetStatus(Document doc) {
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

    private void OnDocumentOpened(TrackedDocument tracked) {
        try {
            if (this._updater == null)
                return;

            var doc = tracked.Resolve();
            var settings = ReadSettings(doc);
            tracked.State(_ => new DocState()).Settings = settings;

            if (settings == null) {
                Log.Information("AutoTag: Disabled for '{Title}' - no document settings found", tracked.Title);
                return;
            }

            if (settings.Enabled && settings.Configurations.Count > 0)
                this.RegisterTriggersForDocument(doc, settings);
            else {
                Log.Debug(
                    "AutoTag: Skipping trigger registration for '{Title}' (disabled or no configurations)",
                    tracked.Title
                );
            }
        } catch (Exception ex) {
            Log.Error(ex, "AutoTag: Failed to process document open");
        }
    }

    private void RegisterTriggersForDocument(Document doc, AutoTagSettings settings) {
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

    /// <summary>Per-document settings slot, one per tracked document, dropped on close.</summary>
    private sealed class DocState {
        public AutoTagSettings? Settings;
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
