using Newtonsoft.Json.Linq;
using Pe.Global.Revit.Lib.Schedules;
using Pe.Global.Services.Storage.Core;
using Pe.Ui.Core;
using System.IO;
using System.Windows.Media.Imaging;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;

/// <summary>
///     Palette list item representing a Schedule profile JSON file.
///     Displays metadata: filename, category, field count.
/// </summary>
public class ScheduleListItem : IPaletteListItem {
    public readonly FileInfo _fileInfo;
    private readonly string _relativePath;

    public ScheduleListItem(string filePath, string relativePath = null) {
        this.FilePath = filePath;
        this._fileInfo = new FileInfo(filePath);
        this._relativePath = relativePath;
        this.CategoryName = ExtractCategoryName(filePath);
        this.FieldCount = ExtractFieldCount(filePath);
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

    public Func<string> GetTextInfo => null; // Tooltip disabled - info shown in preview panel

    public BitmapImage Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>
    ///     Extracts the CategoryName value from a schedule profile JSON file.
    /// </summary>
    private static string ExtractCategoryName(string filePath) {
        try {
            var content = File.ReadAllText(filePath);
            var jObject = JObject.Parse(content);
            return (jObject.TryGetValue("CategoryName", out var token)
                ? token.Value<string>()
                : null) ?? string.Empty;
        } catch {
            return string.Empty;
        }
    }

    /// <summary>
    ///     Extracts the field count from a schedule profile JSON file.
    /// </summary>
    private static int ExtractFieldCount(string filePath) {
        try {
            var content = File.ReadAllText(filePath);
            var jObject = JObject.Parse(content);
            if (jObject.TryGetValue("Fields", out var fieldsToken) && fieldsToken is JArray fieldsArray)
                return fieldsArray.Count;
            return 0;
        } catch {
            return 0;
        }
    }

    /// <summary>
    ///     Discovers all schedule profile JSON files in a directory, excluding schema files.
    ///     If using a SettingsSubDir with recursive discovery, will find files in nested subdirectories.
    /// </summary>
    public static List<ScheduleListItem> DiscoverProfiles(SettingsManager subDir) {
        if (!Directory.Exists(subDir.DirectoryPath))
            return [];
        var jsonFiles = subDir.ListJsonFilesRecursive().Where(f => !f.EndsWith("schema.json") && !f.Contains("schema-")).ToList();
        if (jsonFiles.Count == 0) _ = subDir.Json<ScheduleSpec>().Read();
        
        return jsonFiles
            .Select(relativePath => new ScheduleListItem(
                Path.Combine(subDir.DirectoryPath, relativePath),
                relativePath))
            .OrderByDescending(p => p.LastModified)
            .ToList();
    }
}