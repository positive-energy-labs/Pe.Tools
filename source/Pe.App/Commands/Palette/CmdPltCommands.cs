using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Pe.Ui.ViewModels;
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
            var persistence = new Storage(nameof(CmdPltCommands));

            // Create and show palette using new API
            var palette = CommandPaletteService.Create(uiapp, persistence);
            palette.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            throw new InvalidOperationException($"Error opening command palette: {ex.Message}");
        }
    }
}

public static class CommandPaletteService {
    public static EphemeralWindow Create(
        UIApplication uiApp,
        Storage persistence
    ) {
        // Load commands using existing helper
        var commandHelper = new PostableCommandHelper(persistence);
        var commandItems = commandHelper.GetAllCommands();

        // Split commands with semicolon-separated names into separate items
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

        // Create search filter service with config to search primary (name) and secondary (paths)
        var searchConfig = SearchConfig.PrimaryAndSecondary();
        var searchService = new SearchFilterService<PostableCommandItem>(
            persistence,
            item => {
                if (item is PostableCommandItem cmdItem)
                    return cmdItem.Command.Value.ToString() ?? string.Empty;
                return item.TextPrimary;
            },
            searchConfig);

        // Create actions
        var actions = new List<PaletteAction<PostableCommandItem>> {
            new() {
                Name = "Execute",
                Execute = async item => {
                    if (item is PostableCommandItem cmdItem) {
                        var (success, error) = Global.Revit.Lib.Commands.Execute(uiApp, cmdItem.Command);
                        if (error is not null) Debug.WriteLine("Error: " + error.Message + error.StackTrace);
                        if (success) commandHelper.UpdateCommandUsage(cmdItem.Command);
                    }
                },
                CanExecute = item => {
                    if (item is PostableCommandItem cmdItem)
                        return Global.Revit.Lib.Commands.IsAvailable(uiApp, cmdItem.Command);
                    return false;
                }
            }
        };

        // Create view model
        var viewModel = new PaletteViewModel<PostableCommandItem>(selectableItems, searchService);

        // Create palette using composition pattern (NOT inheritance)
        // Generic classes cannot inherit from XAML partial classes in Revit-hosted WPF
        var palette = new Ui.Components.Palette();
        palette.Initialize(viewModel, actions);

        // Wrap in EphemeralWindow and wire up parent reference for action deferral
        var window = new EphemeralWindow(palette, "Command Palette");
        palette.SetParentWindow(window);
        return window;
    }
}