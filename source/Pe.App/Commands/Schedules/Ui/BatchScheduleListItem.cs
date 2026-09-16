using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.Ui.Core;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime;
using System.IO;
using WpfColor = System.Windows.Media.Color;
using Pe.App.Pods;

namespace Pe.App.Commands.Schedules.Ui;

/// <summary>
///     Palette list item representing a batch schedule configuration.
/// </summary>
public class BatchScheduleListItem : IPaletteListItem {
    private readonly ModuleDocumentStorage _documents;
    private readonly FileInfo _fileInfo;
    private readonly string _relativePath;
    private readonly ModuleSettingsStorage<BatchScheduleSettings> _settings;

    public BatchScheduleListItem(
        string filePath,
        string relativePath,
        ModuleSettingsStorage<BatchScheduleSettings> settings
    ) {
        this.FilePath = filePath;
        this._fileInfo = new FileInfo(filePath);
        this._relativePath = relativePath;
        this._settings = settings;
        this._documents = settings.Documents();
        this.ScheduleCount = ExtractScheduleCount(filePath);
    }

    internal BatchScheduleListItem(PreparedPodSetting prepared, ModuleSettingsStorage<BatchScheduleSettings> settings) {
        this.FilePath = prepared.FullSourcePath;
        this._fileInfo = new FileInfo(this.FilePath);
        this._relativePath = prepared.SourcePath;
        this._settings = settings;
        this._documents = settings.Documents();
        this.Prepared = prepared;
        this.ScheduleCount = ExtractScheduleCountFromContent(prepared.ComposedContent);
    }

    internal PreparedPodSetting? Prepared { get; private set; }

    /// <summary> Full path to the batch configuration JSON file </summary>
    public string FilePath { get; }

    /// <summary> Number of schedules in the batch </summary>
    public int ScheduleCount { get; }

    /// <summary> Last modified date for sorting </summary>
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    /// <summary> Created date </summary>
    public DateTime CreatedDate => this._fileInfo.CreationTime;

    /// <summary> Batch filename without extension (or relative path if nested) </summary>
    public string TextPrimary => this._relativePath != null
        ? Path.ChangeExtension(this._relativePath, null)
        : Path.GetFileNameWithoutExtension(this.FilePath);

    /// <summary> Shows "Batch" label </summary>
    public string TextSecondary => "Batch Configuration";

    /// <summary> Schedule count badge </summary>
    public string TextPill => $"{this.ScheduleCount} schedules";

    public Func<string> GetTextInfo => () => string.Empty;

    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>
    ///     Loads the batch settings from the file.
    /// </summary>
    public BatchScheduleSettings LoadBatchSettings() {
        if (this.Prepared is null)
            return this._settings.ReadRequired(this._relativePath);
        this.Prepared = this.Prepared.Refresh();
        return ModuleSettingsStorage<BatchScheduleSettings>.ReadPrepared(
            this.Prepared.RawContent,
            this.Prepared.ComposedContent,
            $"{this.Prepared.PodId}:{this.Prepared.SourcePath}");
    }

    /// <summary>
    ///     Discovers all batch configuration JSON files in a directory.
    /// </summary>
    public static List<BatchScheduleListItem> DiscoverProfiles(ModuleSettingsStorage<BatchScheduleSettings> settings) {
        var documents = settings.Documents();
        var discovered = documents
            .DiscoverAsync(
                new SettingsDiscoveryOptions(
                    Recursive: true,
                    IncludeFragments: false,
                    IncludeSchemas: false
                )
            )
            .GetAwaiter()
            .GetResult();

        return discovered.Files
            .Select(file => new BatchScheduleListItem(
                documents.ResolveDocumentPath(file.RelativePath),
                file.RelativePath,
                settings))
            .OrderByDescending(p => p.LastModified)
            .ToList();
    }

    /// <summary>
    ///     Extracts the schedule count from a batch configuration JSON file.
    /// </summary>
    private static int ExtractScheduleCount(string filePath) {
        try {
            return ExtractScheduleCountFromContent(File.ReadAllText(filePath));
        } catch {
            return 0;
        }
    }

    private static int ExtractScheduleCountFromContent(string content) {
        var jObject = JObject.Parse(content);
        return jObject.TryGetValue("ScheduleFiles", out var filesToken) && filesToken is JArray filesArray ? filesArray.Count : 0;
    }
}
