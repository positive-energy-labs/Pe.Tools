using Autodesk.Revit.UI;
using Pe.Global.Revit.Lib;
using Pe.Ui.Core;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette.CommandPalette;

/// <summary>
///     Represents a PostableCommand item with additional metadata for the command palette
/// </summary>
public class PostableCommandItem : IPaletteListItem {
    /// <summary>
    ///     For internal commands, the actual PostableCommand enum value
    ///     For external (addin) commands, the custom CommandId (e.g., CustomCtrl_%CustomCtrl_%...)
    /// </summary>
    public CommandRef Command { get; set; }

    /// <summary>
    ///     Display name of the command
    /// </summary>
    public string Name { get; set; }

    /// <summary>
    ///     Number of times this command has been used (for prioritization)
    /// </summary>
    public int UsageCount { get; set; }

    /// <summary>
    ///     Last time this command was executed
    /// </summary>
    public DateTime LastUsed { get; set; }

    /// <summary>
    ///     Keyboard shortcuts for this command
    /// </summary>
    public List<string> Shortcuts { get; set; } = new();

    /// <summary>
    ///     Menu paths for this command
    /// </summary>
    public List<string> Paths { get; set; } = new();

    /// <summary>
    ///     Command icon from the ribbon
    /// </summary>
    public ImageSource ImageSource { get; set; }

    /// <summary>
    ///     Gets the primary shortcut as a display string
    /// </summary>
    public string PrimaryShortcut => this.Shortcuts.Count > 0 ? this.Shortcuts[0] : string.Empty;

    /// <summary>
    ///     Gets all shortcuts as a display string
    /// </summary>
    public string AllShortcuts => string.Join(", ", this.Shortcuts);

    /// <summary>
    ///     Gets all paths as a display string
    /// </summary>
    public string AllPaths => string.Join("; ", this.Paths);

    /// <summary>
    ///     Gets truncated paths for display (with tooltip for full paths)
    /// </summary>
    public string TruncatedPaths {
        get {
            if (this.Paths.Count == 0)
                return string.Empty;

            var allPaths = this.AllPaths;
            if (allPaths.Length <= 50)
                return allPaths;

            return allPaths.Substring(0, 47) + "...";
        }
    }

    // ISelectableItem implementation
    public string TextPrimary => this.Name;
    public string TextSecondary => this.TruncatedPaths;
    public string TextPill => this.PrimaryShortcut;
    public Func<string> GetTextInfo => () => this.AllPaths;

    public BitmapImage Icon {
        get {
            if (this.ImageSource is BitmapImage bitmapImage)
                return bitmapImage;

            // Try to convert ImageSource to BitmapImage
            if (this.ImageSource is BitmapSource bitmapSource) {
                try {
                    // Convert BitmapSource (including BitmapFrame) to BitmapImage
                    var encoder = new PngBitmapEncoder();
                    encoder.Frames.Add(BitmapFrame.Create(bitmapSource));

                    using var stream = new MemoryStream();
                    encoder.Save(stream);
                    stream.Position = 0;

                    var result = new BitmapImage();
                    result.BeginInit();
                    result.CacheOption = BitmapCacheOption.OnLoad;
                    result.StreamSource = stream;
                    result.EndInit();
                    result.Freeze();

                    return result;
                } catch {
                    return null;
                }
            }

            return null;
        }
    }

    public Color? ItemColor => null;

    public override string ToString() => this.Name;
}