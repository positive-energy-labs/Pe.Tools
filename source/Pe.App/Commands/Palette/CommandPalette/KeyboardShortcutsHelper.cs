using Pe.Global.Revit.Ui;
using Pe.Global.Revit.Utils;
using Pe.Global.Services.Storage;
using Serilog.Events;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows;
using System.Xml.Linq;

namespace Pe.App.Commands.Palette.CommandPalette;

/// <summary>
///     Service for parsing and managing Revit keyboard shortcuts from XML file
/// </summary>
public class KeyboardShortcutsHelper {
    private static readonly Lazy<KeyboardShortcutsHelper> _instance = new(() => new KeyboardShortcutsHelper());

    private string _lastFileHash;

    private Dictionary<string, ShortcutInfo> _shortcuts;

    private KeyboardShortcutsHelper() { }

    public static KeyboardShortcutsHelper Instance => _instance.Value;

    /// <summary> Checks if the keyboard shortcuts file has changed </summary>
    public bool IsShortcutsCurrent() {
        var (filePath, pathErr) = this.GetShortcutsFilePath();
        if (pathErr is not null) return false;

        // If we haven't loaded shortcuts yet, consider it not current
        if (string.IsNullOrEmpty(this._lastFileHash)) return false;

        var currentFileText = File.ReadAllText(filePath);
        var currentHash = FileUtils.ComputeFileHashFromText(currentFileText);
        return this._lastFileHash == currentHash;
    }

    /// <summary>
    ///     Clears the cached shortcuts to force reloading
    /// </summary>
    public void ClearCache() {
        this._shortcuts = null;
        this._lastFileHash = null;
    }

    /// <summary>
    ///     Gets the keyboard shortcuts file path for the current Revit version
    /// </summary>
    private Result<string> GetShortcutsFilePath() {
        var revitVersion = Utils.GetRevitVersion();
        if (revitVersion == null) {
            new Ballogger()
                .Add(LogEventLevel.Warning, null, "Revit version not found")
                .Show();
            return string.Empty;
        }

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var version = $"Autodesk Revit {revitVersion}";
        var fullPath = Path.Combine(appData, "Autodesk", "Revit", version, "KeyboardShortcuts.xml");
        if (!File.Exists(fullPath)) return new InvalidOperationException("Keyboard shortcuts file not found");
        return fullPath;
    }

    /// <summary>
    ///     Loads and parses the keyboard shortcuts XML file if not already loaded
    /// </summary>
    public Dictionary<string, ShortcutInfo> GetShortcuts() {
        if (this._shortcuts == null) this._shortcuts = this.LoadShortcutsFromXml();

        return this._shortcuts;
    }

    /// <summary>
    ///     Gets shortcut information for a specific command ID
    /// </summary>
    public Result<ShortcutInfo> GetShortcutInfo(string commandId) {
        var shortcuts = this.GetShortcuts();
        return shortcuts.TryGetValue(commandId, out var shortcutInfo)
            ? shortcutInfo
            : new InvalidOperationException($"Shortcut not found for command ID: {commandId}");
    }

    /// <summary>
    ///     Parses the XML file and extracts shortcut information
    /// </summary>
    private Dictionary<string, ShortcutInfo> LoadShortcutsFromXml() {
        var shortcuts = new Dictionary<string, ShortcutInfo>(StringComparer.OrdinalIgnoreCase);
        var (filePath, pathErr) = this.GetShortcutsFilePath();
        new Ballogger()
            .Add(LogEventLevel.Information, null, $"Loading Keyboard shortcuts file\n {filePath}")
            .Show(() => Clipboard.SetText(filePath), "Click to copy path");
        if (pathErr is not null) return shortcuts; // Return empty dictionary if file doesn't exist

        try {
            var doc = XDocument.Load(filePath);
            var shortcutItems = doc.Descendants("ShortcutItem");

            foreach (var item in shortcutItems) {
                var commandId = item.Attribute("CommandId")?.Value;
                var commandName = item.Attribute("CommandName")?.Value;
                var shortcutsAttr = item.Attribute("Shortcuts")?.Value;
                var pathsAttr = item.Attribute("Paths")?.Value;

                if (!string.IsNullOrEmpty(commandId)) {
                    var shortcutInfo = new ShortcutInfo {
                        CommandId = commandId,
                        CommandName = this.DecodeHtmlEntities(commandName ?? string.Empty),
                        Shortcuts = this.ParseShortcuts(shortcutsAttr),
                        Paths = this.ParsePaths(pathsAttr)
                    };

                    shortcuts[commandId] = shortcutInfo;
                }
            }

            this._lastFileHash = FileUtils.ComputeFileHashFromText(File.ReadAllText(filePath));
        } catch (Exception ex) {
            // Log error but don't crash - return empty dictionary
            Debug.WriteLine(
                $"Error loading keyboard shortcuts: {ex.Message}"
            );
        }

        return shortcuts;
    }

    /// <summary>
    ///     Parses the shortcuts attribute into a list of shortcut strings
    /// </summary>
    private List<string> ParseShortcuts(string shortcutsAttr) =>
        string.IsNullOrEmpty(shortcutsAttr)
            ? new List<string>()
            : shortcutsAttr.Split('#').Where(s => !string.IsNullOrWhiteSpace(s)).ToList();

    /// <summary>
    ///     Parses the paths attribute into a list of path strings
    /// </summary>
    private List<string> ParsePaths(string pathsAttr) =>
        string.IsNullOrEmpty(pathsAttr)
            ? new List<string>()
            : pathsAttr
                .Split(';')
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => this.DecodeHtmlEntities(s.Trim()))
                .ToList();

    /// <summary>
    ///     Decodes common HTML entities in the XML and ensures single-line output
    /// </summary>
    private string DecodeHtmlEntities(string text) {
        if (string.IsNullOrEmpty(text))
            return text;

        // Decode HTML entities and replace line breaks with a space
        var decoded = text.Replace("&gt;", ">")
            .Replace("&amp;", "&")
            .Replace("&lt;", "<")
            .Replace("&quot;", "\"")
            .Replace("&#xA;", " ") // XML line break entity
            .Replace("\n", " ")
            .Replace("\r", " ");

        // Collapse multiple spaces to a single space and trim
        return Regex.Replace(decoded, @"\s+", " ").Trim();
    }

    /// <summary>
    ///     Gets a truncated display string for paths
    /// </summary>
    public string GetTruncatedPaths(List<string> paths, int maxLength = 50) {
        if (paths == null || paths.Count == 0)
            return string.Empty;

        var allPaths = string.Join("; ", paths);
        return allPaths.Length <= maxLength ? allPaths : allPaths[..(maxLength - 3)] + "...";
    }
}

/// <summary>
///     Represents keyboard shortcut information for a command
/// </summary>
public class ShortcutInfo {
    public string CommandId { get; set; }
    public string CommandName { get; set; }
    public List<string> Shortcuts { get; set; } = new();
    public List<string> Paths { get; set; } = new();
}