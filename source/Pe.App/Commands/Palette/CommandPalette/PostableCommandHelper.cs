using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Revit.Lib;
using Pe.Global.Revit.Ui;
using Pe.Ui.Core;

namespace Pe.App.Commands.Palette.CommandPalette;

/// <summary>
///     Service for managing PostableCommand enumeration values and metadata
/// </summary>
public class PostableCommandHelper(Storage storage) {
    private readonly CsvReadWriter<ItemUsageData> _state = storage.StateDir().Csv<ItemUsageData>();
    private List<PostableCommandItem> _allCommands;

    /// <summary>
    ///     Gets all PostableCommand items with metadata, sorted by usage
    /// </summary>
    public List<PostableCommandItem> GetAllCommands() {
        // if ( this._allCommands == null) 

        this._allCommands = this.LoadPostableCommands();

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
        this._allCommands =
            null; // This will force a reload of both commands and shortcuts on next GetAllCommands() call

    /// <summary>
    ///     Loads all PostableCommand enum values and creates metadata
    /// </summary>
    private List<PostableCommandItem> LoadPostableCommands() {
        var commands = new List<PostableCommandItem>();
        var shortcutsService = KeyboardShortcutsHelper.Instance;

        // Check if shortcuts are current, if not, clear the cache to force reload
        if (!shortcutsService.IsShortcutsCurrent()) shortcutsService.ClearCache();

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
            // Try to get shortcut info from XML
            var (shortcutInfo, infoErr) = shortcutsService.GetShortcutInfo(command.Id);
            if (infoErr is not null) {
                if (command.ItemType != "RibbonButton" || command.Panel.Contains("_shr_"))
                    continue;

                var panel = command.Panel.Split('_').Last();
                commandItem.Name = command.Text;
                commandItem.Paths = [$"{command.Tab} > {panel}"];
            }

            if (shortcutInfo is not null) {
                commandItem.Name = shortcutInfo.CommandName;
                commandItem.Shortcuts = shortcutInfo.Shortcuts;
                commandItem.Paths = shortcutInfo.Paths;
            }

            commands.Add(commandItem);
        }

        return commands.OrderByDescending(c => c.LastUsed).ThenBy(c => c.Name).ToList();
    }
}