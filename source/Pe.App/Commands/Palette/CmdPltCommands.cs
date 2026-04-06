using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Services;
using Pe.Shared.StorageRuntime;
using Serilog;
using System.Diagnostics;
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
            var persistence = StorageClient.Default.Module(nameof(CmdPltCommands));

            // Load commands using existing helper
            var commandHelper = new PostableCommandHelper(persistence);
            var commandItems = commandHelper.GetAllCommands();

            // Split commands with semicolon-separated names into separate items
            var selectableItems = BuildSelectableItems(commandItems);

            var window = PaletteFactory.Create("Command Palette",
                new PaletteOptions<PostableCommandItem> {
                    Persistence = (persistence, item => item.Command.Value),
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    Tabs = [
                        new TabDefinition<PostableCommandItem>(
                            "All",
                            () => selectableItems,
                            new PaletteAction<PostableCommandItem> {
                                Name = "Execute",
                                Execute = async item => {
                                    var (success, error) = Revit.Global.Revit.Lib.Commands.Execute(uiapp, item.Command);
                                    if (error is not null) Log.Error("Error: " + error.Message + error.StackTrace);
                                    if (success) commandHelper.UpdateCommandUsage(item.Command);
                                },
                                CanExecute = item => Revit.Global.Revit.Lib.Commands.IsAvailable(uiapp, item.Command)
                            }
                        )
                    ]
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex.ToStringDemystified());
            throw new InvalidOperationException($"Error opening command palette: {ex.Message}");
        }
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
