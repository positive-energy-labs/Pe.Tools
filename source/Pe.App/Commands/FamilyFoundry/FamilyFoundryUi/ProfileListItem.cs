using Pe.Revit.FamilyFoundry;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using System.IO;
using System.Windows.Media.Imaging;
using WpfColor = System.Windows.Media.Color;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

public enum FoundryFileKind { FamilyModel, Patch }

/// <summary>One `*.family.json` (models root) or `*.patch.json` (patches root) in the FamilyFoundry module.</summary>
public class ProfileListItem : IPaletteListItem {
    public readonly FileInfo _fileInfo;

    public ProfileListItem(string filePath, string relativePath, FoundryFileKind kind) {
        this.FilePath = filePath;
        this.RelativePath = relativePath;
        this.Kind = kind;
        this._fileInfo = new FileInfo(filePath);
        this.LineCount = File.ReadAllLines(filePath).Length;
    }

    public string FilePath { get; }
    public string RelativePath { get; }
    public FoundryFileKind Kind { get; }
    public int LineCount { get; }
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    public string TextPrimary => Path.GetFileName(this.FilePath);
    public string TextSecondary => this.Kind == FoundryFileKind.Patch ? "patch" : "family.json";
    public string TextPill => $"{this.LineCount} lines";
    public Func<string> GetTextInfo => () => string.Empty;
    public BitmapImage? Icon => null;
    public WpfColor? ItemColor => null;

    public static List<ProfileListItem> Discover(ModuleDocumentStorage storage) {
        List<ProfileListItem> In(string rootKey, FoundryFileKind kind) {
            var discovered = storage.DiscoverAsync(new SettingsDiscoveryOptions(Recursive: true, IncludeFragments: false, IncludeSchemas: false), rootKey).GetAwaiter().GetResult();
            return discovered.Files.Select(f => new ProfileListItem(storage.ResolveDocumentPath(f.RelativePath, rootKey), f.RelativePath, kind)).ToList();
        }
        return In(FamilyModelSettingsRegistration.RootKey, FoundryFileKind.FamilyModel)
            .Concat(In(FamilyModelSettingsRegistration.PatchRootKey, FoundryFileKind.Patch))
            .OrderByDescending(p => p.LastModified)
            .ToList();
    }
}
