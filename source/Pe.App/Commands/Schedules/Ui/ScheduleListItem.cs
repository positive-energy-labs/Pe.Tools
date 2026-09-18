using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Ui.Core;
using System.IO;
using WpfColor = System.Windows.Media.Color;

namespace Pe.App.Commands.Schedules.Ui;

/// <summary>A pod member whose `$schema` is a schedule spec. Displays filename, category, field count.</summary>
public class ScheduleListItem : IPaletteListItem {
    public readonly FileInfo _fileInfo;

    /// <param name="member">Listed by `$schema`, so the library already parsed it as a JSON object.</param>
    internal ScheduleListItem(PreparedPod pod, PodMember member) {
        this.Pod = pod;
        this.Member = member;
        this._fileInfo = new FileInfo(member.FullPath(pod));
        var content = JObject.Parse(File.ReadAllText(member.FullPath(pod)));
        this.CategoryName = (string?)content["CategoryName"] ?? string.Empty;
        this.FieldCount = content["Fields"] is JArray fields ? fields.Count : 0;
    }

    internal PreparedPod Pod { get; }
    internal PodMember Member { get; }
    public string FilePath => this.Member.FullPath(this.Pod);
    public int FieldCount { get; }
    public string CategoryName { get; }
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    public string TextPrimary => Path.ChangeExtension(this.Member.Path["settings/".Length..], null);
    public string TextSecondary => string.IsNullOrEmpty(this.CategoryName) ? "Unknown Category" : this.CategoryName;
    public string TextPill => $"{this.FieldCount} fields";
    public Func<string> GetTextInfo => static () => string.Empty; // Tooltip disabled - info shown in preview panel
    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;
}
