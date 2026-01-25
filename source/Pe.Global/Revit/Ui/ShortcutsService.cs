using Pe.Global.Revit.Utils;
using System.IO;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using UIFramework;
using UIFrameworkServices;

namespace Pe.Global.Revit.Ui;

/// <summary>
///     Unified service for reading and writing Revit keyboard shortcuts.
///     Reads from XML file with caching, writes via UIFramework API.
/// </summary>
public class ShortcutsService {
    private static readonly Lazy<ShortcutsService> _instance = new(() => new ShortcutsService());

    private DateTime _lastFileModified;
    private string _cachedFilePath;
    private Dictionary<string, ShortcutInfo> _shortcuts;
    private bool _uiFrameworkCommandsLoaded;

    private ShortcutsService() { }

    public static ShortcutsService Instance => _instance.Value;

    #region Reading (from XML cache)

    /// <summary>
    ///     Gets all shortcuts as a dictionary keyed by command ID.
    /// </summary>
    public Dictionary<string, ShortcutInfo> GetAllShortcuts() {
        this._shortcuts ??= this.LoadShortcutsFromXml();
        return this._shortcuts;
    }

    /// <summary>
    ///     Gets shortcut information for a specific command ID.
    /// </summary>
    public Result<ShortcutInfo> GetShortcutInfo(string commandId) {
        var shortcuts = this.GetAllShortcuts();
        return shortcuts.TryGetValue(commandId, out var shortcutInfo)
            ? shortcutInfo
            : new InvalidOperationException($"Shortcut not found for command ID: {commandId}");
    }

    /// <summary>
    ///     Gets the current shortcuts for a command directly from UIFramework (live state).
    ///     Bypasses XML cache - useful for getting the latest state after edits.
    /// </summary>
    public List<string> GetLiveShortcuts(string commandId) {
        try {
            // Only load UIFramework commands once per session (expensive operation)
            this.EnsureUIFrameworkCommandsLoaded();

            if (!ShortcutsHelper.Commands.TryGetValue(commandId, out var shortcutItem))
                return [];

            var rep = shortcutItem.ShortcutsRep;
            if (string.IsNullOrEmpty(rep))
                return [];

            return rep.Split('#')
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToList();
        } catch {
            return [];
        }
    }

    /// <summary>
    ///     Ensures UIFramework commands are loaded (lazy, once per session).
    /// </summary>
    private void EnsureUIFrameworkCommandsLoaded() {
        if (this._uiFrameworkCommandsLoaded) return;

        try {
            ShortcutsHelper.LoadCommands();
            this._uiFrameworkCommandsLoaded = true;
        } catch {
            // Silently fail - commands may not be available yet
        }
    }

    /// <summary>
    ///     Checks if the keyboard shortcuts file has changed since last load.
    ///     Uses file modification time for performance (avoids reading entire file).
    /// </summary>
    public bool IsCacheCurrent() {
        // If we haven't loaded shortcuts yet, consider it not current
        if (this._shortcuts == null || string.IsNullOrEmpty(this._cachedFilePath))
            return false;

        try {
            if (!File.Exists(this._cachedFilePath))
                return false;

            var currentModified = File.GetLastWriteTimeUtc(this._cachedFilePath);
            return currentModified == this._lastFileModified;
        } catch {
            return false;
        }
    }

    /// <summary>
    ///     Clears the cached shortcuts to force reloading on next access.
    /// </summary>
    public void ClearCache() {
        this.ClearXmlCache();
        this._uiFrameworkCommandsLoaded = false;
    }

    /// <summary>
    ///     Clears only the XML cache (not the UIFramework state).
    ///     Use after writes where UIFramework is already up-to-date.
    /// </summary>
    private void ClearXmlCache() {
        this._shortcuts = null;
        this._lastFileModified = default;
        // Keep _cachedFilePath - the path doesn't change
    }

    #endregion

    #region Writing (via UIFramework API)

