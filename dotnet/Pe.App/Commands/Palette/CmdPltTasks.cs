using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Bookmark into the Do palette's Tasks tab. Tasks are verbs — same palette as commands.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltTasks : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) => CmdPltCommands.Show(commandData.Application, 1);
}
