using Pe.Revit.Global.Lib;
using Pe.Revit.Global.Ui;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.App.Commands.Palette.CommandPalette;

/// <summary>
///     Service for managing PostableCommand enumeration values and metadata
/// </summary>
public class PostableCommandHelper(ModuleStorage storage) {
    private readonly CsvReadWriter<ItemUsageData> _state = storage.State().Csv<ItemUsageData>();
    private List<PostableCommandItem>? _allCommands;

    /// <summary>
    ///     Gets all PostableCommand items with metadata, sorted by usage
    /// </summary>
    public List<PostableCommandItem> GetAllCommands() {
        this._allCommands ??= this.LoadPostableCommands();
        return this._allCommands;
    }

    /// <summary>
    ///     Updates usage statistics for a command
    /// </summary>
    public void UpdateCommandUsage(CommandRef commandRef) {
        var commandItem = this.GetAllCommands().FirstOrDefault(c => c.Command == commandRef);
        if (commandItem is not null) {
            var key = commandRef.Value;
            var existing = this._state.ReadRow(key);
            var usageCount = (existing?.UsageCount ?? 0) + 1;

            var usageData = new ItemUsageData { ItemKey = key, UsageCount = usageCount, LastUsed = DateTime.Now };
            _ = this._state.WriteRow(key, usageData);
        }
    }

    /// <summary>
    ///     Refreshes the commands and shortcuts, clearing cached data
    /// </summary>
    public void RefreshCommands() =>
        this._allCommands = null;

    /// <summary>
    ///     Re-attaches the parent group (split/pulldown container) to nested button names,
    ///     e.g. "All" under the "View Palette" split becomes "View Palette: All".
    ///     External button ids encode the ribbon hierarchy:
    ///     CustomCtrl_%CustomCtrl_%{Tab}%{Panel}%[{Container}%]{ItemName}
    ///     The id is used because container Text is unstable (split buttons mirror the last-used child).
    /// </summary>
    private static string BuildGroupedName(DiscoveredCommand command) {
        if (!command.Id.StartsWith("CustomCtrl_"))
            return command.Text;

        var segments = command.Id.Split('%');
        if (segments.Length < 6)
            return command.Text; // Direct panel button, no container

        var group = segments[segments.Length - 2];
        // GUID = a container created without an explicit internal name (Nice3point single-arg
        // AddPullDownButton/AddSplitButton do this) — meaningless as a display prefix.
        if (string.IsNullOrWhiteSpace(group) || group == command.Text || Guid.TryParse(group, out _))
            return command.Text;

        return $"{group}: {command.Text}";
    }

    /// <summary>
    ///     Loads all PostableCommand enum values and creates metadata
    /// </summary>
    private List<PostableCommandItem> LoadPostableCommands() {
        var commands = new List<PostableCommandItem>();
        var shortcuts = ShortcutsService.Instance;

        // Get all commands from the ribbon
        var ribbonCommands = Ribbon.GetAllCommands();

        foreach (var command in ribbonCommands) {
            var commandId = command.Id;
            var usageData = this._state.ReadRow(commandId);

            var commandItem = new PostableCommandItem {
                Command = command.Id,
                UsageCount = usageData?.UsageCount ?? 0,
                LastUsed = usageData?.LastUsed ?? DateTime.MinValue,
                ImageSource = command.Image
            };

            // Try to get shortcut info from XML cache (for name and paths)
            var (shortcutInfo, infoErr) = shortcuts.GetShortcutInfo(command.Id);
            if (infoErr is not null) {
                if (command.ItemType != "RibbonButton" || command.Panel.Contains("_shr_"))
                    continue;

                var panel = command.Panel.Split('_').Last();
                commandItem.Name = BuildGroupedName(command);
                commandItem.Paths = [$"{command.Tab} > {panel}"];
            }

            if (shortcutInfo is not null) {
                commandItem.Name = shortcutInfo.CommandName;
                commandItem.Paths = shortcutInfo.Paths;
            }

            // Always get shortcuts from live UIFramework state (not XML cache)
            // This ensures we see updates immediately after editing
            commandItem.Shortcuts = shortcuts.GetLiveShortcuts(command.Id);

            commands.Add(commandItem);
        }

        return commands.OrderByDescending(c => c.LastUsed).ThenBy(c => c.Name).ToList();
    }
}