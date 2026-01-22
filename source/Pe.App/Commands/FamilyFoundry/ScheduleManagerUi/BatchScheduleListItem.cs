using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core;
using Pe.Ui.Core;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Windows.Media.Imaging;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;

/// <summary>
///     Settings for batch schedule creation.
///     Contains a simple array of schedule profile file paths to run.
/// </summary>
public class BatchScheduleSettings {
    [Description(
        "List of schedule profile JSON files to create in batch. Paths are relative to the schedules/ directory.")]
    [Required]
    public List<string> ScheduleFiles { get; set; } = [];
}

/// <summary>
///     Palette list item representing a batch schedule configuration.
/// </summary>
public class BatchScheduleListItem : IPaletteListItem {
    private readonly FileInfo _fileInfo;
    private readonly string _relativePath;
    private readonly SettingsManager _batchSubDir;

    public BatchScheduleListItem(string filePath, string relativePath, SettingsManager batchSubDir) {
        this.FilePath = filePath;
        this._fileInfo = new FileInfo(filePath);
        this._relativePath = relativePath;
        this._batchSubDir = batchSubDir;
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
        this._batchSubDir.Json<BatchScheduleSettings>(Path.GetFileName(this.FilePath)).Read();

    /// <summary>
    ///     Discovers all batch configuration JSON files in a directory.
    /// </summary>
    public static List<BatchScheduleListItem> DiscoverProfiles(SettingsManager subDir) {
        if (!Directory.Exists(subDir.DirectoryPath))
            return [];
        // force default to be made
        var jsonFiles = subDir.ListJsonFilesRecursive().Where(f => !f.EndsWith("schema.json") && !f.Contains("schema-")).ToList();
        if (jsonFiles.Count == 0) _ = subDir.Json<BatchScheduleSettings>().Read();

        return jsonFiles
            .Select(relativePath => new BatchScheduleListItem(
                Path.Combine(subDir.DirectoryPath, relativePath),
                relativePath,
                subDir))
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