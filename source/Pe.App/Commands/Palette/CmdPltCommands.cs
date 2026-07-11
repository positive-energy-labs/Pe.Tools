using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.App.Tasks;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Services;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.StorageRuntime;
using Serilog;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Pe.App.Commands.Palette;

/// <summary>
///     The "Do" palette: every verb in one place. Commands (ribbon/postable) and Tasks
///     (registered code snippets) are tabs of the same palette — they are the same intent.
///     Tabs are type-erased over <see cref="IPaletteListItem" /> so heterogeneous item
///     types coexist; each tab's action casts back to its own type.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltCommands : IExternalCommand {
    internal const string Title = "Do";

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) => Show(commandData.Application, 0);

    internal static Result Show(UIApplication uiapp, int defaultTabIndex) {
        try {
            // Docked palette acts like a command line: the ribbon shortcut summons + focuses it.
            if (PaletteDock.TrySummonDocked(Title))
                return Result.Succeeded;

            var persistence = StorageClient.Default.Module(nameof(CmdPltCommands));

            var commandHelper = new PostableCommandHelper(persistence);

            var window = PaletteFactory.Create(Title,
                new PaletteOptions<IPaletteListItem> {
                    Persistence = (persistence, item => item switch {
                        PostableCommandItem c => c.Command.Value,
                        TaskItem t => $"task:{t.Id}",
                        PodScriptTaskItem p => p.Id,
                        _ => item.TextPrimary
                    }),
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    DefaultTabIndex = defaultTabIndex,
                    Tabs = [
                        new TabDefinition<IPaletteListItem>(
                            "Commands",
                            () => BuildSelectableItems(commandHelper.GetAllCommands()),
                            new PaletteAction<IPaletteListItem> {
                                Name = "Execute",
                                Execute = async item => {
                                    if (item is not PostableCommandItem command) return;
                                    var (success, error) = Revit.Global.Lib.Commands.Execute(uiapp, command.Command);
                                    if (error is not null) Log.Error("Error: " + error.Message + error.StackTrace);
                                    if (success) commandHelper.UpdateCommandUsage(command.Command);
                                },
                                CanExecute = item => item is PostableCommandItem command &&
                                                     Revit.Global.Lib.Commands.IsAvailable(uiapp, command.Command)
                            }
                        ),
                        new TabDefinition<IPaletteListItem>(
                            "Tasks",
                            () => {
                                // Refresh registry on collection so hot-reloaded tasks appear
                                TaskInitializer.RegisterAllTasks();
                                return TaskRegistry.Instance.GetAll()
                                    .Select(tuple => new TaskItem { Id = tuple.Id, Task = tuple.Task });
                            },
                            new PaletteAction<IPaletteListItem> {
                                Name = "Execute",
                                Execute = async item => {
                                    if (item is not TaskItem task) return;
                                    try {
                                        Console.WriteLine($"Executing task: {task.Task.Name}");
                                        await task.Task.ExecuteAsync(uiapp);
                                        Console.WriteLine($"Task '{task.Task.Name}' completed\n");
                                    } catch (Exception ex) {
                                        Console.WriteLine($"Task '{task.Task.Name}' failed: {ex.Message}");
                                        Console.WriteLine(ex.StackTrace);
                                    }
                                }
                            }
                        ) { FilterKeySelector = item => (item as TaskItem)?.Task.Category ?? string.Empty },
                        new TabDefinition<IPaletteListItem>(
                            "Scripts",
                            BuildPodScriptItems,
                            new PaletteAction<IPaletteListItem> {
                                Name = "Run — safe (changes discarded)",
                                Execute = async item => {
                                    if (item is PodScriptTaskItem pod)
                                        PodScriptRunner.Run(uiapp, pod, ScriptPermissionMode.ReadOnly);
                                }
                            },
                            new PaletteAction<IPaletteListItem> {
                                Name = "Run — full (can modify model)",
                                Execute = async item => {
                                    if (item is PodScriptTaskItem pod)
                                        PodScriptRunner.Run(uiapp, pod, ScriptPermissionMode.WriteTransaction);
                                }
                            }
                        ) { FilterKeySelector = item => (item as PodScriptTaskItem)?.PodName ?? string.Empty }
                    ]
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex.ToStringDemystified());
            throw new InvalidOperationException($"Error opening command palette: {ex.Message}");
        }
    }

    /// <summary>
    ///     Every entrypoint of every valid pod becomes a palette item. Invalid pods are skipped
    ///     here (the CLI/agent `scripting.pod.list` surface reports their diagnostics).
    /// </summary>
    private static IEnumerable<IPaletteListItem> BuildPodScriptItems() =>
        ScriptPodCatalogService.List().Pods
            .Where(pod => pod.IsValid && pod.Manifest is not null)
            .SelectMany(pod => pod.Manifest!.Entrypoints.Select(entrypoint => (IPaletteListItem)new PodScriptTaskItem {
                WorkspaceKey = pod.WorkspaceKey,
                PodName = pod.Manifest.Name,
                Entrypoint = entrypoint
            }));

    private static List<IPaletteListItem> BuildSelectableItems(IEnumerable<PostableCommandItem> commandItems) {
        var selectableItems = new List<IPaletteListItem>();

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
                        Paths = [.. item.Paths],
                        ImageSource = item.ImageSource
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
                    Paths = [.. item.Paths],
                    ImageSource = item.ImageSource
                });
            }
        }

        return selectableItems;
    }
}
