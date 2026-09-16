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
    private readonly FileInfo _fileInfo;
    private readonly string _relativePath;

    internal BatchScheduleListItem(PreparedPodSetting prepared) {
        this.FilePath = prepared.FullSourcePath;
        this._fileInfo = new FileInfo(this.FilePath);
        this._relativePath = prepared.SourcePath;
        this.Prepared = prepared;
        this.ScheduleCount = ExtractScheduleCountFromContent(prepared.ComposedContent);
    }

    internal PreparedPodSetting Prepared { get; private set; }
    internal PreparedPodSetting? AttemptSnapshot { get; private set; }

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
        this.AttemptSnapshot = null;
        this.Prepared = this.Prepared.Refresh();
        this.AttemptSnapshot = this.Prepared;
        return ModuleSettingsStorage<BatchScheduleSettings>.ReadPrepared(
            this.Prepared.RawContent,
            this.Prepared.ComposedContent,
            $"{this.Prepared.PodId}:{this.Prepared.SourcePath}");
    }

    private static int ExtractScheduleCountFromContent(string content) {
        var jObject = JObject.Parse(content);
        return jObject.TryGetValue("ScheduleFiles", out var filesToken) && filesToken is JArray filesArray ? filesArray.Count : 0;
    }
}