    /// <summary>
    ///     Updates all shortcuts for a command, replacing any existing shortcuts.
    /// </summary>
    /// <param name="commandId">The command ID (e.g., "ID_EDIT_COPY" or "CustomCtrl_%...")</param>
    /// <param name="shortcuts">List of shortcut strings, or empty to clear all</param>
    /// <returns>Result indicating success or failure with error details</returns>
    public Result<bool> SetShortcuts(string commandId, List<string> shortcuts) {
        if (string.IsNullOrEmpty(commandId))
            return new ArgumentNullException(nameof(commandId), "Command ID cannot be null or empty");

        try {
            // Ensure commands are loaded first
            this.EnsureUIFrameworkCommandsLoaded();

            // Look up the command
            if (!ShortcutsHelper.Commands.TryGetValue(commandId, out var shortcutItem)) {
                return new InvalidOperationException(
                    $"Command not found in shortcuts registry: {commandId}. " +
                    "The command may not be registered or may not support shortcuts.");
            }

            // Format shortcuts with # separator (Revit's internal format)
            var shortcutsRep = shortcuts.Count > 0
                ? string.Join("#", shortcuts.Where(s => !string.IsNullOrWhiteSpace(s)))
                : null;

            // Update the shortcut representation
            shortcutItem.ShortcutsRep = shortcutsRep;

            // Apply changes to Revit's internal state and persist
            KeyboardShortcutService.applyShortcutChanges(ShortcutsHelper.Commands);

            // Only clear XML cache - UIFramework state is already current
            // (avoids expensive ShortcutsHelper.LoadCommands() on next operation)
            this.ClearXmlCache();

            return true;
        } catch (Exception ex) {
            Console.WriteLine($"Failed to update shortcuts for {commandId}: {ex.Message}");
            return new InvalidOperationException($"Failed to update shortcuts: {ex.Message}", ex);
        }
    }

    /// <summary>
    ///     Adds a single shortcut to a command, preserving existing shortcuts.
    /// </summary>
    /// <param name="commandId">The command ID</param>
    /// <param name="shortcut">The shortcut to add (e.g., "CC" or "Ctrl+C")</param>
    /// <returns>Result indicating success or failure</returns>
    public Result<bool> AddShortcut(string commandId, string shortcut) {
        if (string.IsNullOrWhiteSpace(shortcut))
            return new ArgumentNullException(nameof(shortcut), "Shortcut cannot be null or empty");

        try {
            // Get current shortcuts from live state
            var shortcuts = this.GetLiveShortcuts(commandId);

            // Check for duplicates (case-insensitive)
            if (shortcuts.Any(s => s.Equals(shortcut, StringComparison.OrdinalIgnoreCase)))
                return new InvalidOperationException($"Shortcut '{shortcut}' already exists for this command");

            // Add the new shortcut
            shortcuts.Add(shortcut.ToUpperInvariant());

            return this.SetShortcuts(commandId, shortcuts);
        } catch (Exception ex) {
            return new InvalidOperationException($"Failed to add shortcut: {ex.Message}", ex);
        }
    }

    /// <summary>
    ///     Removes a single shortcut from a command.
    /// </summary>
    /// <param name="commandId">The command ID</param>
    /// <param name="shortcut">The shortcut to remove</param>
    /// <returns>Result indicating success or failure</returns>
    public Result<bool> RemoveShortcut(string commandId, string shortcut) {
        if (string.IsNullOrWhiteSpace(shortcut))
            return new ArgumentNullException(nameof(shortcut), "Shortcut cannot be null or empty");

        try {
            // Get current shortcuts from live state
            var shortcuts = this.GetLiveShortcuts(commandId);

            if (shortcuts.Count == 0)
                return new InvalidOperationException("Command has no shortcuts to remove");

            // Find and remove the shortcut (case-insensitive)
            var removed = shortcuts.RemoveAll(s => s.Equals(shortcut, StringComparison.OrdinalIgnoreCase));

            if (removed == 0)
                return new InvalidOperationException($"Shortcut '{shortcut}' not found for this command");

            return this.SetShortcuts(commandId, shortcuts);
        } catch (Exception ex) {
            return new InvalidOperationException($"Failed to remove shortcut: {ex.Message}", ex);
        }
    }

