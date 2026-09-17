using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;
using System.IO;
using WpfColor = System.Windows.Media.Color;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

public enum FoundryFileKind { FamilyModel, Patch }

/// <summary>One pod member whose `$schema` is a family model or a family patch.</summary>
public class ProfileListItem : IPaletteListItem {
    private readonly FileInfo _fileInfo;

    internal ProfileListItem(PreparedPod pod, PodMember member, FoundryFileKind kind) {
        this.Pod = pod;
        this.Member = member;
        this.Kind = kind;
        this._fileInfo = new FileInfo(member.FullPath(pod));
        this.LineCount = File.ReadAllLines(member.FullPath(pod)).Length;
    }

    internal PreparedPod Pod { get; }
    internal PodMember Member { get; }
    public string FilePath => this.Member.FullPath(this.Pod);
    public string RelativePath => $"{this.Pod.Manifest.Id}:{this.Member.Path}";
    public FoundryFileKind Kind { get; }
    public int LineCount { get; }
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    public string TextPrimary => Path.GetFileName(this.FilePath);
    public string TextSecondary => $"{this.Pod.Manifest.Id} · {(this.Kind == FoundryFileKind.Patch ? "patch" : "family.json")}";
    public string TextPill => $"{this.LineCount} lines";
    public Func<string> GetTextInfo => () => string.Empty;
    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>The composed member as authored; the family edge reads its `$schema`.</summary>
    internal (string SpecJson, PodMemberSource Source) LoadSpec() {
        if (this.Kind == FoundryFileKind.Patch) {
            var (_, composed, source) = this.Member.Load<FamilyPatch>(this.Pod);
            return (composed, source);
        }
        var (_, composedModel, modelSource) = this.Member.Load<FamilyModel>(this.Pod);
        return (composedModel, modelSource);
    }
}
