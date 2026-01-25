using Pe.Global.Services.Storage.Core.Json;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Global.Services.Storage.Core;

public class GlobalManager {
    private const string _dateTimeFormat = "yyyy-MM-dd HH:mm:ss";
    private const int _maxLines = 500;
    public string DirectoryPath { get; init; }

    public GlobalManager(string basePath) {
        this.DirectoryPath = Path.Combine(basePath, "Global");
        _ = Directory.CreateDirectory(this.DirectoryPath);
    }

    /// <summary>
    ///     Manager for the settings.json in the Global directory. Handles only reads to the file.
    /// </summary>
    /// <remarks>
    ///     Use this to store global add-in settings that should be persisted between Revit sessions.
    ///     File path is always `{basePath}/Global/settings.json`
    /// </remarks>
    public JsonReader<GlobalSettings> SettingsJson() =>
        new ComposableJson<GlobalSettings>(
            Path.Combine(this.DirectoryPath, "settings.json"),
            this.DirectoryPath,
            JsonBehavior.Settings);

    /// <summary>
    ///     Manager for global state files in the Global directory.
    ///     Handles granular read/write to CSV, and full (non-granular) read/write to JSON.
    /// </summary>
    /// <remarks>
    ///     Use this to store global add-in state that should be persisted between Revit sessions.
    ///     File path is `{basePath}/Global/{filename}.json` or `{basePath}/Global/{filename}.csv`
    /// </remarks>
    public JsonReadWriter<T> StateJson<T>(string filename) where T : class, new() =>
        new ComposableJson<T>(
            Path.Combine(this.DirectoryPath, $"{filename}.json"),
            this.DirectoryPath,
            JsonBehavior.State);

    /// <summary>
    ///     Writes to the log.txt in the Global directory with auto cleanup of old logs.
    /// </summary>
    /// <remarks>
    ///     Use this to store global add-in logs that should be persisted between Revit sessions.
    ///     File path is always `{basePath}/Global/log.txt`
    /// </remarks>
    public void LogTxt(string message) {
        var logFilePath = Path.Combine(this.DirectoryPath, "log.txt");
        this.CleanLog(logFilePath);
        var logEntry =
            $"({DateTime.Now.ToString(_dateTimeFormat)}) {message}{Environment.NewLine}{Environment.NewLine}";
        File.AppendAllText(logFilePath, logEntry);
    }

    private void CleanLog(string logFilePath) {
        if (!File.Exists(logFilePath)) return;
        var lines = File.ReadAllLines(logFilePath);
        if (lines.Length <= _maxLines) return;
        var recentLines = lines.Skip(lines.Length - _maxLines).ToArray();
        File.WriteAllLines(logFilePath, recentLines);
    }

    /// <summary> Base interface for all settings classes. Provides global settings properties.</summary>
    public class GlobalSettings {
        [Description(
            "The desktop-app client id of the Autodesk Platform Services app. If none exists yet, make a 'Desktop App' at https://aps.autodesk.com/hubs/@personal/applications/")]
        [Required]
        public string ApsDesktopClientId1 { get; set; } = "";

        [Description(
            "The web-app client id of the Autodesk Platform Services app. If none exists yet, make a 'Traditional Web App' at https://aps.autodesk.com/hubs/@personal/applications/")]
        [Required]
        public string ApsWebClientId1 { get; set; } = "";

        [Description(
            "The web-app client secret of the Autodesk Platform Services app. If none exists yet, make a 'Traditional Web App' at https://aps.autodesk.com/hubs/@personal/applications/")]
        [Required]
        public string ApsWebClientSecret1 { get; set; } = "";

        [Description(
            "The account ID derived from an 'id' field returned by `project/v1/hubs` but with the 'b.' prefix sliced off. If left empty, the first item of 'data' will be used.")]
        [Required]
        public string Bim360AccountId { get; set; } = "";

        [Description(
            "The group ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups`. If left empty, the first item of 'results' will be used.")]
        [Required]
        public string ParamServiceGroupId { get; set; } = "";

        [Description(
            "The collection ID derived from an 'id' field returned by `parameters/v1/accounts/<accountId>/groups/<groupId>/collections`. If left empty, the first item of 'results' will be used.")]
        public string ParamServiceCollectionId { get; set; } = "";
    }
}