    /// <summary>
    ///     Clears all shortcuts from a command.
    /// </summary>
    /// <param name="commandId">The command ID</param>
    /// <returns>Result indicating success or failure</returns>
    public Result<bool> ClearShortcuts(string commandId) =>
        this.SetShortcuts(commandId, []);

    #endregion

    #region Private helpers

    /// <summary>
    ///     Gets the keyboard shortcuts file path for the current Revit version.
    /// </summary>
    private Result<string> GetShortcutsFilePath() {
        // Return cached path if available
        if (!string.IsNullOrEmpty(this._cachedFilePath) && File.Exists(this._cachedFilePath))
            return this._cachedFilePath;

        var revitVersion = Utils.Utils.GetRevitVersion();
        if (revitVersion == null)
            return new InvalidOperationException("Revit version not found");

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var version = $"Autodesk Revit {revitVersion}";
        var fullPath = Path.Combine(appData, "Autodesk", "Revit", version, "KeyboardShortcuts.xml");

        if (!File.Exists(fullPath))
            return new InvalidOperationException("Keyboard shortcuts file not found");

        this._cachedFilePath = fullPath;
        return fullPath;
    }

    /// <summary>
    ///     Parses the XML file and extracts shortcut information.
    /// </summary>
    private Dictionary<string, ShortcutInfo> LoadShortcutsFromXml() {
        var shortcuts = new Dictionary<string, ShortcutInfo>(StringComparer.OrdinalIgnoreCase);
        var (filePath, pathErr) = this.GetShortcutsFilePath();

        if (pathErr is not null) return shortcuts;

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
                        CommandName = DecodeHtmlEntities(commandName ?? string.Empty),
                        Shortcuts = ParseShortcutString(shortcutsAttr),
                        Paths = ParsePathsString(pathsAttr)
                    };

                    shortcuts[commandId] = shortcutInfo;
                }
            }

            // Store file modification time for cache validation (much faster than hashing)
            this._lastFileModified = File.GetLastWriteTimeUtc(filePath);
        } catch (Exception ex) {
            Console.WriteLine($"Error loading keyboard shortcuts: {ex.Message}");
        }

        return shortcuts;
    }

    /// <summary>
    ///     Parses the shortcuts attribute into a list of shortcut strings.
    /// </summary>
    private static List<string> ParseShortcutString(string shortcutsAttr) =>
        string.IsNullOrEmpty(shortcutsAttr)
            ? []
            : shortcutsAttr.Split('#').Where(s => !string.IsNullOrWhiteSpace(s)).ToList();

    /// <summary>
    ///     Parses the paths attribute into a list of path strings.
    /// </summary>
    private static List<string> ParsePathsString(string pathsAttr) =>
        string.IsNullOrEmpty(pathsAttr)
            ? []
            : pathsAttr
                .Split(';')
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => DecodeHtmlEntities(s.Trim()))
                .ToList();

    /// <summary>
    ///     Decodes common HTML entities in the XML and ensures single-line output.
    /// </summary>
    private static string DecodeHtmlEntities(string text) {
        if (string.IsNullOrEmpty(text))
            return text;

        var decoded = text.Replace("&gt;", ">")
            .Replace("&amp;", "&")
            .Replace("&lt;", "<")
            .Replace("&quot;", "\"")
            .Replace("&#xA;", " ")
            .Replace("\n", " ")
            .Replace("\r", " ");

        return Regex.Replace(decoded, @"\s+", " ").Trim();
    }

    #endregion
}

/// <summary>
///     Represents keyboard shortcut information for a command.
/// </summary>
public class ShortcutInfo {
    public string CommandId { get; set; }
    public string CommandName { get; set; }
    public List<string> Shortcuts { get; set; } = [];
    public List<string> Paths { get; set; } = [];
}
