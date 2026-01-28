using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog;
using System.Text.RegularExpressions;

namespace Pe.App.Commands.Palette;

[Transaction(TransactionMode.Manual)]
public class CmdPltCommands : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        try {
            var uiapp = commandData.Application;
            var persistence = new Storage(nameof(CmdPltCommands));

            // Create and show palette using PaletteFactory
            var palette = CommandPaletteService.Create(uiapp, persistence);
            palette.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            throw new InvalidOperationException($"Error opening command palette: {ex.Message}");
        }
    }
}

public static class CommandPaletteService {
    public static EphemeralWindow Create(UIApplication uiApp, Storage persistence) {
        // Load commands using existing helper
        var commandHelper = new PostableCommandHelper(persistence);
        var commandItems = commandHelper.GetAllCommands();

        // Split commands with semicolon-separated names into separate items
        var selectableItems = BuildSelectableItems(commandItems);

        // Create shortcut editor sidebar panel
        var shortcutEditor = new ShortcutEditorPanel(() => {
            // Refresh commands after shortcut changes (cache is auto-cleared by ShortcutsService)
            commandHelper.RefreshCommands();
        });

        // Create actions - sidebar panel auto-shows shortcut editor on selection
        var actions = new List<PaletteAction<PostableCommandItem>> {
            new() {
                Name = "Execute",
                Execute = async item => {
                    var (success, error) = Global.Revit.Lib.Commands.Execute(uiApp, item.Command);
                    if (error is not null) Log.Error("Error: " + error.Message + error.StackTrace);
                    if (success) commandHelper.UpdateCommandUsage(item.Command);
                },
                CanExecute = item => Global.Revit.Lib.Commands.IsAvailable(uiApp, item.Command)
            }
        };

        // Use PaletteFactory with SidebarPanel for auto-wiring
        return PaletteFactory.Create("Command Palette", selectableItems, actions,
            new PaletteOptions<PostableCommandItem> {
                Persistence = (persistence, item => item.Command.Value),
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                SidebarPanel = shortcutEditor
            });
    }

    private static List<PostableCommandItem> BuildSelectableItems(IEnumerable<PostableCommandItem> commandItems) {
        var selectableItems = new List<PostableCommandItem>();

        foreach (var item in commandItems) {
            if (string.IsNullOrEmpty(item.Name) || !item.Name.Contains(';')) {
                var normalizedItem = item;
                if (!string.IsNullOrEmpty(item.Name) && item.Name.Contains(':')) {
                    normalizedItem = new PostableCommandItem {
                        Command = item.Command,
                        Name = Regex.Replace(item.Name, ":(?! )", ": "),
                        UsageCount = item.UsageCount,
                        LastUsed = item.LastUsed,
                        Shortcuts = [.. item.Shortcuts],
                        Paths = [.. item.Paths]
                    };
                }

                selectableItems.Add(normalizedItem);
                continue;
            }

            // Split name on semicolons and create separate items for each
            var names = item.Name.Split(';')
                .Select(n => n.Trim())
                .Where(n => !string.IsNullOrEmpty(n))
                .Select(n => Regex.Replace(n, ":(?! )", ": "));

            foreach (var name in names) {
                selectableItems.Add(new PostableCommandItem {
                    Command = item.Command,
                    Name = name,
                    UsageCount = item.UsageCount,
                    LastUsed = item.LastUsed,
                    Shortcuts = [.. item.Shortcuts],
                    Paths = [.. item.Paths]
                });
            }
        }

        return selectableItems;
    }
}