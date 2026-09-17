using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit.Ui.Core;
using System.IO;
using WpfColor = System.Windows.Media.Color;

namespace Pe.App.Commands.Schedules.Ui;

/// <summary>A pod member whose `$schema` is a schedule batch: a list of schedule members in the same pod.</summary>
public class BatchScheduleListItem : IPaletteListItem {
    private readonly FileInfo _fileInfo;

    internal BatchScheduleListItem(PodMember member) {
        this.Member = member;
        this._fileInfo = new FileInfo(member.FullPath);
        this.ScheduleCount = PodMembers.ReadOrEmpty(member.FullPath)["ScheduleFiles"] is JArray files ? files.Count : 0;
    }

    internal PodMember Member { get; }
    public string FilePath => this.Member.FullPath;
    public int ScheduleCount { get; }
    public DateTime LastModified => this._fileInfo.LastWriteTime;
    public DateTime CreatedDate => this._fileInfo.CreationTime;

    public string TextPrimary => Path.ChangeExtension(this.Member.Path["settings/".Length..], null);
    public string TextSecondary => "Batch Configuration";
    public string TextPill => $"{this.ScheduleCount} schedules";
    public Func<string> GetTextInfo => () => string.Empty;
    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>The schedule members this batch names, resolved inside its own pod.</summary>
    internal IReadOnlyList<PodMember> Schedules() =>
        this.Member.Load<Pe.Shared.RevitData.Schedules.BatchScheduleSettings>().Spec.ScheduleFiles
            .Select(file => this.Member with { Path = "settings/" + file.Replace(Path.DirectorySeparatorChar, '/'), Schema = null })
            .ToList();
}
