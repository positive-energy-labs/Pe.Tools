using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Pe.Ui.ViewModels;
using Serilog;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Input;

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
                    return cmdItem.Command.Value;
                return item.TextPrimary;
            },
            searchConfig);

        // Create shortcut editor sidebar panel
        var shortcutEditor = new ShortcutEditorPanel(() => {
            // Refresh commands after shortcut changes (cache is auto-cleared by ShortcutsService)
            commandHelper.RefreshCommands();
        });

        // Create actions
        var actions = new List<PaletteAction<PostableCommandItem>> {
            new() {
                Name = "Execute",
                Execute = async item => {
                    var (success, error) = Global.Revit.Lib.Commands.Execute(uiApp, item.Command);
                    if (error is not null) Log.Error("Error: " + error.Message + error.StackTrace);
                    if (success) commandHelper.UpdateCommandUsage(item.Command);
                },
                CanExecute = item => Global.Revit.Lib.Commands.IsAvailable(uiApp, item.Command)
            },
            new() {
                Name = "Edit Shortcuts",
                Key = Key.E,
                Modifiers = ModifierKeys.Control,
                NextPalette = item => {
                    shortcutEditor.UpdateItem(item);
                    return shortcutEditor;
                },
                CanExecute = _ => true
            }
        };

        // Create view model
        var viewModel = new PaletteViewModel<PostableCommandItem>(selectableItems, searchService);

        // Create sidebar configuration
        var sidebar = new PaletteSidebar {
            Content = shortcutEditor,
            Width = new GridLength(400)
        };

        // Create palette using composition pattern (NOT inheritance)
        // Generic classes cannot inherit from XAML partial classes in Revit-hosted WPF
        var palette = new Ui.Components.Palette();
        palette.Initialize(viewModel, actions, paletteSidebar: sidebar);

        // Wire up selection change to update the shortcut editor when sidebar is visible
        viewModel.PropertyChanged += (_, e) => {
            if (e.PropertyName == nameof(viewModel.SelectedItem) && viewModel.SelectedItem != null)
                shortcutEditor.UpdateItem(viewModel.SelectedItem);
        };

        // Wrap in EphemeralWindow and wire up parent reference for action deferral
        var window = new EphemeralWindow(palette, "Command Palette");
        palette.SetParentWindow(window);
        return window;
    }
}