
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using System.IO;
using System.Windows.Media.Imaging;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>
///     Palette list item representing a Family Foundry profile JSON file.
///     Displays metadata: filename, line count, and dates.
/// </summary>
public class ProfileListItem : IPaletteListItem {
    public readonly FileInfo _fileInfo;
    private readonly string _relativePath;

    public ProfileListItem(string filePath, string relativePath = null) {
        this.FilePath = filePath;
        this._fileInfo = new FileInfo(filePath);
        this._relativePath = relativePath;
        this.LineCount = File.ReadAllLines(filePath).Length;
    }

    /// <summary> Full path to the profile JSON file </summary>
    public string FilePath { get; }

    /// <summary> Number of lines in the profile file </summary>
    public int LineCount { get; }

    /// <summary> Last modified date for sorting </summary>
    public DateTime LastModified => this._fileInfo.LastWriteTime;

    /// <summary> Profile filename without extension (or relative path if nested) </summary>
    public string TextPrimary => this._relativePath != null
        ? Path.ChangeExtension(this._relativePath, null)
        : Path.GetFileNameWithoutExtension(this.FilePath);

    /// <summary> Shows profile path context </summary>
    public string TextSecondary => this._relativePath != null
        ? Path.GetDirectoryName(this._relativePath)?.Replace('\\', '/') ?? "Profile"
        : "Profile";

    /// <summary> Line count badge </summary>
    public string TextPill => $"{this.LineCount} lines";

    public Func<string> GetTextInfo => null; // Tooltip disabled - info shown in preview panel

    public BitmapImage Icon => null;
    public WpfColor? ItemColor => null;

    public static List<ProfileListItem> DiscoverProfiles(
        ModuleDocumentStorage storage,
        string? rootKey = null
    ) {
        var discovered = storage
            .DiscoverAsync(
                new SettingsDiscoveryOptions(
                    Recursive: true,
                    IncludeFragments: false,
                    IncludeSchemas: false
                ),
                rootKey
            )
            .GetAwaiter()
            .GetResult();

        return discovered.Files
            .Select(file => new ProfileListItem(
                storage.ResolveDocumentPath(file.RelativePath, rootKey),
                file.RelativePath
            ))
            .OrderByDescending(p => p.LastModified)
            .ToList();
    }
}
