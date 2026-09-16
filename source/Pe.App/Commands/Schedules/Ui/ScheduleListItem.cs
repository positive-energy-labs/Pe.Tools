using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using System.IO;
using WpfColor = System.Windows.Media.Color;
using Pe.App.Pods;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Shared.RevitData.Schedules;

namespace Pe.App.Commands.Schedules.Ui;

/// <summary>
///     Palette list item representing a Schedule profile JSON file.
///     Displays metadata: filename, category, field count.
/// </summary>
public class ScheduleListItem : IPaletteListItem {
    public readonly FileInfo _fileInfo;
    private readonly string? _relativePath;

    public ScheduleListItem(string filePath, string? relativePath = null) {
        this.FilePath = filePath;
        this._fileInfo = new FileInfo(filePath);
        this._relativePath = relativePath;
        this.CategoryName = ExtractCategoryName(filePath);
        this.FieldCount = ExtractFieldCount(filePath);
    }

    internal ScheduleListItem(PreparedPodSetting prepared) {
        this.FilePath = prepared.FullSourcePath;
        this._fileInfo = new FileInfo(this.FilePath);
        this._relativePath = prepared.SourcePath;
        this.Prepared = prepared;
        this.CategoryName = ExtractCategoryNameFromContent(prepared.ComposedContent);
        this.FieldCount = ExtractFieldCountFromContent(prepared.ComposedContent);
    }

    internal PreparedPodSetting? Prepared { get; private set; }
    internal PreparedPodSetting? AttemptSnapshot { get; private set; }

    internal ScheduleProfile Load(ModuleSettingsStorage<ScheduleProfile> legacy) {
        this.AttemptSnapshot = null;
        if (this.Prepared is null)
            return legacy.ReadRequired(this.TextPrimary);
        this.Prepared = this.Prepared.Refresh();
        this.AttemptSnapshot = this.Prepared;
        return ModuleSettingsStorage<ScheduleProfile>.ReadPrepared(
            this.Prepared.RawContent,
            this.Prepared.ComposedContent,
            $"{this.Prepared.PodId}:{this.Prepared.SourcePath}");
    }

    /// <summary> Full path to the schedule profile JSON file </summary>
    public string FilePath { get; }

    /// <summary> Number of fields in the schedule </summary>
    public int FieldCount { get; }

    /// <summary> The category name from the profile </summary>
    public string CategoryName { get; }

    /// <summary> Last modified date for sorting </summary>
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    /// <summary> Profile filename without extension (or relative path if nested) </summary>
    public string TextPrimary => this._relativePath != null
        ? Path.ChangeExtension(this._relativePath, null)
        : Path.GetFileNameWithoutExtension(this.FilePath);

    /// <summary> Shows category name </summary>
    public string TextSecondary => string.IsNullOrEmpty(this.CategoryName)
        ? "Unknown Category"
        : this.CategoryName;

    /// <summary> Field count badge </summary>
    public string TextPill => $"{this.FieldCount} fields";

    public Func<string> GetTextInfo => static () => string.Empty; // Tooltip disabled - info shown in preview panel

    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>
    ///     Extracts the CategoryName value from a schedule profile JSON file.
    /// </summary>
    private static string ExtractCategoryName(string filePath) {
        try {
            return ExtractCategoryNameFromContent(File.ReadAllText(filePath));
        } catch {
            return string.Empty;
        }
    }

    private static string ExtractCategoryNameFromContent(string content) {
        var jObject = JObject.Parse(content);
        return (jObject.TryGetValue("CategoryName", out var token) ? token.Value<string>() : null) ?? string.Empty;
    }

    /// <summary>
    ///     Extracts the field count from a schedule profile JSON file.
    /// </summary>
    private static int ExtractFieldCount(string filePath) {
        try {
            return ExtractFieldCountFromContent(File.ReadAllText(filePath));
        } catch {
            return 0;
        }
    }

    private static int ExtractFieldCountFromContent(string content) {
        var jObject = JObject.Parse(content);
        return jObject.TryGetValue("Fields", out var fieldsToken) && fieldsToken is JArray fieldsArray ? fieldsArray.Count : 0;
    }

    /// <summary>
    ///     Discovers all schedule profile JSON files in a directory, excluding schema files.
    ///     If using a SettingsSubDir with recursive discovery, will find files in nested subdirectories.
    /// </summary>
    public static List<ScheduleListItem> DiscoverProfiles(ModuleDocumentStorage storage) {
        var discovered = storage.DiscoverAsync(new SettingsDiscoveryOptions(
            Recursive: true,
            IncludeFragments: false,
            IncludeSchemas: false
        )).GetAwaiter().GetResult();

        return discovered.Files
            .Select(file => new ScheduleListItem(
                storage.ResolveDocumentPath(file.RelativePath),
                file.RelativePath))
            .OrderByDescending(p => p.LastModified)
            .ToList();
    }
}
