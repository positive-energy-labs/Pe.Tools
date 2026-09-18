using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Ui.Core;
using System.IO;
using WpfColor = System.Windows.Media.Color;

namespace Pe.App.Commands.Schedules.Ui;

/// <summary>A pod member whose `$schema` is a schedule batch: a list of schedule members in the same pod.</summary>
public class BatchScheduleListItem : IPaletteListItem {
    private readonly FileInfo _fileInfo;

    /// <param name="member">Listed by `$schema`, so the library already parsed it as a JSON object.</param>
    internal BatchScheduleListItem(PreparedPod pod, PodMember member) {
        this.Pod = pod;
        this.Member = member;
        this._fileInfo = new FileInfo(member.FullPath(pod));
        this.ScheduleCount = JObject.Parse(File.ReadAllText(member.FullPath(pod)))["ScheduleFiles"] is JArray files ? files.Count : 0;
    }

    internal PreparedPod Pod { get; }
    internal PodMember Member { get; }
    public string FilePath => this.Member.FullPath(this.Pod);
    public int ScheduleCount { get; }
    public DateTime LastModified => this._fileInfo.LastWriteTime;
    public DateTime CreatedDate => this._fileInfo.CreationTime;

    public string TextPrimary => Path.ChangeExtension(this.Member.Path["settings/".Length..], null);
    public string TextSecondary => "Batch Configuration";
    public string TextPill => $"{this.ScheduleCount} schedules";
    public Func<string> GetTextInfo => () => string.Empty;
    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>The schedule members this batch names, resolved inside its own pod; a missing one fails the batch.</summary>
    internal IReadOnlyList<PodMember> Schedules() =>
        this.Member.Load<Pe.Shared.RevitData.Schedules.BatchScheduleSettings>(this.Pod).Spec.ScheduleFiles
            .Select(file => "settings/" + file.Replace(Path.DirectorySeparatorChar, '/'))
            .Select(path => this.Pod.Members.SingleOrDefault(member => member.Path == path)
                            ?? throw new FileNotFoundException($"Batch names '{path}', which is not a member of pod '{this.Pod.Manifest.Id}'."))
            .ToList();
}
