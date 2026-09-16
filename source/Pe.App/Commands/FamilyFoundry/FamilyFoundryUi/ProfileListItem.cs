using System.Windows.Media;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using System.IO;
using WpfColor = System.Windows.Media.Color;
using Pe.App.Pods;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Global.Services.Aps;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

public enum FoundryFileKind { FamilyModel, Patch }

/// <summary>One `*.family.json` (models root) or `*.patch.json` (patches root) in the FamilyFoundry module.</summary>
public class ProfileListItem : IPaletteListItem {
    public readonly FileInfo _fileInfo;

    internal ProfileListItem(PreparedPodSetting prepared, FoundryFileKind kind) {
        this.FilePath = prepared.FullSourcePath;
        this.RelativePath = prepared.SourcePath;
        this.Kind = kind;
        this.Prepared = prepared;
        this._fileInfo = new FileInfo(this.FilePath);
        this.LineCount = prepared.RawContent.Split('\n').Length;
    }

    public string FilePath { get; }
    public string RelativePath { get; }
    public FoundryFileKind Kind { get; }
    internal PreparedPodSetting Prepared { get; private set; }
    internal PreparedPodSetting? AttemptSnapshot { get; private set; }
    internal void BeginAttempt() => this.AttemptSnapshot = null;
    public int LineCount { get; }
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    public string TextPrimary => Path.GetFileName(this.FilePath);
    public string TextSecondary => $"{this.Prepared.PodId} · {(this.Kind == FoundryFileKind.Patch ? "patch" : "family.json")}";
    public string TextPill => $"{this.LineCount} lines";
    public Func<string> GetTextInfo => () => string.Empty;
    public ImageSource? Icon => null;
    public WpfColor? ItemColor => null;

    internal FamilyModel LoadModel() {
        this.Prepared = this.Prepared.Refresh();
        this.AttemptSnapshot = this.Prepared;
        return ModuleSettingsStorage<FamilyModel>.ReadPrepared(
            this.Prepared.RawContent, this.Prepared.ComposedContent, $"{this.Prepared.PodId}:{this.Prepared.SourcePath}");
    }

    internal FamilyPatch LoadPatch() {
        this.Prepared = this.Prepared.Refresh();
        this.AttemptSnapshot = this.Prepared;
        return ModuleSettingsStorage<FamilyPatch>.ReadPrepared(
            this.Prepared.RawContent, this.Prepared.ComposedContent, $"{this.Prepared.PodId}:{this.Prepared.SourcePath}");
    }

    internal Func<Document, FamilySharedParameterSource>? SharedParameterSource() {
        var requirements = this.Prepared.ExternalRequirements;
        var unsupported = requirements.FirstOrDefault(requirement => requirement.Code != "aps.parameters");
        if (unsupported is not null)
            throw new InvalidDataException($"Family Foundry does not support external authority '{unsupported.Code}'.");
        var collections = requirements.Select(requirement => requirement.CollectionId).Distinct(StringComparer.Ordinal).ToList();
        if (collections.Count > 1)
            throw new InvalidDataException("Family Foundry requires all aps.parameters resources to use one collection.");
        var collectionId = collections.SingleOrDefault();
        var resourceIds = requirements.Select(requirement => requirement.ResourceId).ToList();
        if (resourceIds.Count == 0)
            return document => new FamilySharedParameterSource(document, requireDeclaration: true);
        var current = ParametersServiceCache.ResolveCurrentAsync(collectionId).GetAwaiter().GetResult();
        var missing = resourceIds.Where(id => !current.ResourceIds.Contains(id)).ToList();
        if (missing.Count > 0)
            throw new InvalidDataException(
                $"Current Parameters Service collection '{current.CollectionId}' has no required resource: {string.Join(", ", missing)}.");
        return document => new FamilySharedParameterSource(document, current.Definitions,
            requiredResourceIds: resourceIds, requireDeclaration: true, observedParametersDigest: current.Digest);
    }

}
