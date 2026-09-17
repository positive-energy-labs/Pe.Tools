using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
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

    internal ProfileListItem(PodMember member, FoundryFileKind kind) {
        this.Member = member;
        this.Kind = kind;
        this._fileInfo = new FileInfo(member.FullPath);
        this.LineCount = File.ReadAllLines(member.FullPath).Length;
    }

    internal PodMember Member { get; }
    public string FilePath => this.Member.FullPath;
    public string RelativePath => $"{this.Member.PodId}:{this.Member.Path}";
    public FoundryFileKind Kind { get; }
    public int LineCount { get; }
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    public string TextPrimary => Path.GetFileName(this.FilePath);
    public string TextSecondary => $"{this.Member.PodId} · {(this.Kind == FoundryFileKind.Patch ? "patch" : "family.json")}";
    public string TextPill => $"{this.LineCount} lines";
    public Func<string> GetTextInfo => () => string.Empty;
    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;

    /// <summary>The composed member as a family spec. A model rides as `{ patch: model }`, exactly as the family route sends it.</summary>
    internal (string SpecJson, PodMemberSource Source) LoadSpec() {
        if (this.Kind == FoundryFileKind.Patch) {
            var (_, composed, source) = this.Member.Load<FamilyPatch>();
            return (composed, source);
        }
        var (_, composedModel, modelSource) = this.Member.Load<FamilyModel>();
        var model = JObject.Parse(composedModel);
        _ = model.Remove("$schema");
        return (new JObject { ["patch"] = model }.ToString(), modelSource);
    }
}
