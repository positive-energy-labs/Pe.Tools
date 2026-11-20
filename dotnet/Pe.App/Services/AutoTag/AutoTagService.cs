using Pe.Revit.Global.Services.Document;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData.Serialization;
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
    private AutoTagUpdater? _updater;

    public static AutoTagService Instance {
        get {
            _instance ??= new AutoTagService();
            return _instance;
        }
    }

    public AutoTagSettings? GetSettingsForDocument(Document doc) =>
        this._documents?.Find(doc)?.State(_ => new DocState()).Read.Value;

    public void SaveSettingsForDocument(Document doc, AutoTagSettings settings) {
        using (var transaction = new Transaction(doc, "Save AutoTag Settings")) {
            _ = transaction.Start();
            _ = OwnerBlobStore.WriteWithoutPreview(doc, AutoTagSettings.Owner, settings.ToData());
            _ = transaction.Commit();
        }
        var tracked = this._documents?.Find(doc);
        if (tracked != null)
            tracked.State(_ => new DocState()).Read = new OwnerValue<AutoTagSettings>(settings, null);

        if (this._updater != null)
            this.RegisterTriggersForDocument(doc, settings);

        Log.Information("AutoTag: Settings saved and reloaded for '{Title}'", doc.Title);
    }

    /// <summary>Never throws: a stored blob this build cannot read comes back as a refusal, and AutoTag stays off.</summary>
    private static OwnerValue<AutoTagSettings> ReadSettings(Document doc) {
        var read = AutoTagSettings.Read(OwnerBlobStore.Read(doc, AutoTagSettings.Owner));
        if (read.Refusal != null)
            Log.Error("AutoTag: can't read the settings in '{Title}', kept as they are; AutoTag stays off ({Reason})", doc.Title, read.Refusal);
        return read;
    }

    public bool HasSettingsInDocument(Document doc) {
        return OwnerBlobStore.Read(doc, AutoTagSettings.Owner).Status != OwnerBlobStatus.Absent;
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
            Configurations = settings?.Configurations ?? [],
            // Read live, so a model whose blob is refused says so even before the tracker has seen it.
            StoredSettingsRefusal = AutoTagSettings.Read(OwnerBlobStore.Read(doc, AutoTagSettings.Owner)).Refusal
        };
    }

    private void OnDocumentOpened(TrackedDocument tracked) {
        try {
            if (this._updater == null)
                return;

            var doc = tracked.Resolve();
            var read = ReadSettings(doc);
            tracked.State(_ => new DocState()).Read = read;
            var settings = read.Value;

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
        public OwnerValue<AutoTagSettings> Read = new(null, null);
    }
}

public record AutoTagStatus {
    public bool IsInitialized { get; init; }
    public bool IsEnabled { get; init; }
    public bool HasDocumentSettings { get; init; }
    public int ConfigurationCount { get; init; }
    public int EnabledConfigurationCount { get; init; }
    public List<AutoTagConfiguration> Configurations { get; init; } = [];
    /// <summary>Set when the model's stored settings are "can't read, kept": the reason. AutoTag is off for that model.</summary>
    public string? StoredSettingsRefusal { get; init; }
}
