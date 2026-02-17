using Pe.Global.Services.Storage.Core;
using Pe.Ui.Core;
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

    /// <summary>
    ///     Discovers all profile JSON files in a directory, excluding schema files.
    ///     If using a SettingsSubDir with recursive discovery, will find files in nested subdirectories.
    /// </summary>
    public static List<ProfileListItem> DiscoverProfiles(SettingsManager subDir) {
        if (!Directory.Exists(subDir.DirectoryPath))
            return [];

        var jsonFiles = subDir.ListJsonFilesRecursive().Where(f => !f.EndsWith("schema.json") && !f.Contains("schema-"))
            .ToList();
        if (jsonFiles.Count == 0) _ = subDir.Json<ProfileRemap>().Read();
        return jsonFiles
            .Select(relativePath => new ProfileListItem(
                Path.Combine(subDir.DirectoryPath, relativePath),
                relativePath))
            .OrderByDescending(p => p.LastModified)
            .ToList();
    }
}