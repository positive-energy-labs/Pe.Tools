using Newtonsoft.Json.Linq;
using Pe.Revit.Ui.Core;
using Pe.Shared.SettingsCatalog.Manifests.Schedules;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using System.IO;
using System.Windows.Media.Imaging;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;

/// <summary>
///     Palette list item representing a batch schedule configuration.
/// </summary>
public class BatchScheduleListItem : IPaletteListItem {
    private readonly FileInfo _fileInfo;
    private readonly string _relativePath;
    private readonly ModuleSettingsStorage<BatchScheduleSettings> _settings;
    private readonly ModuleDocumentStorage _documents;

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

    public Func<string> GetTextInfo => null;

    public BitmapImage Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>
    ///     Loads the batch settings from the file.
    /// </summary>
    public BatchScheduleSettings LoadBatchSettings() =>
        this._settings.ReadRequired(this._relativePath);

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
            var content = File.ReadAllText(filePath);
            var jObject = JObject.Parse(content);
            if (jObject.TryGetValue("ScheduleFiles", out var filesToken) && filesToken is JArray filesArray)
                return filesArray.Count;
            return 0;
        } catch {
            return 0;
        }
    }
}
